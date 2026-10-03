"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  ControlSnapshot,
  ControlCommand,
  Task,
} from "@northside/agent-runtime";
const roles = [
  ["coordinator", "Coordinator", "Plans & integrates"],
  ["shopify_engineer", "Shopify engineer", "Commerce & POS"],
  ["experience_engineer", "Experience engineer", "Phone & iPad"],
  ["reviewer", "Independent reviewer", "Correctness & security"],
  ["verifier", "Verifier", "Executed evidence"],
];
const date = (n?: number) => (n ? new Date(n).toLocaleString() : "Never");
const stateText = (s: string) => s.replaceAll("_", " ");
async function api(action: string, data?: unknown) {
  const r = await fetch(`/api/control/${action}`, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const out = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(out.error || "Request failed"), {
      status: r.status,
    });
  return out;
}
function Pixel({ index }: { index: number }) {
  return (
    <svg
      className={"pixel pixel-" + index}
      viewBox="0 0 12 12"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d="M3 1h6v1h2v6H9v3H7V9H5v2H3V8H1V2h2z" />
      <path className="eyes" d="M3 4h2v2H3zm4 0h2v2H7z" />
      <path className="mouth" d="M4 7h4v1H4z" />
    </svg>
  );
}
export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null),
    [authorized, setAuthorized] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [project, setProject] = useState("northside-app"),
    [selected, setSelected] = useState<string | null>(null),
    [credential, setCredential] = useState("");
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api("snapshot"));
      setAuthorized(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        setAuthorized(false);
        setSnapshot(null);
      } else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [refresh]);
  async function act(action: string, data: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api(action, data);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function command(cmd: ControlCommand) {
    await act("commands", cmd);
  }
  async function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act("login", { password: f.get("password") });
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    const result = await act("tasks", {
      projectId: project,
      title: f.get("title"),
      description: f.get("description"),
      acceptanceCriteria: f.get("acceptanceCriteria"),
      role: f.get("role"),
      mode: f.get("mode"),
      maxRuntimeSeconds: Number(f.get("maxRuntimeSeconds")),
      maxTokens: Number(f.get("maxTokens")),
      maxModelRuns: 6,
      maxAttempts: 2,
      priority: 0,
    });
    if (result) form.reset();
  }
  if (authorized !== true)
    return (
      <main className="login">
        <div className="wordmark">
          N<span>NORTHSIDE</span>
          <small>MISSION CONTROL</small>
        </div>
        <div className="loginbox">
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>
            A clear view.
            <br />A human in control.
          </h1>
          <p>Sign in to assign bounded work and review the evidence.</p>
          {authorized === null ? (
            <p>Connecting…</p>
          ) : (
            <form onSubmit={signIn}>
              <label>
                Operator password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button disabled={busy}>Sign in</button>
            </form>
          )}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <small>
            Staff access and customer sessions use separate permissions.
          </small>
        </div>
      </main>
    );
  const tasks = snapshot?.tasks.filter((t) => t.projectId === project) ?? [];
  const task = tasks.find((t) => t.id === selected);
  const online = snapshot?.workers.filter((w) => w.online).length ?? 0;
  const paused =
    snapshot?.paused ||
    snapshot?.projects.find((p) => p.id === project)?.paused;
  return (
    <div className="shell">
      <aside>
        <div className="wordmark">
          N<span>NORTHSIDE</span>
        </div>
        <p className="eyebrow">WORKSPACE</p>
        <label className="projectlabel">
          Project
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {snapshot?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <a className="nav active" href="/mission-control">
          ▦ &nbsp; Mission control
        </a>
        <a className="nav" href="#task-board">
          ≡ &nbsp; Task board
        </a>
        <a className="nav" href="#activity">
          ◷ &nbsp; Activity
        </a>
        <div className="sidebarbottom">
          <span className={"dot " + (online ? "green" : "")} />
          {online ? `${online} worker online` : "No workers online"}
          <p>
            Merge & production
            <br />
            deployment disabled
          </p>
          <button
            className="quiet"
            onClick={async () => {
              await act("logout", {});
              setAuthorized(false);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header>
          <span className="eyebrow">NORTHSIDE APP / OPERATIONS</span>
          <span className="status">
            {paused ? "New work paused" : "Accepting bounded tasks"}
          </span>
        </header>
        <section className="heading">
          <div>
            <p className="eyebrow">YOUR WORK, IN VIEW</p>
            <h1>
              Mission control<span>.</span>
            </h1>
            <p>Small tasks. Independent review. Evidence before approval.</p>
          </div>
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void command({
                  type: snapshot?.paused ? "resume_all" : "pause_all",
                })
              }
            >
              {snapshot?.paused ? "Resume all" : "Pause all new work"}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void command({
                  type: snapshot?.projects.find((p) => p.id === project)?.paused
                    ? "resume_project"
                    : "pause_project",
                  projectId: project,
                })
              }
            >
              {snapshot?.projects.find((p) => p.id === project)?.paused
                ? "Resume project"
                : "Pause project"}
            </button>
          </div>
        </section>
        {error ? (
          <div role="alert" className="error">
            {error}
          </div>
        ) : null}
        <div className="notice">
          {online
            ? "Worker status is based on recent server heartbeats."
            : "Worker disconnected. Tasks can be queued; cancellation acknowledgements wait for reconnection."}{" "}
          Pause stops new work. Active runs need a cancellation request.
        </div>
        <section className="agents" aria-label="Agent roles">
          {roles.map(([id, label, scope], i) => {
            const current = tasks.find(
              (t) =>
                ["running", "awaiting_review", "verifying"].includes(t.state) &&
                ((id === t.role && t.state === "running") ||
                  (id === "reviewer" && t.state === "awaiting_review") ||
                  (id === "verifier" && t.state === "verifying")),
            );
            return (
              <article className="agent" key={id}>
                <div className="agenttop">
                  <Pixel index={i} />
                  <span className={"tiny " + (current ? "live" : "")}>
                    {current
                      ? current.mode === "simulated"
                        ? "SIMULATED"
                        : "RUNNING"
                      : id === "coordinator"
                        ? "RULES"
                        : "IDLE"}
                  </span>
                </div>
                <h3>{label}</h3>
                <p>{scope}</p>
                <div className="agenttask">
                  {current?.title ??
                    (id === "coordinator"
                      ? "Queue & approval gates"
                      : "No active execution")}
                </div>
              </article>
            );
          })}
        </section>
        <div className="stats">
          <div>
            <span>{tasks.filter((t) => t.state === "queued").length}</span>
            <p>Queued</p>
          </div>
          <div>
            <span>
              {
                tasks.filter((t) =>
                  ["running", "awaiting_review", "verifying"].includes(t.state),
                ).length
              }
            </span>
            <p>In progress</p>
          </div>
          <div>
            <span>
              {tasks.filter((t) => t.state === "ready_for_approval").length}
            </span>
            <p>Awaiting your approval</p>
          </div>
          <div>
            <span>
              {tasks.every((t) => t.usage.costUsd !== null) && tasks.length
                ? "$" +
                  tasks
                    .reduce((n, t) => n + (t.usage.costUsd ?? 0), 0)
                    .toFixed(2)
                : "Unknown"}
            </span>
            <p>Provider cost · reported only</p>
          </div>
        </div>
        <div className="columns">
          <section id="task-board" className="panel">
            <div className="sectionhead">
              <h2>Task board</h2>
              <span>{tasks.length} tasks</span>
            </div>
            {!tasks.length ? (
              <div className="empty">
                No work queued.
                <br />
                <small>Create a bounded task to begin.</small>
              </div>
            ) : (
              <div className="tasklist">
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    className={
                      "taskrow " + (selected === t.id ? "selected" : "")
                    }
                    onClick={() => setSelected(t.id)}
                  >
                    <span>
                      <strong>{t.title}</strong>
                      <small>
                        {stateText(t.role)} · Attempt {t.attempt}/
                        {t.maxAttempts} ·{" "}
                        {t.mode === "simulated" ? "SIMULATED" : "Codex"}
                      </small>
                    </span>
                    <span className={"badge " + t.state}>
                      {stateText(t.state)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {task ? (
              <TaskDetail task={task} command={command} busy={busy} />
            ) : null}
          </section>
          <section className="panel">
            <div className="sectionhead">
              <h2>Assign a task</h2>
              <span>Bounded by design</span>
            </div>
            <form className="taskform" onSubmit={create}>
              <label>
                Title
                <input
                  name="title"
                  placeholder="Improve the basket quantity controls"
                  minLength={3}
                  maxLength={160}
                  required
                />
              </label>
              <label>
                Scope
                <textarea
                  name="description"
                  placeholder="Describe one independently reviewable change…"
                  minLength={10}
                  maxLength={6000}
                  required
                />
              </label>
              <label>
                Acceptance criteria
                <textarea
                  name="acceptanceCriteria"
                  placeholder="What must the verifier demonstrate?"
                  minLength={10}
                  maxLength={4000}
                  required
                />
              </label>
              <div className="formrow">
                <label>
                  Builder
                  <select name="role">
                    <option value="experience_engineer">
                      Experience engineer
                    </option>
                    <option value="shopify_engineer">Shopify engineer</option>
                  </select>
                </label>
                <label>
                  Runtime
                  <select name="mode">
                    <option value="simulated">Simulated test adapter</option>
                    <option value="codex">Codex execution</option>
                  </select>
                </label>
              </div>
              <div className="formrow">
                <label>
                  Time limit (seconds)
                  <input
                    type="number"
                    name="maxRuntimeSeconds"
                    min={30}
                    max={3600}
                    defaultValue={600}
                    required
                  />
                </label>
                <label>
                  Token stop threshold
                  <input
                    type="number"
                    name="maxTokens"
                    min={1000}
                    max={1000000}
                    defaultValue={100000}
                    required
                  />
                </label>
              </div>
              <p className="muted">
                At most 2 attempts and 6 model runs. Token limits stop work when
                usage is reported; they cannot guarantee a provider spending
                cap.
              </p>
              <button disabled={busy}>
                Queue bounded task <span>↗</span>
              </button>
            </form>
          </section>
        </div>
        <div className="columns">
          <section id="activity" className="panel">
            <div className="sectionhead">
              <h2>Event timeline</h2>
              <span>Persisted events</span>
            </div>
            <ol className="timeline">
              {snapshot?.events
                .slice(-30)
                .reverse()
                .map((e) => (
                  <li key={e.id}>
                    <span className="dot" />
                    <div>
                      <p>
                        {e.message}{" "}
                        {e.simulated ? <b className="tiny">SIMULATED</b> : null}
                      </p>
                      <small>
                        {date(e.at)}
                        {e.issuer ? ` · ${e.issuer}` : ""}
                      </small>
                    </div>
                  </li>
                ))}
            </ol>
            {!snapshot?.events.length ? (
              <p className="empty">No activity yet.</p>
            ) : null}
          </section>
          <section className="panel">
            <div className="sectionhead">
              <h2>Mac workers</h2>
              <span>Outbound connection</span>
            </div>
            <div className="workers">
              {snapshot?.workers.map((w) => (
                <article key={w.id}>
                  <strong>
                    <span className={"dot " + (w.online ? "green" : "")} />
                    {w.name}
                  </strong>
                  <span className="badge">
                    {w.revokedAt ? "Revoked" : w.online ? "Online" : "Offline"}
                  </span>
                  <p>Last heartbeat: {date(w.lastHeartbeatAt)}</p>
                  <small>
                    {w.mode ?? "Runtime not reported"} ·{" "}
                    {w.activeTaskIds.length} active tasks
                  </small>
                  {!w.revokedAt ? (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => void act("revoke-worker", { id: w.id })}
                    >
                      Revoke credential
                    </button>
                  ) : null}
                </article>
              ))}
              {!snapshot?.workers.length ? <p>No workers registered.</p> : null}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get("name");
                  const result = await act("register-worker", { name });
                  if (result) setCredential(result.credential);
                }}
              >
                <label>
                  New worker name
                  <input
                    name="name"
                    minLength={2}
                    maxLength={80}
                    placeholder="Northside Mac mini"
                    required
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Register worker
                </button>
              </form>
              {credential ? (
                <div className="credential">
                  <strong>Worker credential — save locally</strong>
                  <p>
                    Copy this into the ignored worker environment file. It will
                    not be displayed again.
                  </p>
                  <input
                    aria-label="New worker credential"
                    readOnly
                    type="password"
                    value={credential}
                  />
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(credential);
                      } catch {
                        setError(
                          "Clipboard unavailable. Select and copy the credential field.",
                        );
                      }
                    }}
                  >
                    Copy credential
                  </button>
                  <button className="quiet" onClick={() => setCredential("")}>
                    Dismiss
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
        <section className="panel commands">
          <div className="sectionhead">
            <h2>Command acknowledgements</h2>
            <span>Requests ≠ completed work</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Command / issuer</th>
                  <th>Requested</th>
                  <th>Acknowledged</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.commands
                  .slice(-12)
                  .reverse()
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        {stateText(c.type)}
                        <small>
                          {c.issuer} · {c.result ?? c.status}
                        </small>
                      </td>
                      <td>{date(c.requestedAt)}</td>
                      <td>{date(c.acknowledgedAt)}</td>
                      <td>{date(c.completedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <footer>
          Northside App · Supervised development · No automatic merge or
          production deployment
        </footer>
      </main>
    </div>
  );
}
function TaskDetail({
  task: t,
  command,
  busy,
}: {
  task: Task;
  command: (c: ControlCommand) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="detail">
      <p className="eyebrow">TASK DETAILS</p>
      <h3>{t.title}</h3>
      <p>{t.description}</p>
      <strong>Acceptance criteria</strong>
      <p>{t.acceptanceCriteria}</p>
      <dl>
        <dt>Branch</dt>
        <dd>{t.branch ?? "Not created"}</dd>
        <dt>Commit</dt>
        <dd>
          <code>{t.commit ?? "No commit reported"}</code>
        </dd>
        <dt>Heartbeat</dt>
        <dd>{date(t.heartbeatAt)}</dd>
        <dt>Usage</dt>
        <dd>
          {t.usage.inputTokens ?? "Unknown"} input /{" "}
          {t.usage.outputTokens ?? "Unknown"} output · {t.modelRuns}/
          {t.maxModelRuns} model runs
        </dd>
      </dl>
      {t.pullRequestUrl && /^https:\/\/github\.com\//.test(t.pullRequestUrl) ? (
        <a href={t.pullRequestUrl} target="_blank" rel="noreferrer">
          Review pull request ↗
        </a>
      ) : null}
      {t.error ? <p className="error">{t.error}</p> : null}
      <h4>Findings</h4>
      {t.findings.length ? (
        t.findings.map((f) => (
          <p key={f.id} className="finding">
            {f.resolved ? "Resolved" : f.severity.toUpperCase()} · {f.message}
          </p>
        ))
      ) : (
        <p className="muted">No findings reported.</p>
      )}
      <h4>Verification evidence</h4>
      {t.evidence.length ? (
        t.evidence.map((e) => (
          <details key={e.id}>
            <summary>
              {e.passed ? "PASS" : "FAIL"} · {e.command}
              {e.simulated ? " · SIMULATED" : ""}
            </summary>
            <small>
              Commit {e.commit} · {date(e.finishedAt)}
            </small>
            <pre>{e.output}</pre>
          </details>
        ))
      ) : (
        <p className="muted">No checks recorded.</p>
      )}
      <div className="actions">
        {t.state === "queued" ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void command({
                type: "reprioritize",
                taskId: t.id,
                priority: Math.min(t.priority + 1, 100),
              })
            }
          >
            Raise priority
          </button>
        ) : null}
        {["queued", "running", "awaiting_review", "verifying"].includes(
          t.state,
        ) ? (
          <button
            className="secondary"
            disabled={busy || Boolean(t.cancelRequestedAt)}
            onClick={() => void command({ type: "cancel", taskId: t.id })}
          >
            {t.cancelRequestedAt ? "Cancellation requested" : "Cancel task"}
          </button>
        ) : null}
        {t.state === "failed" ? (
          <button
            disabled={busy}
            onClick={() => void command({ type: "retry", taskId: t.id })}
          >
            Retry eligible task
          </button>
        ) : null}
        {t.state === "ready_for_approval" && t.commit ? (
          <button
            disabled={busy}
            onClick={() =>
              void command({
                type: "approve",
                taskId: t.id,
                commit: t.commit!,
                evidenceIds: t.evidence
                  .filter((e) => e.commit === t.commit && e.passed)
                  .map((e) => e.id),
              })
            }
          >
            {t.mode === "simulated"
              ? "Approve simulated result"
              : "Approve this verified commit"}
          </button>
        ) : null}
      </div>
      {t.approval ? (
        <p>
          Approved {t.approval.commit.slice(0, 12)} by {t.approval.issuer}.
          Merge and deployment remain disabled.
        </p>
      ) : null}
    </div>
  );
}
