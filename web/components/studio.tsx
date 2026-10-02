"use client";
/* The browser preview is a local, authenticated screenshot endpoint. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Code2,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  FolderKanban,
  Home,
  Layers,
  ListChecks,
  Loader2,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  actions,
  fingerprint,
  issueStates,
  latestResults,
  metrics,
  type Issue,
  type Project,
  type Requirement,
  type Result,
  type TestCase,
} from "../lib/studio/model";

type Agent = {
  online: boolean;
  connected: boolean;
  mode: string;
  state: string;
  message: string;
  currentTest?: string;
  currentStep?: number;
  logs: { at: string; message: string }[];
  url?: string;
};
type Modal =
  | { type: "requirement"; item?: Requirement }
  | { type: "test"; item?: TestCase }
  | { type: "result"; item: Result }
  | { type: "issue"; item: Issue }
  | { type: "help" }
  | { type: "generate" }
  | null;
const nav = [
  { key: "preparation", label: "Preparation", icon: ClipboardCheck },
  { key: "workspace", label: "Test workspace", icon: Monitor },
  { key: "results", label: "Results", icon: Activity },
  { key: "release", label: "Release manager", icon: ShieldCheck },
];
const offline: Agent = {
  online: false,
  connected: false,
  mode: "Manual",
  state: "Disconnected",
  message: "Connect your application to start a browser session.",
  logs: [],
};
const date = (s?: string) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No runs yet";
function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon = FolderKanban,
  title,
  children,
  action,
}: {
  icon?: typeof FolderKanban;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Button({
  children,
  onClick,
  disabled,
  primary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`button ${primary ? "primary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function tone(status: string) {
  return /Passed|Verified|Closed|Ready|Connected/.test(status)
    ? "green"
    : /Failed|Critical|High|Not ready|Error/.test(status)
      ? "red"
      : /Warning|attention|Paused|Open/.test(status)
        ? "amber"
        : "purple";
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Studio({
  view = "home",
  projectId,
}: {
  view?: string;
  projectId?: string;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState<Modal>(null);
  const [agent, setAgent] = useState<Agent>(offline);
  const [ai, setAI] = useState({ provider: "", model: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [useAI, setUseAI] = useState(true);
  const [preview, setPreview] = useState(0);
  const [limits, setLimits] = useState({
    maxPages: 10,
    maxDepth: 2,
    timeLimit: 3,
  });
  const modalRef = useRef<HTMLDialogElement>(null);
  const p = projects.find((p) => p.id === projectId);
  const m = p ? metrics(p) : null;
  const path = (key: string) => `/projects/${projectId}/${key}`;
  const refresh = useCallback(async () => {
    const response = await fetch("/api/studio", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setProjects(data.projects);
    setAI(data.ai);
    setLoaded(true);
  }, []);
  useEffect(() => {
    let mounted = true;
    const tick = () =>
      refresh().catch((e) => {
        if (mounted) {
          setError(e.message);
          setLoaded(true);
        }
      });
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const tick = async () => {
      try {
        const response = await fetch("/api/studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", projectId }),
        });
        const data = await response.json();
        if (active) setAgent(response.ok ? data : offline);
      } catch {
        if (active) setAgent(offline);
      }
    };
    tick();
    const timer = setInterval(tick, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId]);
  useEffect(() => {
    if (!agent.connected || view !== "workspace") return;
    const timer = setInterval(() => setPreview(Date.now()), 3000);
    return () => clearInterval(timer);
  }, [agent.connected, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (modal) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [modal]);
  async function act(
    action: string,
    values: Record<string, unknown> = {},
    message = "Changes saved.",
  ) {
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, projectId, ...values }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh();
      if (data.online) setAgent(data);
      setNotice(message);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      return null;
    } finally {
      setBusy("");
    }
  }
  async function upload(file: File | undefined, kind: string) {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", projectId!);
      form.set("kind", kind);
      form.set("useAI", String(useAI));
      const response = await fetch("/api/studio", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh();
      setNotice("Upload processed. Review the imported items below.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const result = await act(action, { ...data, ...extra });
    if (result) setModal(null);
    return result;
  }
  const running = ["Running", "Paused", "Discovering"].includes(agent.state);
  const locked = !!busy || running;
  const allResults = p ? latestResults(p) : [];
  const results = allResults.filter(
    (r) =>
      (filter === "All" || r.status === filter) &&
      `${r.title} ${r.actual}`.toLowerCase().includes(search.toLowerCase()),
  );
  const analyzed = allResults.filter(
    (r) => typeof r.confidence === "number" && Number.isFinite(r.confidence),
  );
  const title =
    view === "home"
      ? "Projects"
      : view === "new"
        ? "Create a new project"
        : {
            preparation: "Preparation",
            workspace: "Test workspace",
            results: "Results & evidence",
            issues: "Issue tracker",
            release: "Release manager",
            settings: "Project settings",
            reports: "Reports",
          }[view] || "Projects";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <FlaskConical size={22} />
          </span>
          <span>
            AI QA Studio<span className="brand-sub">PRODUCT VALIDATION</span>
          </span>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>LOCAL</span>
        </div>
        {p && (
          <div className="project-switch">
            <span className="project-letter">{p.name[0]}</span>
            <div>
              <strong>{p.name}</strong>
              <small>
                <i className="dot" /> {p.environment} environment
              </small>
            </div>
          </div>
        )}
        <nav>
          <Link href="/" className={!p && view !== "new" ? "active" : ""}>
            <Home size={18} />
            Overview
          </Link>
          <Link href="/projects/new" className={view === "new" ? "active" : ""}>
            <FolderKanban size={18} />
            {p ? "New project" : "Create project"}
          </Link>
          {p ? (
            <>
              <div className="nav-caption">VALIDATION WORKFLOW</div>
              {nav.map((n) => (
                <Link
                  key={n.key}
                  href={path(n.key)}
                  className={view === n.key ? "active" : ""}
                >
                  <n.icon size={18} />
                  {n.label}
                  {view === n.key && <span className="nav-active-dot" />}
                </Link>
              ))}
              <div className="nav-caption">MANAGE</div>
              <Link
                href={path("issues")}
                className={view === "issues" ? "active" : ""}
              >
                <ListChecks size={18} />
                Issues <span className="nav-count">{m?.openIssues}</span>
              </Link>
              <Link
                href={path("reports")}
                className={view === "reports" ? "active" : ""}
              >
                <FileText size={18} />
                Reports
              </Link>
              <Link
                href={path("settings")}
                className={view === "settings" ? "active" : ""}
              >
                <Settings2 size={18} />
                Settings
              </Link>
            </>
          ) : (
            <div className="nav-note">
              <Layers size={20} />
              <p>
                One evidence chain.
                <br />
                From product intent
                <br />
                to a confident release.
              </p>
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="help-button"
            onClick={() => setModal({ type: "help" })}
          >
            <BookOpen size={17} />
            Workspace guide <ArrowUpRight size={15} />
          </button>
          <div className="user">
            <span className="avatar">
              {p?.owner?.slice(0, 2).toUpperCase() || "QA"}
            </span>
            <div>
              <strong>{p?.owner || "Your workspace"}</strong>
              <small>Local workspace owner</small>
            </div>
            <span className="user-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            {p && (
              <>
                <Link href={path("preparation")}>{p.name}</Link>
                <ChevronRight size={14} />
              </>
            )}
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <span className="dot" /> Local-first workspace
            </span>
            <button
              aria-label="Open workspace guide"
              className="icon-button"
              onClick={() => setModal({ type: "help" })}
            >
              <BookOpen size={18} />
            </button>
            <span className="avatar small">QA</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {p
                  ? `${p.name} / ${p.environment}`
                  : "YOUR QUALITY COMMAND CENTER"}
              </div>
              <h1>{title}</h1>
              <p>
                {view === "home"
                  ? "Everything you’re building. Everything you’ve validated."
                  : view === "new"
                    ? "Bring your requirements, application, and team into one workspace."
                    : view === "preparation"
                      ? "Turn product intent into a test plan you can trust."
                      : view === "workspace"
                        ? "Explore your application, review tests, and stay in control."
                        : view === "results"
                          ? "Understand what works, what failed, and the evidence behind it."
                          : view === "release"
                            ? "Make your release decision with a complete evidence trail."
                            : view === "issues"
                              ? "Connect every fix to the test that proves it works."
                              : "Keep your validation workspace up to date."}
              </p>
            </div>
            <div className="heading-actions">
              {view === "home" && (
                <Link className="button primary" href="/projects/new">
                  <Plus size={17} />
                  New project
                </Link>
              )}
              {p && view !== "settings" && (
                <Badge tone={tone(m!.state)}>
                  <span className="status-dot" />
                  {m!.state}
                </Badge>
              )}
            </div>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {busy && (
            <div className="busy-bar" role="status">
              <Loader2 className="spin" size={16} />
              {busy === "upload"
                ? "Processing your upload…"
                : busy === "generateTests" || busy === "map"
                  ? "AI is analyzing the application context…"
                  : "Working…"}
            </div>
          )}
          {!loaded ? (
            <Empty title="Loading your workspace…" icon={Loader2}>
              Reading saved projects and validation history.
            </Empty>
          ) : projectId && !p ? (
            <Empty title="Project not found">
              This project is no longer available.{" "}
              <Link href="/">Return to overview</Link>
            </Empty>
          ) : (
            <>
              {p && nav.some((n) => n.key === view) && (
                <div className="stepper">
                  {nav.map((n, i) => (
                    <Link
                      className={view === n.key ? "current" : ""}
                      key={n.key}
                      href={path(n.key)}
                    >
                      <span>{i + 1}</span>
                      {n.label}
                      <ChevronRight size={14} />
                    </Link>
                  ))}
                </div>
              )}
              {view === "home" && (
                <>
                  <div className="stats-grid">
                    <Stat
                      label="Total projects"
                      value={projects.length}
                      icon={FolderKanban}
                      note="Your connected workspaces"
                    />
                    <Stat
                      label="Requirements"
                      value={projects.reduce(
                        (s, p) => s + p.requirements.length,
                        0,
                      )}
                      icon={FileText}
                      note="Product intent, captured"
                    />
                    <Stat
                      label="Tests passed"
                      value={projects.reduce(
                        (s, p) => s + metrics(p).passed,
                        0,
                      )}
                      icon={CheckCircle2}
                      note="Verified in the latest results"
                      color="green"
                    />
                    <Stat
                      label="Open issues"
                      value={projects.reduce(
                        (s, p) => s + metrics(p).openIssues,
                        0,
                      )}
                      icon={Activity}
                      note="Awaiting a verified fix"
                      color="amber"
                    />
                  </div>
                  <div className="section-toolbar">
                    <div>
                      <h2>
                        All projects{" "}
                        <span className="count">{projects.length}</span>
                      </h2>
                      <p>A clear view of quality across your applications.</p>
                    </div>
                    <SearchBox
                      value={search}
                      set={setSearch}
                      placeholder="Search projects…"
                    />
                  </div>
                  <div className="project-grid">
                    {projects
                      .filter((p) =>
                        `${p.name} ${p.owner}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((p, index) => {
                        const m = metrics(p);
                        return (
                          <Link
                            className="project-card"
                            href={`/projects/${p.id}/preparation`}
                            key={p.id}
                          >
                            <div className="project-card-top">
                              <span
                                className={`project-logo variant-${index % 3}`}
                              >
                                <Box size={22} />
                              </span>
                              <Badge tone={tone(m.state)}>{m.state}</Badge>
                            </div>
                            <h3>{p.name}</h3>
                            <p className="project-url">
                              {p.url.replace(/^https?:\/\//, "")}
                            </p>
                            <div className="project-numbers">
                              <div>
                                <strong>{p.requirements.length}</strong>
                                <small>Requirements</small>
                              </div>
                              <div>
                                <strong>{p.tests.length}</strong>
                                <small>Tests</small>
                              </div>
                              <div>
                                <strong className="text-green">
                                  {m.passed}
                                </strong>
                                <small>Passed</small>
                              </div>
                              <div>
                                <strong className="text-red">{m.failed}</strong>
                                <small>Failed</small>
                              </div>
                            </div>
                            <div className="coverage-label">
                              <span>Requirement coverage</span>
                              <strong>{m.coverage}%</strong>
                            </div>
                            <div className="progress">
                              <span style={{ width: `${m.coverage}%` }} />
                            </div>
                            <div className="project-footer">
                              <span>
                                <i className="dot" />
                                {p.environment} · {p.owner}
                              </span>
                              <ArrowUpRight size={17} />
                            </div>
                          </Link>
                        );
                      })}
                    <Link className="new-project-card" href="/projects/new">
                      <span>
                        <Plus size={25} />
                      </span>
                      <h3>Start something new</h3>
                      <p>
                        Connect your next application
                        <br />
                        and bring quality into focus.
                      </p>
                      <strong>
                        Create a project <ArrowRight size={15} />
                      </strong>
                    </Link>
                  </div>
                  <div className="bottom-banner">
                    <span className="banner-icon">
                      <Sparkles size={24} />
                    </span>
                    <div>
                      <h3>From requirements to release. Connected.</h3>
                      <p>
                        Upload your PRD, validate your application, and make
                        every release evidence-backed.
                      </p>
                    </div>
                    <button onClick={() => setModal({ type: "help" })}>
                      Explore the workflow <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {view === "new" && (
                <div className="two-column create-layout">
                  <form
                    className="panel padded"
                    onSubmit={async (e) => {
                      const data = await submit(e, "createProject");
                      if (data)
                        router.push(`/projects/${data.projectId}/preparation`);
                    }}
                  >
                    <h2>Project details</h2>
                    <p className="muted">
                      Start with your staging or local application.
                    </p>
                    <Field label="Project name *">
                      <input
                        name="name"
                        required
                        maxLength={100}
                        placeholder="e.g. Partner Portal"
                        autoFocus
                      />
                    </Field>
                    <Field label="Description">
                      <textarea
                        name="description"
                        maxLength={3000}
                        placeholder="What does your team want to validate?"
                        rows={3}
                      />
                    </Field>
                    <Field label="Application URL *">
                      <input
                        name="url"
                        required
                        type="url"
                        placeholder="https://staging.yourapp.com"
                      />
                    </Field>
                    <div className="form-row">
                      <Field label="Environment">
                        <select name="environment">
                          <option>Staging</option>
                          <option>Local</option>
                          <option>Test</option>
                        </select>
                      </Field>
                      <Field label="Project owner *">
                        <input
                          name="owner"
                          required
                          maxLength={100}
                          placeholder="Your name"
                        />
                      </Field>
                    </div>
                    <Field label="Team members">
                      <input
                        name="members"
                        placeholder="Names, separated by commas"
                      />
                    </Field>
                    <div className="form-footer">
                      <Link className="button" href="/">
                        Cancel
                      </Link>
                      <Button primary type="submit" disabled={!!busy}>
                        Create project <ArrowRight size={16} />
                      </Button>
                    </div>
                  </form>
                  <div className="onboarding-card">
                    <span className="onboarding-art">
                      <Layers size={48} />
                      <Sparkles size={24} />
                    </span>
                    <h2>A clear path to release</h2>
                    <p>One project. A complete validation story.</p>
                    {[
                      ["Prepare", "Upload requirements and connect your app."],
                      [
                        "Explore & test",
                        "Review generated tests and run the approved plan.",
                      ],
                      [
                        "Understand",
                        "See results, evidence, and actionable issues.",
                      ],
                      [
                        "Release",
                        "Verify fixes and record your final sign-off.",
                      ],
                    ].map(([t, d], i) => (
                      <div className="onboarding-step" key={t}>
                        <span>{i + 1}</span>
                        <div>
                          <strong>{t}</strong>
                          <p>{d}</p>
                        </div>
                      </div>
                    ))}
                    <div className="local-callout">
                      <ShieldCheck size={18} />
                      Projects and evidence stay on this machine. AI requests
                      use your configured provider.
                    </div>
                  </div>
                </div>
              )}
              {p && view === "preparation" && (
                <>
                  <div className="two-column prep-layout">
                    <div className="stack">
                      <section className="panel">
                        <PanelHeader
                          icon={FileText}
                          number="1"
                          title="PRD & requirements"
                          subtitle="Define what your application should do."
                          right={
                            <Button
                              onClick={() => setModal({ type: "requirement" })}
                              disabled={locked}
                            >
                              <Plus size={15} />
                              Add requirement
                            </Button>
                          }
                        />
                        <div className="panel-body">
                          <label
                            className={`dropzone ${locked ? "disabled" : ""}`}
                          >
                            <Upload size={25} />
                            <strong>Choose a PRD to upload</strong>
                            <span>PDF, DOCX, TXT, Markdown · up to 10 MB</span>
                            <input
                              type="file"
                              aria-label="Upload requirements"
                              accept=".pdf,.docx,.txt,.md"
                              disabled={locked}
                              onChange={(e) => {
                                upload(e.target.files?.[0], "requirements");
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={useAI}
                              onChange={(e) => setUseAI(e.target.checked)}
                            />
                            Use AI to extract requirements and convert
                            natural-language tests
                          </label>
                          <small className="muted">
                            With AI off, document paragraphs are imported for
                            manual review.
                          </small>
                          {p.documents
                            .filter((d) => d.kind === "requirements")
                            .map((d) => (
                              <div className="file-row" key={d.id}>
                                <FileText size={21} />
                                <div>
                                  <strong>{d.name}</strong>
                                  <small>
                                    {d.count} requirements ·{" "}
                                    {date(d.uploadedAt)}
                                  </small>
                                </div>
                                <Badge tone="green">Processed</Badge>
                              </div>
                            ))}
                        </div>
                      </section>
                      <section className="panel">
                        <PanelHeader
                          icon={ListChecks}
                          number="2"
                          title="Existing test cases"
                          subtitle="Bring your test plan, or generate one in the workspace."
                          right={<Badge>Optional</Badge>}
                        />
                        <div className="panel-body">
                          <div className="upload-inline">
                            <span className="file-icon">
                              <ListChecks size={24} />
                            </span>
                            <div>
                              <strong>Import an Excel or CSV test plan</strong>
                              <p>
                                Executable steps or natural-language workflows.
                              </p>
                            </div>
                            <label className="button">
                              Import tests
                              <input
                                type="file"
                                aria-label="Import test cases"
                                accept=".xlsx,.csv"
                                disabled={locked}
                                onChange={(e) => {
                                  upload(e.target.files?.[0], "tests");
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          </div>
                          <button
                            className="text-button"
                            onClick={() =>
                              download(
                                "test-case-template.csv",
                                'title,expected,steps,requirementIds,kind\n"Page is visible","Page has a visible body","[{""action"":""navigate"",""target"":""/""},{""action"":""assertVisible"",""target"":""body""}]","","Smoke"\n',
                                "text/csv",
                              )
                            }
                          >
                            Download CSV template <Download size={13} />
                          </button>
                          {p.documents
                            .filter((d) => d.kind === "tests")
                            .map((d) => (
                              <div className="file-row" key={d.id}>
                                <ListChecks size={20} />
                                <div>
                                  <strong>{d.name}</strong>
                                  <small>{d.count} draft tests imported</small>
                                </div>
                                <Badge tone="green">Processed</Badge>
                              </div>
                            ))}
                        </div>
                      </section>
                      <section className="panel">
                        <PanelHeader
                          icon={Monitor}
                          number="3"
                          title="Connect your application"
                          subtitle="Use a staging, test, or local environment."
                          right={
                            <Badge tone={agent.connected ? "green" : ""}>
                              {agent.connected ? "Connected" : "Not connected"}
                            </Badge>
                          }
                        />
                        <div className="panel-body">
                          <div className="url-display">
                            <span>
                              <Monitor size={16} />
                              {p.url}
                            </span>
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open application"
                            >
                              <ExternalLink size={16} />
                            </a>
                          </div>
                          <div className="row spread">
                            <span className="muted">
                              {agent.connected
                                ? "Complete login in the controlled browser."
                                : "Launch a visible browser for login and testing."}
                            </span>
                            <Button
                              primary
                              disabled={!!busy}
                              onClick={() =>
                                act(
                                  agent.connected ? "disconnect" : "connect",
                                  {},
                                  agent.connected
                                    ? "Browser disconnected. Video evidence saved."
                                    : "Browser connected. Complete login in its window.",
                                )
                              }
                            >
                              <Zap size={16} />
                              {agent.connected
                                ? "Disconnect"
                                : "Launch & connect"}
                            </Button>
                          </div>
                        </div>
                      </section>
                    </div>
                    <aside className="stack">
                      <div className="panel padded readiness-card">
                        <div className="eyebrow">PREPARATION CHECKLIST</div>
                        <h3>Set up for a great test run</h3>
                        {[
                          [
                            p.requirements.length > 0,
                            "Add product requirements",
                            `${p.requirements.length} requirements captured`,
                          ],
                          [
                            p.tests.length > 0,
                            "Build your test plan",
                            `${p.tests.length} tests available`,
                          ],
                          [
                            agent.connected,
                            "Connect the application",
                            agent.connected
                              ? "Browser session is connected"
                              : "Waiting for a connection",
                          ],
                        ].map(([ok, t, sub]) => (
                          <div className="checklist-item" key={String(t)}>
                            {ok ? (
                              <CheckCircle2 size={20} className="text-green" />
                            ) : (
                              <Circle size={20} />
                            )}
                            <div>
                              <strong>{t}</strong>
                              <small>{sub}</small>
                            </div>
                          </div>
                        ))}
                        <Link
                          className="button primary wide"
                          href={path("workspace")}
                        >
                          Open test workspace <ArrowRight size={16} />
                        </Link>
                      </div>
                      <div className="tip-card">
                        <Sparkles size={22} />
                        <h3>Your intent is the starting point</h3>
                        <p>
                          Clear acceptance criteria give AI better context and
                          make your final release decision easier to verify.
                        </p>
                      </div>
                    </aside>
                  </div>
                  <section className="panel top-space">
                    <PanelHeader
                      title={`Requirements (${p.requirements.length})`}
                      subtitle="Review acceptance criteria and trace each requirement to its tests."
                      right={
                        <Button
                          disabled={
                            locked ||
                            !p.discovery.length ||
                            !p.requirements.length
                          }
                          onClick={() =>
                            act("map", {}, "Application mapping updated.")
                          }
                        >
                          <Sparkles size={15} />
                          Map to application
                        </Button>
                      }
                    />
                    {!p.requirements.length ? (
                      <Empty title="No requirements yet" icon={FileText}>
                        Upload a PRD or add a requirement to start your evidence
                        chain.
                      </Empty>
                    ) : (
                      <div className="requirement-list">
                        {p.requirements.map((r) => (
                          <div className="requirement-row" key={r.id}>
                            <span className="id-label">{r.id}</span>
                            <div>
                              <strong>{r.title}</strong>
                              <p>{r.description}</p>
                              <details>
                                <summary>
                                  {r.acceptanceCriteria.length} acceptance
                                  criteria ·{" "}
                                  {
                                    p.tests.filter((t) =>
                                      t.requirementIds.includes(r.id),
                                    ).length
                                  }{" "}
                                  linked tests
                                </summary>
                                <ul>
                                  {r.acceptanceCriteria.map((c, i) => (
                                    <li key={i}>{c}</li>
                                  ))}
                                </ul>
                                {r.mapping && (
                                  <p>
                                    Mapped to {r.mapping.url} ·{" "}
                                    {r.mapping.confidence}% AI confidence
                                    <br />
                                    {r.mapping.reason}
                                  </p>
                                )}
                              </details>
                            </div>
                            <Button
                              onClick={() =>
                                setModal({ type: "requirement", item: r })
                              }
                              disabled={locked}
                            >
                              Edit
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
              {p && view === "workspace" && (
                <>
                  <div className="session-toolbar">
                    <div>
                      <span
                        className={`status-orb ${agent.connected ? "connected" : ""}`}
                      />
                      <strong>
                        {agent.connected
                          ? `${agent.mode === "AI" ? "AI" : "You"} ${agent.mode === "AI" ? "has" : "have"} browser control`
                          : "Browser is disconnected"}
                      </strong>
                      <Badge tone={tone(agent.state)}>{agent.state}</Badge>
                    </div>
                    <div className="row">
                      <Button
                        disabled={!!busy}
                        onClick={() =>
                          act(
                            agent.connected
                              ? agent.mode === "AI"
                                ? "pause"
                                : "resume"
                              : "connect",
                            {},
                            "Browser control updated.",
                          )
                        }
                      >
                        {agent.connected ? (
                          agent.mode === "AI" ? (
                            <>
                              <Pause size={15} />
                              Take control
                            </>
                          ) : (
                            <>
                              <Play size={15} />
                              Give control to AI
                            </>
                          )
                        ) : (
                          <>
                            <Zap size={15} />
                            Connect browser
                          </>
                        )}
                      </Button>
                      {running && (
                        <Button
                          onClick={() => act("cancel", {}, "Stop requested.")}
                        >
                          <Square size={14} />
                          Stop
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="browser-grid">
                    <section className="panel browser-panel">
                      <div className="browser-chrome">
                        <div className="traffic-lights">
                          <i />
                          <i />
                          <i />
                        </div>
                        <div>
                          <ShieldCheck size={13} />
                          {agent.url || p.url}
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Refresh browser preview"
                          onClick={() => setPreview(Date.now())}
                        >
                          <RefreshCw size={15} />
                        </button>
                      </div>
                      {agent.connected ? (
                        <div className="browser-preview">
                          <img
                            key={preview}
                            src={`/api/preview/${p.id}?v=${preview}`}
                            alt="Controlled application browser preview. Refresh when the browser is idle."
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                          <div className="preview-note">
                            <Monitor size={20} />
                            <strong>
                              {agent.currentTest ||
                                "Your controlled browser is open"}
                            </strong>
                            <p>{agent.message}</p>
                            <small>
                              Use the separate browser window to interact. Live
                              snapshots update every three seconds.
                            </small>
                          </div>
                        </div>
                      ) : (
                        <Empty
                          title="Your application, under test"
                          icon={Monitor}
                        >
                          Connect your app, complete login, then hand control to
                          AI.
                          <br />
                          You can take control at any time.
                        </Empty>
                      )}
                      <div className="ai-status">
                        <Sparkles size={17} />
                        <span>{agent.message}</span>
                        {agent.currentStep && (
                          <Badge>Step {agent.currentStep}</Badge>
                        )}
                      </div>
                    </section>
                    <section className="panel activity-panel">
                      <PanelHeader
                        title="Live activity"
                        right={<span className="live-dot" />}
                      />
                      <div className="activity-feed">
                        {agent.logs.length ? (
                          agent.logs.map((log, i) => (
                            <div key={`${log.at}-${i}`}>
                              <span>{date(log.at)}</span>
                              <p>{log.message}</p>
                            </div>
                          ))
                        ) : (
                          <div className="feed-empty">
                            <Activity size={22} />
                            <p>
                              Browser actions and progress will appear here.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                  <div className="discovery-bar">
                    <div>
                      <strong>
                        <Sparkles size={16} /> Application discovery
                      </strong>
                      <small>
                        {p.discovery.length} pages explored · navigate links
                        within your application
                      </small>
                    </div>
                    <label>
                      Pages
                      <input
                        aria-label="Maximum discovery pages"
                        type="number"
                        min={1}
                        max={50}
                        value={limits.maxPages}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            maxPages: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Depth
                      <input
                        aria-label="Maximum discovery depth"
                        type="number"
                        min={0}
                        max={5}
                        value={limits.maxDepth}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            maxDepth: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Minutes
                      <input
                        aria-label="Discovery time limit"
                        type="number"
                        min={1}
                        max={10}
                        value={limits.timeLimit}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            timeLimit: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <Button
                      disabled={
                        locked || !agent.connected || agent.mode !== "AI"
                      }
                      onClick={() =>
                        act("discover", limits, "Discovery started.")
                      }
                    >
                      <Search size={15} />
                      Discover app
                    </Button>
                  </div>
                  {p.discovery.length > 0 && (
                    <details className="discovery-details">
                      <summary>
                        View {p.discovery.length} discovered pages and selectors
                      </summary>
                      {p.discovery.map((d) => (
                        <div key={d.url}>
                          <strong>{d.title || d.url}</strong>
                          <p>
                            {d.url} · {d.elements.length} interactive elements
                          </p>
                          <pre>
                            {d.elements
                              .map(
                                (e) => `${e.type}: ${e.label} → ${e.selector}`,
                              )
                              .join("\n")}
                          </pre>
                        </div>
                      ))}
                    </details>
                  )}
                  <section className="panel">
                    <PanelHeader
                      title={`Test plan (${p.tests.length})`}
                      subtitle="Review and approve tests before execution. Edits require approval again."
                      right={
                        <div className="row">
                          <Button
                            disabled={locked}
                            onClick={() => setModal({ type: "test" })}
                          >
                            <Plus size={15} />
                            Add test
                          </Button>
                          <Button
                            disabled={locked}
                            onClick={() => setModal({ type: "generate" })}
                          >
                            <Sparkles size={15} />
                            Generate with AI
                          </Button>
                        </div>
                      }
                    />
                    <div className="table-toolbar">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          aria-label="Select all tests"
                          checked={
                            p.tests.length > 0 &&
                            p.tests.every((t) => selected.includes(t.id))
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked ? p.tests.map((t) => t.id) : [],
                            )
                          }
                        />
                        {selected.length} selected
                      </label>
                      <div className="row">
                        <Button
                          disabled={locked || !selected.length}
                          onClick={() =>
                            act(
                              "approveTests",
                              { testIds: selected },
                              "Selected tests approved.",
                            )
                          }
                        >
                          <Check size={15} />
                          Approve selected
                        </Button>
                        <Button
                          primary
                          disabled={
                            locked ||
                            !agent.connected ||
                            agent.mode !== "AI" ||
                            !p.tests.some((t) => t.approved)
                          }
                          onClick={() =>
                            act(
                              "run",
                              {
                                testIds: selected.length
                                  ? selected
                                  : p.tests
                                      .filter((t) => t.approved)
                                      .map((t) => t.id),
                              },
                              "Test run started.",
                            )
                          }
                        >
                          <Play size={15} />
                          Run {selected.length ? "selected" : "approved"} tests
                        </Button>
                      </div>
                    </div>
                    {!p.tests.length ? (
                      <Empty
                        title="Build your first test plan"
                        icon={ListChecks}
                      >
                        Generate tests from your requirements and app discovery,
                        <br />
                        import existing cases, or create a test manually.
                      </Empty>
                    ) : (
                      <div className="test-list">
                        {p.tests.map((t) => {
                          const result = allResults.find(
                            (r) => r.testId === t.id,
                          );
                          return (
                            <div className="test-row" key={t.id}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${t.title}`}
                                checked={selected.includes(t.id)}
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? [...selected, t.id]
                                      : selected.filter((id) => id !== t.id),
                                  )
                                }
                              />
                              <span className="test-type-icon">
                                <FlaskConical size={18} />
                              </span>
                              <div className="grow">
                                <strong>{t.title}</strong>
                                <small>
                                  {t.id} · {t.kind} · {t.steps.length} steps ·{" "}
                                  {t.requirementIds.length} linked requirements
                                </small>
                              </div>
                              <Badge tone={t.approved ? "green" : "amber"}>
                                {t.approved ? "Approved" : "Draft"}
                              </Badge>
                              <Badge tone={result ? tone(result.status) : ""}>
                                {result?.status || "Not run"}
                              </Badge>
                              <Button
                                disabled={locked}
                                onClick={() =>
                                  setModal({ type: "test", item: t })
                                }
                              >
                                Review
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
              {p && view === "results" && (
                <>
                  <div className="stats-grid six">
                    <Stat
                      label="Requirements"
                      value={p.requirements.length}
                      note={`${m!.coverage}% requirements with passing tests`}
                    />
                    <Stat
                      label="Tests executed"
                      value={m!.executed}
                      note={`of ${p.tests.length} current tests`}
                    />
                    <Stat
                      label="Passed"
                      value={m!.passed}
                      color="green"
                      note="Working as expected"
                    />
                    <Stat
                      label="Failed"
                      value={m!.failed}
                      color="red"
                      note="Needs a fix"
                    />
                    <Stat
                      label="Warnings"
                      value={m!.warnings}
                      color="amber"
                      note="Needs investigation"
                    />
                    <Stat
                      label="AI confidence"
                      value={
                        analyzed.length
                          ? `${Math.round(analyzed.reduce((sum, r) => sum + r.confidence!, 0) / analyzed.length)}%`
                          : "—"
                      }
                      note={
                        analyzed.length
                          ? `${analyzed.length} AI analyses`
                          : "Not analyzed by AI"
                      }
                    />
                  </div>
                  <section className="panel">
                    <PanelHeader
                      title="Requirement coverage"
                      subtitle="Coverage tracks linked current tests. Review their assertions against every acceptance criterion before signing off."
                    />
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Requirement</th>
                            <th>Acceptance criteria</th>
                            <th>Current tests</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.requirements.map((req) => {
                            const linked = p.tests.filter((test) =>
                              test.requirementIds.includes(req.id),
                            );
                            const current = allResults.filter((result) =>
                              linked.some((test) => test.id === result.testId),
                            );
                            const status = !linked.length
                              ? "Uncovered"
                              : current.some(
                                    (result) => result.status === "Failed",
                                  )
                                ? "Failed"
                                : current.some(
                                      (result) => result.status === "Warning",
                                    )
                                  ? "Warning"
                                  : current.length < linked.length
                                    ? "Not run"
                                    : "Passed";
                            return (
                              <tr key={req.id}>
                                <td>
                                  <strong>{req.title}</strong>
                                  <small>{req.id}</small>
                                </td>
                                <td>{req.acceptanceCriteria.join(" · ")}</td>
                                <td>{linked.length}</td>
                                <td>
                                  <Badge tone={tone(status)}>{status}</Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel">
                    <PanelHeader
                      title="Latest test results"
                      subtitle="Current test versions only. Earlier executions remain in history."
                      right={
                        <Button
                          onClick={() =>
                            download(
                              `${p.name}-results.json`,
                              JSON.stringify(
                                {
                                  project: p.name,
                                  metrics: m,
                                  results: p.results,
                                },
                                null,
                                2,
                              ),
                            )
                          }
                        >
                          <Download size={15} />
                          Export results
                        </Button>
                      }
                    />
                    <div className="table-toolbar">
                      <div className="tabs">
                        {["All", "Passed", "Failed", "Warning"].map((f) => (
                          <button
                            key={f}
                            className={filter === f ? "active" : ""}
                            onClick={() => setFilter(f)}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <SearchBox
                        value={search}
                        set={setSearch}
                        placeholder="Search results…"
                      />
                    </div>
                    {!results.length ? (
                      <Empty title="No results to show" icon={Activity}>
                        Run your approved tests to collect real evidence,
                        <br />
                        or change the result filter.
                      </Empty>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Test / workflow</th>
                              <th>Status</th>
                              <th>Assertions</th>
                              <th>Duration</th>
                              <th>Evidence</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {results.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <strong>{r.title}</strong>
                                  <small>
                                    {r.requirementIds.join(", ") ||
                                      "No linked requirement"}
                                  </small>
                                </td>
                                <td>
                                  <Badge tone={tone(r.status)}>
                                    {r.status}
                                  </Badge>
                                </td>
                                <td>
                                  {
                                    r.steps.filter(
                                      (s) =>
                                        s.action.startsWith("assert") ||
                                        ["api", "database"].includes(s.action),
                                    ).length
                                  }
                                </td>
                                <td>{(r.duration / 1000).toFixed(1)}s</td>
                                <td>
                                  {r.screenshot ? (
                                    <CheckCircle2
                                      className="text-green"
                                      size={17}
                                    />
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td>
                                  <Button
                                    onClick={() =>
                                      setModal({ type: "result", item: r })
                                    }
                                  >
                                    View <ArrowUpRight size={13} />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                  <RunHistory
                    p={p}
                    onResult={(r) => setModal({ type: "result", item: r })}
                  />
                </>
              )}
              {p && view === "issues" && (
                <section className="panel">
                  <PanelHeader
                    title={`Issues (${p.issues.length})`}
                    subtitle="Related failures from the same test are grouped with their evidence."
                  />
                  {!p.issues.length ? (
                    <Empty title="No tracked issues" icon={CheckCircle2}>
                      Create an issue from a failed result to track the fix
                      <br />
                      and verify it with a re-test.
                    </Empty>
                  ) : (
                    <div className="issue-list">
                      {p.issues.map((i) => (
                        <div className="issue-row" key={i.id}>
                          <span className="issue-marker">
                            <Activity size={19} />
                          </span>
                          <div className="grow">
                            <span className="id-label">{i.id}</span>
                            <h3>{i.title}</h3>
                            <small>
                              {i.resultIds.length} linked executions ·{" "}
                              {i.requirementIds.join(", ") ||
                                "No linked requirement"}
                            </small>
                          </div>
                          <Badge tone={tone(i.severity)}>{i.severity}</Badge>
                          <Badge tone={tone(i.status)}>{i.status}</Badge>
                          <Button
                            onClick={() => setModal({ type: "issue", item: i })}
                          >
                            Open issue
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {p && view === "release" && (
                <>
                  <div className={`release-banner ${m!.ready ? "ready" : ""}`}>
                    <span>
                      <ShieldCheck size={30} />
                    </span>
                    <div>
                      <h2>
                        {m!.signed
                          ? "Signed off and ready to ship"
                          : m!.ready
                            ? "Validation complete. Review your release."
                            : "A few things need your attention"}
                      </h2>
                      <p>
                        {m!.ready
                          ? "Review the evidence, confirm QA validation, and record developer sign-off."
                          : "Complete requirement coverage, pass all current tests, and resolve critical or high issues."}
                      </p>
                    </div>
                    <Badge tone={tone(m!.state)}>{m!.state}</Badge>
                  </div>
                  <div className="two-column">
                    <section className="panel">
                      <PanelHeader
                        title="Release readiness"
                        subtitle="Calculated from current requirements, test versions, and evidence."
                      />
                      <div className="release-checks">
                        {[
                          [
                            m!.validated === p.requirements.length &&
                              p.requirements.length > 0,
                            "Requirements validated",
                            `${m!.validated} / ${p.requirements.length}`,
                          ],
                          [
                            m!.passed === p.tests.length && p.tests.length > 0,
                            "Tests passed",
                            `${m!.passed} / ${p.tests.length}`,
                          ],
                          [
                            m!.blocking === 0,
                            "Critical & high issues",
                            String(m!.blocking),
                          ],
                          [
                            m!.coverage === 100,
                            "Requirement coverage",
                            `${m!.coverage}%`,
                          ],
                          [
                            m!.qa,
                            "QA validation",
                            m!.qa ? p.qaValidation!.name : "Pending",
                          ],
                          [
                            m!.signed,
                            "Developer sign-off",
                            m!.signed ? "Signed" : "Pending",
                          ],
                        ].map(([ok, title, value]) => (
                          <div key={String(title)}>
                            {ok ? (
                              <CheckCircle2 size={19} className="text-green" />
                            ) : (
                              <Circle size={19} className="text-amber" />
                            )}
                            <span>{title}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      <div className="panel-body">
                        <small className="muted">
                          Coverage is validated functionality. AI confidence is
                          separate; execution here uses concrete assertions, so
                          no AI confidence score is invented.
                        </small>
                      </div>
                    </section>
                    <section className="panel padded">
                      <h2>Review & sign off</h2>
                      <p className="muted">
                        Your approval is tied to this exact validation state.
                        New results or changes require a fresh review.
                      </p>
                      <form
                        onSubmit={(e) =>
                          submit(e, m!.qa ? "signoff" : "qaValidate")
                        }
                      >
                        <Field
                          label={m!.qa ? "Developer name" : "QA reviewer name"}
                        >
                          <input
                            name="name"
                            required
                            defaultValue={p.owner}
                            maxLength={100}
                          />
                        </Field>
                        <Field label="Release notes">
                          <textarea
                            name="note"
                            rows={4}
                            placeholder="Review notes, release context, and known limitations…"
                          />
                        </Field>
                        <Button
                          primary
                          type="submit"
                          disabled={!!busy || !m!.ready || m!.signed}
                        >
                          <ShieldCheck size={17} />
                          {m!.signed
                            ? "Release signed off"
                            : m!.qa
                              ? "Sign off release"
                              : "Confirm QA validation"}
                        </Button>
                      </form>
                      {!m!.ready && (
                        <div className="inline-warning">
                          Sign-off is available after the readiness checks pass.
                        </div>
                      )}
                    </section>
                  </div>
                  <section className="panel top-space">
                    <PanelHeader
                      title="Sign-off history"
                      subtitle="An auditable record of developer review."
                    />
                    {p.signoffs.length ? (
                      p.signoffs.map((s) => (
                        <div className="history-row" key={s.id}>
                          <ShieldCheck size={20} />
                          <div>
                            <strong>{s.name}</strong>
                            <p>
                              {s.note || "Release reviewed and signed off."}
                            </p>
                          </div>
                          <span>{date(s.at)}</span>
                          <Badge
                            tone={
                              s.fingerprint === fingerprint(p)
                                ? "green"
                                : "amber"
                            }
                          >
                            {s.fingerprint === fingerprint(p)
                              ? "Current"
                              : "Superseded"}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="panel-body muted">
                        No developer sign-offs recorded yet.
                      </div>
                    )}
                  </section>
                </>
              )}
              {p && view === "settings" && (
                <div className="two-column">
                  <form
                    className="panel padded"
                    onSubmit={(e) => submit(e, "updateProject")}
                  >
                    <h2>Project configuration</h2>
                    <Field label="Project name">
                      <input
                        name="name"
                        defaultValue={p.name}
                        required
                        maxLength={100}
                      />
                    </Field>
                    <Field label="Application URL">
                      <input
                        name="url"
                        defaultValue={p.url}
                        type="url"
                        required
                      />
                    </Field>
                    <Field label="Owner">
                      <input name="owner" defaultValue={p.owner} required />
                    </Field>
                    <Field label="Description">
                      <textarea
                        name="description"
                        defaultValue={p.description}
                        rows={4}
                      />
                    </Field>
                    <Button primary type="submit" disabled={locked}>
                      Save settings
                    </Button>
                  </form>
                  <div className="panel padded">
                    <h2>Local services</h2>
                    <div className="config-row">
                      <span>AI provider</span>
                      <Badge tone="purple">{ai.provider}</Badge>
                    </div>
                    <div className="config-row">
                      <span>Model</span>
                      <code>{ai.model}</code>
                    </div>
                    <div className="config-row">
                      <span>Browser agent</span>
                      <Badge tone={agent.online ? "green" : ""}>
                        {agent.online ? "Online" : "Offline"}
                      </Badge>
                    </div>
                    <p className="muted">
                      Configure AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL,
                      OLLAMA_URL, or OLLAMA_MODEL in web/.env.local, then
                      restart. Database tests use TEST_DATABASE_URL with a
                      read-only PostgreSQL or MySQL account.
                    </p>
                    <p className="muted">
                      This is a single-user local workspace. Owner and reviewer
                      names are labels, not authenticated identities.
                    </p>
                    <Button
                      onClick={() =>
                        download(
                          `${p.name}-backup.json`,
                          JSON.stringify(p, null, 2),
                        )
                      }
                    >
                      <Download size={16} />
                      Export project backup
                    </Button>
                  </div>
                </div>
              )}
              {p && view === "reports" && (
                <>
                  <div className="panel padded">
                    <div className="row spread">
                      <div>
                        <h2>Project validation report</h2>
                        <p className="muted">
                          Requirements, tests, evidence, issues, runs, and
                          release history.
                        </p>
                      </div>
                      <Button
                        primary
                        onClick={() =>
                          download(
                            `${p.name}-validation-report.json`,
                            JSON.stringify(
                              {
                                generatedAt: new Date().toISOString(),
                                summary: metrics(p),
                                project: p,
                              },
                              null,
                              2,
                            ),
                          )
                        }
                      >
                        <Download size={16} />
                        Export full report
                      </Button>
                    </div>
                  </div>
                  <RunHistory
                    p={p}
                    onResult={(r) => setModal({ type: "result", item: r })}
                  />
                  <section className="panel top-space">
                    <PanelHeader title="Project activity" />
                    {p.activity.map((a, i) => (
                      <div className="history-row" key={i}>
                        <Circle size={12} />
                        <span className="grow">{a.message}</span>
                        <small>{date(a.at)}</small>
                      </div>
                    ))}
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} /> AI QA Studio · Evidence before
              confidence
            </span>
            <span>Local workspace</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={modalRef}
        className={`modal ${modal?.type === "result" || modal?.type === "test" ? "large" : ""}`}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <div className="modal-header">
          <h2>
            {modal?.type === "requirement"
              ? "Requirement details"
              : modal?.type === "test"
                ? "Review test case"
                : modal?.type === "result"
                  ? "Test result & evidence"
                  : modal?.type === "issue"
                    ? "Issue details"
                    : modal?.type === "generate"
                      ? "Generate a test plan"
                      : "Your workspace guide"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {modal?.type === "requirement" && (
            <form
              key={modal.item?.id || "new-r"}
              onSubmit={(e) => {
                const form = new FormData(e.currentTarget);
                submit(e, "saveRequirement", {
                  id: modal.item?.id,
                  acceptanceCriteria: String(form.get("acceptanceCriteria"))
                    .split("\n")
                    .filter(Boolean),
                });
              }}
            >
              <Field label="Title">
                <input
                  name="title"
                  defaultValue={modal.item?.title}
                  required
                  maxLength={200}
                  autoFocus
                />
              </Field>
              <Field label="Description">
                <textarea
                  name="description"
                  defaultValue={modal.item?.description}
                  required
                  rows={3}
                />
              </Field>
              <Field label="Acceptance criteria (one per line)">
                <textarea
                  name="acceptanceCriteria"
                  defaultValue={modal.item?.acceptanceCriteria.join("\n")}
                  required
                  rows={5}
                />
              </Field>
              <div className="form-footer">
                {modal.item && (
                  <Button
                    disabled={locked}
                    onClick={async () => {
                      if (
                        await act("deleteRequirement", { id: modal.item?.id })
                      )
                        setModal(null);
                    }}
                  >
                    <Trash2 size={15} />
                    Delete
                  </Button>
                )}
                <Button primary type="submit" disabled={locked}>
                  Save requirement
                </Button>
              </div>
            </form>
          )}
          {modal?.type === "test" && p && (
            <form
              key={modal.item?.id || "new-t"}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                try {
                  const steps = JSON.parse(String(form.get("steps")));
                  if (
                    await act("saveTest", {
                      ...Object.fromEntries(form),
                      id: modal.item?.id,
                      steps,
                      requirementIds: form.getAll("requirementIds"),
                    })
                  )
                    setModal(null);
                } catch {
                  setError(
                    "Steps must be valid JSON. Check the example and try again.",
                  );
                }
              }}
            >
              <div className="form-row">
                <Field label="Test title">
                  <input
                    name="title"
                    defaultValue={modal.item?.title}
                    required
                    maxLength={200}
                    autoFocus
                  />
                </Field>
                <Field label="Test type">
                  <select
                    name="kind"
                    defaultValue={modal.item?.kind || "Functional"}
                  >
                    {[
                      "Functional",
                      "Happy path",
                      "Negative",
                      "Validation",
                      "Edge case",
                      "Permissions",
                      "Persistence",
                      "API",
                      "Database",
                      "Smoke",
                      "Imported",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Expected outcome">
                <textarea
                  name="expected"
                  defaultValue={modal.item?.expected}
                  required
                  rows={2}
                  placeholder="Describe the user-visible result this test should verify."
                />
              </Field>
              <fieldset>
                <legend>Linked requirements</legend>
                {p.requirements.length ? (
                  p.requirements.map((r) => (
                    <label className="checkbox-label" key={r.id}>
                      <input
                        type="checkbox"
                        name="requirementIds"
                        value={r.id}
                        defaultChecked={modal.item?.requirementIds.includes(
                          r.id,
                        )}
                      />
                      {r.title}
                    </label>
                  ))
                ) : (
                  <p className="muted">
                    Add requirements in Preparation to enable traceability.
                  </p>
                )}
              </fieldset>
              <Field label="Executable steps (JSON)">
                <textarea
                  className="code-input"
                  name="steps"
                  rows={12}
                  required
                  defaultValue={JSON.stringify(
                    modal.item?.steps || [
                      { action: "navigate", target: "/" },
                      { action: "assertVisible", target: "body" },
                    ],
                    null,
                    2,
                  )}
                />
              </Field>
              <details>
                <summary>Step reference</summary>
                <p>
                  Actions: {actions.join(", ")}. Use CSS selectors for UI
                  targets. Assertions require expected text, URL substring, HTTP
                  status, or database row count. API steps use read-only GET.
                  Database steps use SELECT. Mark humanApproval: true for steps
                  that a person must complete.
                </p>
              </details>
              <div className="form-footer">
                {modal.item && (
                  <Button
                    disabled={locked}
                    onClick={async () => {
                      if (await act("deleteTest", { id: modal.item?.id }))
                        setModal(null);
                    }}
                  >
                    <Trash2 size={15} />
                    Delete test
                  </Button>
                )}
                <Button primary type="submit" disabled={locked}>
                  Save draft for approval
                </Button>
              </div>
            </form>
          )}
          {modal?.type === "generate" && (
            <form onSubmit={(e) => submit(e, "generateTests")}>
              <div className="ai-callout">
                <Sparkles size={24} />
                <p>
                  AI will use your requirements, discovered pages, and existing
                  context to propose executable tests. Review the steps before
                  approving them.
                </p>
              </div>
              <Field label="Workflow or additional instructions (optional)">
                <textarea
                  name="workflow"
                  rows={6}
                  placeholder="e.g. Verify that searching for a partner shows matching results, and an unknown name shows an empty state."
                />
              </Field>
              <Button primary type="submit" disabled={locked}>
                <Sparkles size={16} />
                Generate draft tests
              </Button>
            </form>
          )}
          {modal?.type === "result" && (
            <ResultDetail
              result={modal.item}
              onAnalyze={async () => {
                const data = await act(
                  "analyzeResult",
                  { resultId: modal.item.id },
                  "Evidence analyzed by AI.",
                );
                if (data) setModal({ type: "result", item: data.result });
              }}
              onIssue={async () => {
                if (
                  await act(
                    "createIssue",
                    { resultId: modal.item.id },
                    "Issue created with linked evidence.",
                  )
                )
                  setModal(null);
              }}
              onRetest={async () => {
                if (
                  await act(
                    "run",
                    { testIds: [modal.item.testId] },
                    "Re-test started.",
                  )
                ) {
                  setModal(null);
                  router.push(path("workspace"));
                }
              }}
              disabled={locked}
            />
          )}
          {modal?.type === "issue" && p && (
            <>
              <div className="row">
                <Badge tone={tone(modal.item.status)}>
                  {modal.item.status}
                </Badge>
                <span className="id-label">{modal.item.id}</span>
              </div>
              <h3 className="top-space">{modal.item.title}</h3>
              <form
                onSubmit={(e) =>
                  submit(e, "updateIssue", { id: modal.item.id })
                }
              >
                <div className="form-row">
                  <Field label="Status">
                    <select name="status" defaultValue={modal.item.status}>
                      {issueStates
                        .filter(
                          (s) =>
                            s !== "Re-testing" ||
                            modal.item.status === "Re-testing",
                        )
                        .map((s) => (
                          <option key={s} disabled={s === "Re-testing"}>
                            {s}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Severity">
                    <select name="severity" defaultValue={modal.item.severity}>
                      {["Critical", "High", "Medium", "Low"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Fix notes">
                  <textarea
                    name="notes"
                    defaultValue={modal.item.notes}
                    rows={4}
                    placeholder="Describe the fix and anything the reviewer should verify."
                  />
                </Field>
                <div className="form-footer">
                  <Button
                    onClick={async () => {
                      if (
                        await act(
                          "run",
                          { testIds: [modal.item.testId] },
                          "Issue re-test started.",
                        )
                      ) {
                        setModal(null);
                        router.push(path("workspace"));
                      }
                    }}
                    disabled={locked}
                  >
                    <RefreshCw size={15} />
                    Re-test workflow
                  </Button>
                  <Button primary type="submit" disabled={!!busy}>
                    Save issue
                  </Button>
                </div>
              </form>
              <h3 className="top-space">Before / after evidence</h3>
              {p.results
                .filter((r) => modal.item.resultIds.includes(r.id))
                .map((r) => (
                  <button
                    className="evidence-row"
                    key={r.id}
                    onClick={() => setModal({ type: "result", item: r })}
                  >
                    <Badge tone={tone(r.status)}>{r.status}</Badge>
                    <span>{r.actual}</span>
                    <small>{date(r.startedAt)}</small>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
            </>
          )}
          {modal?.type === "help" && (
            <div className="guide">
              {[
                [
                  "1. Prepare your project",
                  "Create a project for a local, staging, or test application. Upload a PRD or add requirements manually. Import CSV/XLSX tests using the template, or convert natural-language cases with AI.",
                ],
                [
                  "2. Connect and explore",
                  "Connect opens a visible controlled browser. Complete credentials, MFA, and SSO yourself, then give control to AI. Discovery reads pages and follows links within the connected origin.",
                ],
                [
                  "3. Review and execute",
                  "Generate or add tests. Review CSS selectors, inputs, and concrete outcome assertions, then select and approve your tests. Take control or stop a run anytime. Human-gated actions pause for you to complete the action before resuming.",
                ],
                [
                  "4. Verify and release",
                  "Inspect results and technical evidence. Create issues, record fixes, and re-test. Passing re-tests verify linked issues. Full validation and QA review unlock developer sign-off.",
                ],
                [
                  "Local setup",
                  "AI supports Gemini or Ollama through web/.env.local. Database checks support PostgreSQL and MySQL with TEST_DATABASE_URL and a read-only database account. Screenshots and traces are saved locally; session videos finish when you disconnect.",
                ],
              ].map(([t, d]) => (
                <section key={t}>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </section>
              ))}
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  icon: Icon,
  color = "",
}: {
  label: string;
  value: string | number;
  note: string;
  icon?: typeof Home;
  color?: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        {Icon && <Icon size={18} />}
      </div>
      <strong className={color ? `text-${color}` : ""}>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function SearchBox({
  value,
  set,
  placeholder,
}: {
  value: string;
  set: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search">
      <Search size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
}
function PanelHeader({
  title,
  subtitle,
  right,
  number,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  number?: string;
  icon?: typeof Home;
}) {
  return (
    <div className="panel-header">
      <div className="row">
        {number ? (
          <span className="section-number">{number}</span>
        ) : (
          Icon && <Icon size={18} />
        )}
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
function RunHistory({
  p,
  onResult,
}: {
  p: Project;
  onResult: (r: Result) => void;
}) {
  return (
    <section className="panel top-space">
      <PanelHeader
        title="Execution history"
        subtitle="Every run retained, including cancelled runs and previous test versions."
      />
      {p.runs.length ? (
        [...p.runs].reverse().map((run) => (
          <details className="run-history" key={run.id}>
            <summary>
              <span className="row">
                <span className="id-label">{run.id}</span>
                <Badge tone={tone(run.status)}>{run.status}</Badge>
                <span>
                  {run.testIds.length} tests · {date(run.startedAt)}
                </span>
              </span>
            </summary>
            {run.error && <p className="text-red">{run.error}</p>}
            {p.results
              .filter((r) => r.runId === run.id)
              .map((r) => (
                <button
                  className="evidence-row"
                  key={r.id}
                  onClick={() => onResult(r)}
                >
                  <Badge tone={tone(r.status)}>{r.status}</Badge>
                  <span>
                    {r.title} · v{r.version}
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
          </details>
        ))
      ) : (
        <div className="panel-body muted">No test runs yet.</div>
      )}
    </section>
  );
}
function ResultDetail({
  result: r,
  onIssue,
  onRetest,
  onAnalyze,
  disabled,
}: {
  result: Result;
  onIssue: () => void;
  onRetest: () => void;
  onAnalyze: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="row spread">
        <h3>{r.title}</h3>
        <Badge tone={tone(r.status)}>{r.status}</Badge>
      </div>
      <div className="result-summary">
        <div>
          <small>WHAT SHOULD HAPPEN</small>
          <p>{r.expected}</p>
        </div>
        <div>
          <small>WHAT HAPPENED</small>
          <p>{r.actual}</p>
        </div>
        <div>
          <small>IMPACT</small>
          <p>{r.impact}</p>
        </div>
        {r.likelyCause && (
          <div>
            <small>LIKELY CAUSE</small>
            <p>{r.likelyCause}</p>
          </div>
        )}
      </div>
      <div className="health-indicators">
        <Badge tone="purple">
          AI analysis confidence:{" "}
          {typeof r.confidence !== "number" || !Number.isFinite(r.confidence)
            ? "Not analyzed"
            : `${r.confidence}%`}
        </Badge>
        {[
          ["UI", r.steps.some((s) => s.action.startsWith("assert"))],
          ["API", r.steps.some((s) => s.action === "api")],
          ["Database", r.steps.some((s) => s.action === "database")],
        ].map(([label, checked]) => (
          <Badge key={String(label)} tone={checked ? "purple" : ""}>
            {checked ? <Check size={12} /> : <Circle size={12} />}
            {label}: {checked ? "See assertions" : "Not validated"}
          </Badge>
        ))}
      </div>
      <div className="row top-space">
        <Button onClick={onAnalyze} disabled={disabled}>
          <Sparkles size={15} />
          Analyze with AI
        </Button>
        {r.status !== "Passed" && (
          <Button primary onClick={onIssue} disabled={disabled}>
            <Plus size={15} />
            Create issue
          </Button>
        )}
        <Button onClick={onRetest} disabled={disabled}>
          <RefreshCw size={15} />
          Re-test
        </Button>
        {r.trace && (
          <a className="button" href={`/api/evidence/${r.trace}`}>
            <Download size={15} />
            Download trace
          </a>
        )}
        {r.video && (
          <a
            className="button"
            href={`/api/evidence/${r.video}`}
            target="_blank"
            rel="noreferrer"
          >
            View session video <ExternalLink size={15} />
          </a>
        )}
      </div>
      {r.screenshot && (
        <a
          href={`/api/evidence/${r.screenshot}`}
          target="_blank"
          rel="noreferrer"
        >
          <img
            className="evidence-screenshot"
            src={`/api/evidence/${r.screenshot}`}
            alt={`Screenshot evidence for ${r.title}`}
          />
        </a>
      )}
      <details className="technical">
        <summary>
          <Code2 size={16} />
          Technical details
        </summary>
        <p>
          {r.testId} · Version {r.version} · {date(r.startedAt)} ·{" "}
          {(r.duration / 1000).toFixed(1)} seconds
        </p>
        {r.steps.map((s, i) => (
          <div className="step-result" key={i}>
            <Badge tone={tone(s.status)}>
              {i + 1}. {s.status}
            </Badge>
            <code>
              {s.action} {s.target}
            </code>
            <p>{s.detail}</p>
          </div>
        ))}
        <h4>Observed network requests</h4>
        <pre>
          {r.network.length
            ? JSON.stringify(r.network, null, 2)
            : "No API requests captured."}
        </pre>
        <h4>Console</h4>
        <pre>
          {r.console.join("\n") || "No console warnings or errors captured."}
        </pre>
        <h4>Database</h4>
        <pre>
          {r.database
            ? JSON.stringify(r.database, null, 2)
            : "Database was not validated."}
        </pre>
      </details>
    </>
  );
}
