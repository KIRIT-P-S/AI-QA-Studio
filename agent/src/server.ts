import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  activity,
  dataDir,
  id,
  mutate,
  projectById,
  readStore,
  validateURL,
} from "../../web/lib/studio/store";
import { agentToken } from "../../web/lib/studio/agent";
import type {
  DiscoveryPage,
  Result,
  Step,
  TestCase,
} from "../../web/lib/studio/model";
import { verifyDatabase } from "./readOnlyDatabase";
import { clickRequiresHuman } from "./actionSafety";
import { validateSteps } from "../../web/lib/studio/validation";

type Session = {
  projectId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  mode: "Manual" | "AI";
  state: "Connected" | "Discovering" | "Running" | "Paused";
  message: string;
  cancelled: boolean;
  busy: boolean;
  runId?: string;
  currentTest?: string;
  currentStep?: number;
  logs: { at: string; message: string }[];
  network: Result["network"];
  console: string[];
  evidenceIds: string[];
  origin: string;
  preview?: string;
};
const sessions = new Map<string, Session>();
const evidenceDir = path.join(dataDir, "evidence");
const safeURL = (url: string) => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
};
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
function log(s: Session, message: string) {
  s.message = message;
  s.logs.unshift({ at: new Date().toISOString(), message });
  s.logs = s.logs.slice(0, 100);
}
function state(s?: Session) {
  return s
    ? {
        online: true,
        connected: !s.page.isClosed(),
        mode: s.mode,
        state: s.state,
        message: s.message,
        currentTest: s.currentTest,
        currentStep: s.currentStep,
        runId: s.runId,
        logs: s.logs,
        url: s.page.isClosed() ? "" : safeURL(s.page.url()),
      }
    : {
        online: true,
        connected: false,
        mode: "Manual",
        state: "Disconnected",
        message: "Connect the application to start a browser session.",
        logs: [],
      };
}
async function permission(s: Session) {
  while (s.mode === "Manual" && !s.cancelled && !s.page.isClosed())
    await new Promise((r) => setTimeout(r, 150));
  if (s.cancelled) throw new Error("Run cancelled by user.");
  if (s.page.isClosed())
    throw new Error("Browser was closed. Reconnect the application.");
}
function withinOrigin(s: Session, raw: string) {
  const url = validateURL(new URL(raw, s.origin).href);
  if (new URL(url).origin !== s.origin)
    throw new Error(
      "Automated navigation is limited to the connected application origin.",
    );
  return url;
}
async function connect(projectId: string) {
  if (sessions.has(projectId) && !sessions.get(projectId)!.page.isClosed())
    return state(sessions.get(projectId));
  const project = projectById(await readStore(), projectId);
  await fs.mkdir(evidenceDir, { recursive: true });
  const launchOptions = { headless: process.env.STUDIO_HEADLESS === "true" };
  let browser: Browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch {
    try {
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
    } catch {
      browser = await chromium.launch({ ...launchOptions, channel: "msedge" });
    }
  }
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: evidenceDir },
      acceptDownloads: false,
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const s: Session = {
      projectId,
      browser,
      context,
      page,
      mode: "Manual",
      state: "Connected",
      message: "",
      cancelled: false,
      busy: false,
      logs: [],
      network: [],
      console: [],
      evidenceIds: [],
      origin: new URL(project.url).origin,
    };
    page.on("console", (msg) => {
      if (["error", "warning"].includes(msg.type())) {
        s.console.push(`${msg.type()}: ${msg.text().slice(0, 1000)}`);
        s.console = s.console.slice(-200);
      }
    });
    page.on("pageerror", (error) => {
      s.console.push(error.message.slice(0, 1000));
    });
    page.on("response", (response) => {
      const request = response.request();
      if (["xhr", "fetch", "document"].includes(request.resourceType())) {
        const timing = request.timing();
        s.network.push({
          url: safeURL(response.url()),
          method: request.method(),
          status: response.status(),
          duration: Math.max(0, timing.responseEnd),
        });
        s.network = s.network.slice(-300);
      }
    });
    page.on("dialog", async (dialog) => {
      log(
        s,
        `Dismissed browser dialog: ${dialog.type()}. Use manual control if it is required.`,
      );
      await dialog.dismiss().catch(() => {});
    });
    context.on("page", async (popup) => {
      if (s.mode === "AI") await popup.close().catch(() => {});
    });
    await page.goto(project.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    s.preview = (await page.screenshot({ type: "jpeg", quality: 65 })).toString(
      "base64",
    );
    sessions.set(projectId, s);
    log(
      s,
      "Browser connected. Complete login in the browser, then give control to AI.",
    );
    return state(s);
  } catch (e) {
    await browser.close();
    throw e;
  }
}
async function scan(page: Page): Promise<DiscoveryPage> {
  const result = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll(
        "a[href],button,input:not([type=hidden]),textarea,select,[role=button],table,h1,h2,.a-price",
      ),
    ]
      .filter(
        (el) =>
          (el as HTMLElement).offsetWidth > 0 ||
          (el as HTMLElement).offsetHeight > 0,
      )
      .slice(0, 150);
    const elements = candidates.map((el) => {
      const selector = el.id
        ? `#${CSS.escape(el.id)}`
        : el.getAttribute("data-testid")
          ? `[data-testid=${JSON.stringify(el.getAttribute("data-testid"))}]`
          : el.getAttribute("name")
            ? `${el.tagName.toLowerCase()}[name=${JSON.stringify(el.getAttribute("name"))}]`
            : (() => {
                const parts: string[] = [];
                let node: Element | null = el;
                while (node && node !== document.body) {
                  const current: Element = node;
                  const index =
                    Array.from(current.parentElement?.children || [])
                      .filter((e) => e.tagName === current.tagName)
                      .indexOf(current) + 1;
                  parts.unshift(
                    `${current.tagName.toLowerCase()}:nth-of-type(${index})`,
                  );
                  node = current.parentElement;
                }
                return `body > ${parts.join(" > ")}`;
              })();
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        (el as HTMLInputElement).labels?.[0]?.textContent ||
        (el as HTMLElement).innerText ||
        el.getAttribute("name") ||
        el.tagName;
      return {
        selector,
        type: el.tagName.toLowerCase(),
        label: label.trim().slice(0, 180),
        ...(el instanceof HTMLAnchorElement ? { href: el.href } : {}),
        ...(el.closest("form")
          ? {
              formMethod: el.closest("form")!.method,
              formAction: el.closest("form")!.action,
            }
          : {}),
      };
    });
    return {
      title: document.title,
      text: document.body.innerText.slice(0, 12000),
      elements,
    };
  });
  return { url: page.url(), ...result };
}
const risky =
  /delete|remove|destroy|purchase|pay\b|checkout|submit|approve|revoke|transfer|publish|send|invite|reset|logout|sign.?out|deactivate/i;
