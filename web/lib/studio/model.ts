export type Status = "Passed" | "Failed" | "Warning" | "Not run";
export type Step = {
  action:
    | "navigate"
    | "click"
    | "fill"
    | "select"
    | "check"
    | "assertVisible"
    | "assertText"
    | "assertValue"
    | "assertURL"
    | "api"
    | "database";
  target: string;
  value?: string;
  expected?: string;
  humanApproval?: boolean;
};
export type Requirement = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  source: string;
  mapping?: { url: string; confidence: number; reason: string };
};
export type TestCase = {
  id: string;
  requirementIds: string[];
  title: string;
  expected: string;
  steps: Step[];
  approved: boolean;
  kind: string;
  version: number;
};
export type StepResult = Step & {
  status: Status;
  detail: string;
  duration: number;
};
export type Result = {
  id: string;
  runId: string;
  testId: string;
  version: number;
  title: string;
  requirementIds: string[];
  status: Status;
  expected: string;
  actual: string;
  impact: string;
  likelyCause: string;
  confidence: number | null;
  startedAt: string;
  duration: number;
  steps: StepResult[];
  screenshot?: string;
  trace?: string;
  video?: string;
  console: string[];
  network: { url: string; method: string; status: number; duration: number }[];
  database?: unknown;
};
export type Issue = {
  id: string;
  title: string;
  testId: string;
  requirementIds: string[];
  resultIds: string[];
  severity: "Critical" | "High" | "Medium" | "Low";
  status:
    "Open" | "In Progress" | "Fixed" | "Re-testing" | "Verified" | "Closed";
  notes: string;
  createdAt: string;
};
export type DiscoveryPage = {
  url: string;
  title: string;
  text: string;
  elements: {
    selector: string;
    type: string;
    label: string;
    href?: string;
    formMethod?: string;
    formAction?: string;
  }[];
};
export type Run = {
  id: string;
  status: "Running" | "Paused" | "Completed" | "Cancelled" | "Error";
  testIds: string[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  url: string;
  environment: "Local" | "Staging" | "Test";
  owner: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
  requirements: Requirement[];
  tests: TestCase[];
  results: Result[];
  issues: Issue[];
  runs: Run[];
  discovery: DiscoveryPage[];
  documents: {
    id: string;
    name: string;
    kind: string;
    uploadedAt: string;
    count: number;
  }[];
  signoffs: {
    id: string;
    name: string;
    note: string;
    at: string;
    fingerprint: string;
  }[];
  qaValidation?: { name: string; at: string; fingerprint: string };
  activity: { at: string; message: string }[];
};
export type Studio = { version: 1; projects: Project[] };
export const issueStates: Issue["status"][] = [
  "Open",
  "In Progress",
  "Fixed",
  "Re-testing",
  "Verified",
  "Closed",
];
export const actions: Step["action"][] = [
  "navigate",
  "click",
  "fill",
  "select",
  "check",
  "assertVisible",
  "assertText",
  "assertValue",
  "assertURL",
  "api",
  "database",
];
export function hasVerifiedEvidence(result: Result, test: TestCase) {
  return (
    !!result.screenshot &&
    !!result.trace &&
    result.steps.length === test.steps.length &&
    result.steps.every(
      (step, index) =>
        step.status === "Passed" &&
        ["action", "target", "value", "expected", "humanApproval"].every(
          (key) =>
            (step[key as keyof Step] ?? null) ===
            (test.steps[index][key as keyof Step] ?? null),
        ),
    ) &&
    result.steps.some(
      (step) =>
        (step.action.startsWith("assert") ||
          ["api", "database"].includes(step.action)) &&
        !step.humanApproval,
    )
  );
}
export function latestResults(p: Project) {
  return p.tests
    .map((t) => {
      const attempt = [...p.runs]
        .reverse()
        .find((run) => run.testIds.includes(t.id));
      const result = [...p.results]
        .reverse()
        .find(
          (r) =>
            r.testId === t.id &&
            r.version === t.version &&
            (!attempt || r.runId === attempt.id),
        );
      return result?.status === "Passed" && !hasVerifiedEvidence(result, t)
        ? {
            ...result,
            status: "Warning" as const,
            actual:
              "Saved pass lacks a complete matching execution and evidence. Re-run the current test.",
          }
        : result;
    })
    .filter((r): r is Result => !!r);
}
export function fingerprint(p: Project) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined && v !== null)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  return JSON.stringify(
    canonical({
      requirements: p.requirements,
      tests: p.tests,
      results: latestResults(p).map((r) => r.id),
      issues: p.issues.map((i) => [i.id, i.status, i.severity]),
      url: p.url,
      latestRun: p.runs.at(-1)?.id,
    }),
  );
}
export function metrics(p: Project) {
  const results = latestResults(p);
  const passed = results.filter((r) => r.status === "Passed").length;
  const failed = results.filter((r) => r.status === "Failed").length;
  const warnings = results.filter((r) => r.status === "Warning").length;
  const validated = p.requirements.filter((req) => {
    const tests = p.tests.filter((t) => t.requirementIds.includes(req.id));
    return (
      tests.length > 0 &&
      tests.every((t) =>
        results.some((r) => r.testId === t.id && r.status === "Passed"),
      )
    );
  }).length;
  const openIssues = p.issues.filter(
    (i) => !["Verified", "Closed"].includes(i.status),
  );
  const blocking = openIssues.filter((i) =>
    ["Critical", "High"].includes(i.severity),
  ).length;
  const coverage = p.requirements.length
    ? Math.round((validated / p.requirements.length) * 100)
    : 0;
  const ready =
    p.requirements.length > 0 &&
    p.tests.length > 0 &&
    validated === p.requirements.length &&
    passed === p.tests.length &&
    !blocking &&
    !["Error", "Cancelled"].includes(p.runs.at(-1)?.status || "") &&
    !p.runs.some((r) => ["Running", "Paused"].includes(r.status));
  const fp = fingerprint(p);
  const qa = p.qaValidation?.fingerprint === fp;
  const signed = ready && qa && p.signoffs.some((s) => s.fingerprint === fp);
  return {
    passed,
    failed,
    warnings,
    executed: results.length,
    validated,
    coverage,
    openIssues: openIssues.length,
    blocking,
    ready,
    qa,
    signed,
    state: !ready
      ? "Not ready"
      : openIssues.length
        ? "Needs attention"
        : !signed
          ? "Needs sign-off"
          : "Ready",
  };
}