async function discover(s: Session, body: Record<string, unknown>) {
  const maxPages = Math.max(1, Math.min(50, Number(body.maxPages) || 10));
  const maxDepth = Math.max(0, Math.min(5, Number(body.maxDepth ?? 2)));
  const deadline =
    Date.now() + Math.max(1, Math.min(10, Number(body.timeLimit) || 3)) * 60000;
  const queue = [{ url: s.page.url(), depth: 0 }];
  const seen = new Set<string>();
  const pages: DiscoveryPage[] = [];
  s.busy = true;
  s.cancelled = false;
  s.state = "Discovering";
  try {
    while (queue.length && pages.length < maxPages && Date.now() < deadline) {
      await permission(s);
      const next = queue.shift()!;
      if (seen.has(next.url)) continue;
      seen.add(next.url);
      withinOrigin(s, next.url);
      log(
        s,
        `Discovering ${safeURL(next.url)} (${pages.length + 1}/${maxPages})`,
      );
      try {
        await s.page.goto(next.url, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      } catch {
        continue;
      }
      if (new URL(s.page.url()).origin !== s.origin) {
        s.mode = "Manual";
        log(
          s,
          "Authentication left the application. Complete login, then resume discovery.",
        );
        await permission(s);
        continue;
      }
      const found = await scan(s.page);
      pages.push(found);
      if (next.depth < maxDepth) {
        const links = await s.page.locator("a[href]").evaluateAll((els) =>
          els.map((el) => ({
            href: (el as HTMLAnchorElement).href,
            text: el.textContent || "",
          })),
        );
        for (const link of links) {
          try {
            const u = new URL(link.href);
            u.hash = "";
            if (
              u.origin === s.origin &&
              !risky.test(u.pathname + u.search + link.text) &&
              !/\.(pdf|zip|csv|xlsx|docx)$/i.test(u.pathname) &&
              !seen.has(u.href)
            )
              queue.push({ url: u.href, depth: next.depth + 1 });
          } catch {}
        }
      }
    }
    await mutate((store) => {
      const p = projectById(store, s.projectId);
      p.discovery = [
        ...p.discovery.filter(
          (old) => !pages.some((page) => page.url === old.url),
        ),
        ...pages,
      ].slice(-50);
      activity(p, `Discovered ${pages.length} application pages.`);
    });
    log(
      s,
      `Discovery complete: ${pages.length} pages. Review the map and generate tests.`,
    );
  } catch (e) {
    log(s, errorMessage(e));
  } finally {
    s.busy = false;
    s.state = "Connected";
  }
}
async function executeStep(
  s: Session,
  step: Step,
): Promise<{ detail: string; database?: unknown }> {
  await permission(s);
  if (new URL(s.page.url()).origin !== s.origin)
    throw new Error(
      "Browser left the application origin. Complete authentication manually.",
    );
  const locator = s.page.locator(step.target).first();
  let requiresHuman = !!step.humanApproval;
  if (step.action === "click") {
    const info = await locator.evaluate((el) => {
      const form = el.closest("form");
      return {
        label: [
          el.textContent,
          el.getAttribute("aria-label"),
          el.getAttribute("href"),
          (el as HTMLInputElement).value,
        ]
          .filter(Boolean)
          .join(" "),
        type:
          el.getAttribute("type") ||
          (el.tagName === "BUTTON" && form ? "submit" : ""),
        formMethod: form?.method || "",
        formAction: form?.action || "",
        isSearch:
          !!form &&
          (form.getAttribute("role") === "search" ||
            !!form.querySelector(
              'input[type="search"],input[name="q"],input[name="k"],input[name="query"],input[name="search"]',
            )),
      };
    });
    requiresHuman ||= clickRequiresHuman(info, s.origin);
  }
  if (step.action === "fill") {
    const sensitive = await locator.evaluate((el) =>
      /password|otp|one-time|captcha|credit.?card/i.test(
        [
          el.getAttribute("type"),
          el.getAttribute("autocomplete"),
          el.getAttribute("name"),
        ].join(" "),
      ),
    );
    requiresHuman ||= sensitive;
  }
  if (requiresHuman) {
    s.mode = "Manual";
    s.state = "Paused";
    log(
      s,
      `Human action required: ${step.action} ${step.target}. Complete this step in the controlled browser, then Resume AI.`,
    );
    if (s.runId)
      await mutate((store) => {
        const run = projectById(store, s.projectId).runs.find(
          (r) => r.id === s.runId,
        );
        if (run) run.status = "Paused";
      });
    await permission(s);
    return {
      detail:
        "Human completed this action; subsequent assertions verify the outcome.",
    };
  }
  switch (step.action) {
    case "navigate":
      await s.page.goto(withinOrigin(s, step.target), {
        waitUntil: "domcontentloaded",
      });
      break;
    case "click":
      await locator.click();
      break;
    case "fill":
      await locator.fill(step.value || "");
      break;
    case "select":
      await locator.selectOption(step.value || "");
      break;
    case "check":
      await locator.setChecked(step.value !== "false");
      break;
    case "assertVisible":
      await locator.waitFor({ state: "visible" });
      break;
    case "assertValue": {
      await s.page.waitForFunction(
        ({ selector, expected }) => {
          const el = document.querySelector(
            selector,
          ) as HTMLInputElement | null;
          return el?.value === expected;
        },
        { selector: step.target, expected: step.expected! },
        { timeout: 10000 },
      );
      break;
    }
    case "assertText": {
      await locator.waitFor({ state: "visible" });
      const expected = step.expected!;
      await s.page.waitForFunction(
        ({ selector, expected }) => {
          const el = document.querySelector(selector);
          return !!el?.textContent?.includes(expected);
        },
        { selector: step.target, expected },
        { timeout: 10000 },
      );
      break;
    }
    case "assertURL":
      await s.page.waitForURL((url) => url.href.includes(step.expected!), {
        timeout: 10000,
      });
      break;
    case "api": {
      const response = await s.context.request.get(
        withinOrigin(s, step.target),
        { timeout: 10000, maxRedirects: 0 },
      );
      s.network.push({
        url: safeURL(response.url()),
        method: "GET",
        status: response.status(),
        duration: 0,
      });
      if (String(response.status()) !== step.expected)
        throw new Error(
          `Expected HTTP ${step.expected}; received ${response.status()}.`,
        );
      if (step.value && !(await response.text()).includes(step.value))
        throw new Error("API response did not contain the expected value.");
      return {
        detail: `GET returned expected HTTP ${response.status()}${step.value ? " and expected response content" : ""}.`,
      };
    }
    case "database": {
      const data = await verifyDatabase(step.target);
      if (data.rows !== Number(step.expected))
        throw new Error(
          `Expected ${step.expected} records; found ${data.rows}.`,
        );
      return {
        detail: `Verified ${data.rows} records in a read-only transaction.`,
        database: data,
      };
    }
    default:
      throw new Error("Unsupported action.");
  }
  return {
    detail: [
      "assertVisible",
      "assertText",
      "assertValue",
      "assertURL",
    ].includes(step.action)
      ? `Verified ${step.expected || "element visibility"}.`
      : "Action completed.",
  };
}
async function runTests(s: Session, tests: TestCase[], runId: string) {
  s.runId = runId;
  s.busy = true;
  s.cancelled = false;
  s.state = "Running";
  try {
    for (const test of tests) {
      await permission(s);
      s.currentTest = test.title;
      s.network = [];
      s.console = [];
      const resultId = id("RES");
      const started = Date.now();
      const result: Result = {
        id: resultId,
        runId,
        testId: test.id,
        version: test.version,
        title: test.title,
        requirementIds: test.requirementIds,
        status: "Passed",
        expected: test.expected,
        actual: "All approved steps and assertions passed.",
        impact: "The tested outcome matched the expected behavior.",
        likelyCause: "",
        confidence: null,
        startedAt: new Date().toISOString(),
        duration: 0,
        steps: [],
        console: [],
        network: [],
      };
      await s.context.tracing.startChunk({ title: test.title });
      let assertions = 0;
      for (let i = 0; i < test.steps.length; i++) {
        const step = test.steps[i];
        s.currentStep = i + 1;
        log(s, `${test.title}: ${step.action} (${i + 1}/${test.steps.length})`);
        const stepStart = Date.now();
        try {
          const executed = await executeStep(s, step);
          if (
            step.action.startsWith("assert") ||
            ["api", "database"].includes(step.action)
          )
            assertions++;
          s.preview =
            (
              await s.page
                .screenshot({ type: "jpeg", quality: 65, timeout: 3000 })
                .catch(() => Buffer.alloc(0))
            ).toString("base64") || s.preview;
          if (executed.database) result.database = executed.database;
          result.steps.push({
            ...step,
            status: "Passed",
            detail: executed.detail,
            duration: Date.now() - stepStart,
          });
        } catch (e) {
          result.status =
            s.cancelled ||
            s.page.isClosed() ||
            /not configured/.test(errorMessage(e))
              ? "Warning"
              : "Failed";
          result.actual = s.cancelled
            ? "The run was cancelled before validation finished."
            : `The application did not complete step ${i + 1}: ${step.action}.`;
          result.impact = "This workflow has not been validated for release.";
          result.likelyCause = s.cancelled
            ? "Execution interrupted by the user."
            : "The expected element, application state, or connected service was unavailable. Review technical evidence to determine the cause.";
          result.steps.push({
            ...step,
            status: result.status,
            detail: errorMessage(e),
            duration: Date.now() - stepStart,
          });
          break;
        }
      }
      if (!assertions && result.status === "Passed") {
        result.status = "Warning";
        result.actual =
          "Actions completed, but no outcome assertion was verified.";
      }
      result.duration = Date.now() - started;
      result.console = [...s.console];
      result.network = [...s.network];
      try {
        await s.page.screenshot({
          path: path.join(evidenceDir, `${resultId}.png`),
          fullPage: true,
          timeout: 5000,
        });
        result.screenshot = `${resultId}.png`;
      } catch {}
      try {
        await s.context.tracing.stopChunk({
          path: path.join(evidenceDir, `${resultId}.zip`),
        });
        result.trace = `${resultId}.zip`;
      } catch {}
      if (result.status === "Passed" && (!result.screenshot || !result.trace)) {
        result.status = "Warning";
        result.actual =
          "Assertions completed, but required screenshot or trace evidence could not be saved.";
        result.impact =
          "Review or re-run before treating this workflow as validated.";
      }
      s.evidenceIds.push(result.id);
      await mutate((store) => {
        const p = projectById(store, s.projectId);
        p.results.push(result);
        for (const issue of p.issues.filter((i) => i.testId === test.id)) {
          issue.resultIds.push(result.id);
          issue.status = result.status === "Passed" ? "Verified" : "Open";
        }
        activity(p, `${test.title}: ${result.status}.`);
      });
      if (s.cancelled) break;
    }
    await mutate((store) => {
      const p = projectById(store, s.projectId);
      const run = p.runs.find((r) => r.id === runId)!;
      run.status = s.cancelled ? "Cancelled" : "Completed";
      run.finishedAt = new Date().toISOString();
      for (const issue of p.issues.filter((i) => i.status === "Re-testing"))
        issue.status = "Fixed";
      activity(p, `Test run ${run.status.toLowerCase()}.`);
    });
    log(
      s,
      s.cancelled
        ? "Run cancelled. Partial evidence has been saved."
        : "Run complete. Results and evidence are ready.",
    );
  } catch (e) {
    await mutate((store) => {
      const p = projectById(store, s.projectId);
      const r = p.runs.find((r) => r.id === runId)!;
      r.status = s.cancelled ? "Cancelled" : "Error";
      r.error = errorMessage(e);
      r.finishedAt = new Date().toISOString();
      for (const issue of p.issues.filter((i) => i.status === "Re-testing"))
        issue.status = "Fixed";
    });
    log(s, errorMessage(e));
  } finally {
    s.busy = false;
    s.state = "Connected";
    s.currentStep = undefined;
    s.currentTest = undefined;
  }
}
async function command(name: string, body: Record<string, unknown>) {
  const projectId = String(body.projectId);
  const s = sessions.get(projectId);
  if (name === "connect") return connect(projectId);
  if (name === "status") return state(s);
  if (!s || s.page.isClosed())
    throw new Error("Connect the application first.");
  if (name === "pause") {
    s.mode = "Manual";
    s.state = s.busy ? "Paused" : "Connected";
    log(
      s,
      "You have control. Any in-flight step will finish before the next action pauses.",
    );
    if (s.busy && s.runId)
      await mutate((store) => {
        const run = projectById(store, projectId).runs.find(
          (r) => r.id === s.runId,
        );
        if (run && run.status === "Running") run.status = "Paused";
      });
  } else if (name === "resume") {
    s.mode = "AI";
    s.state = s.busy ? (s.runId ? "Running" : "Discovering") : "Connected";
    log(s, "AI has control.");
    if (s.busy && s.runId)
      await mutate((store) => {
        const run = projectById(store, projectId).runs.find(
          (r) => r.id === s.runId,
        );
        if (run && run.status === "Paused") run.status = "Running";
      });
  } else if (name === "cancel") {
    s.cancelled = true;
    log(s, "Stopping after the current action.");
  } else if (name === "disconnect") {
    if (s.busy)
      throw new Error("Stop the current operation before disconnecting.");
    const video = s.page.video();
    await s.context.close();
    await s.browser.close();
    if (video) {
      const file = path.basename(await video.path());
      await mutate((store) => {
        for (const result of projectById(store, projectId).results.filter((r) =>
          s.evidenceIds.includes(r.id),
        ))
          result.video = file;
      });
    }
    sessions.delete(projectId);
    return state();
  } else if (name === "discover") {
    if (s.busy) throw new Error("A browser operation is already running.");
    if (s.mode !== "AI")
      throw new Error(
        "Complete login and give control to AI before discovery.",
      );
    s.runId = undefined;
    void discover(s, body);
  } else if (name === "run") {
    if (s.busy) throw new Error("A browser operation is already running.");
    if (s.mode !== "AI")
      throw new Error("Give control to AI before running tests.");
    const p = projectById(await readStore(), projectId);
    if (new URL(p.url).origin !== s.origin)
      throw new Error(
        "Application URL changed. Disconnect and reconnect first.",
      );
    const ids = Array.isArray(body.testIds)
      ? body.testIds.map(String)
      : p.tests.filter((t) => t.approved).map((t) => t.id);
    const tests = p.tests.filter((t) => ids.includes(t.id));
    for (const test of tests) validateSteps(test.steps);
    if (
      !tests.length ||
      tests.length !== new Set(ids).size ||
      tests.some((t) => !t.approved)
    )
      throw new Error("Select existing approved tests to run.");
    if (
      tests.some(
        (t) =>
          !t.steps.some(
            (step) =>
              step.action.startsWith("assert") ||
              ["api", "database"].includes(step.action),
          ),
      )
    )
      throw new Error(
        "Every test needs at least one UI, API, or database assertion.",
      );
    const runId = id("RUN");
    s.busy = true;
    try {
      await mutate((store) => {
        const project = projectById(store, projectId);
        if (
          project.url !== p.url ||
          tests.some(
            (test) =>
              !project.tests.some(
                (current) =>
                  current.id === test.id &&
                  current.version === test.version &&
                  current.approved,
              ),
          )
        )
          throw new Error(
            "The test plan changed. Refresh and approve the current versions before running.",
          );
        if (project.runs.some((r) => ["Running", "Paused"].includes(r.status)))
          throw new Error("A run is already active.");
        project.runs.push({
          id: runId,
          status: "Running",
          testIds: tests.map((t) => t.id),
          startedAt: new Date().toISOString(),
        });
        for (const issue of project.issues.filter((i) =>
          ids.includes(i.testId),
        ))
          issue.status = "Re-testing";
        activity(project, `Started ${tests.length} approved tests.`);
      });
    } catch (e) {
      s.busy = false;
      throw e;
    }
    void runTests(s, tests, runId);
  } else if (name === "screenshot") {
    if (s.busy) return { image: s.preview || null };
    return {
      image: (
        await s.page.screenshot({ type: "jpeg", quality: 65, timeout: 3000 })
      ).toString("base64"),
    };
  } else throw new Error("Unknown browser command.");
  return state(s);
}
async function main() {
  const token = await agentToken();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "Unauthorized local agent request." }));
      return;
    }
    if (req.url === "/health") {
      res.end(JSON.stringify({ online: true }));
      return;
    }
    try {
      if (req.method !== "POST") throw new Error("Use POST.");
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2000000) throw new Error("Request too large.");
      }
      const result = await command(req.url!.slice(1), JSON.parse(raw));
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: errorMessage(e) }));
    }
  });
  server.once("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  const shutdown = async () => {
    for (const session of sessions.values()) {
      session.cancelled = true;
      await session.browser.close().catch(() => {});
    }
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(4318, "127.0.0.1", async () => {
    await mutate((store) => {
      for (const p of store.projects) {
        for (const run of p.runs.filter((r) =>
          ["Running", "Paused"].includes(r.status),
        )) {
          run.status = "Error";
          run.error =
            "The agent restarted before this run completed. Reconnect and re-run the tests.";
          run.finishedAt = new Date().toISOString();
        }
        for (const issue of p.issues.filter((i) => i.status === "Re-testing"))
          issue.status = "Fixed";
      }
    });
    console.log("AI QA Studio browser agent listening on 127.0.0.1:4318");
  });
}
void main();
