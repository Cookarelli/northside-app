import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { ControlSnapshot, Task } from "@northside/agent-runtime";
process.loadEnvFile(".env.local");
if (process.env.COMMERCE_MODE !== "fixture")
  throw new Error("Local fixture profile required");
const origin = "http://127.0.0.1:3101";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = async <T>(action: string, data?: unknown): Promise<T> => {
  const r =
    data === undefined
      ? await context.request.get(`${origin}/api/control/${action}`)
      : await context.request.post(`${origin}/api/control/${action}`, {
          headers: { origin },
          data,
        });
  if (!r.ok())
    throw new Error(`Control ${action}: HTTP${r.status()} ${await r.text()}`);
  return r.json();
};
let workerId: string | undefined;
let initialPaused = false;
let changedPause = false;
const privateFile = resolve(".runtime/verification-worker-credential");
try {
  const unauth = await context.request.get(`${origin}/api/control/snapshot`);
  expect(unauth.status()).toBe(401);
  await page.goto(`${origin}/mission-control`);
  await page
    .getByLabel("Operator password")
    .fill(process.env.OPERATOR_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mission control." }),
  ).toBeVisible();
  const initial = await api<ControlSnapshot>("snapshot");
  initialPaused = initial.paused;
  if (
    initial.paused ||
    initial.projects.some((p) => p.paused) ||
    initial.workers.some((w) => w.online) ||
    initial.tasks.some((t) =>
      ["queued", "running", "awaiting_review", "verifying"].includes(t.state),
    )
  ) {
    throw new Error(
      "Verification requires an idle, unpaused local control plane with no queued/active tasks or online workers. Use a dedicated local fixture profile.",
    );
  }
  const reg = await api<{ worker: { id: string }; credential: string }>(
    "register-worker",
    { name: "Local verification · SIMULATED" },
  );
  workerId = reg.worker.id;
  await writeFile(privateFile, reg.credential, { mode: 0o600 });
  await chmod(privateFile, 0o600);
  const task = await api<Task>("tasks", {
    title: `SIMULATED local workflow verification ${Date.now()}`,
    description:
      "Exercise the actual HTTP coordinator using the deterministic adapter. No source modifications.",
    acceptanceCriteria:
      "Record build, independent review and verification events explicitly as simulated, then stop for approval.",
    mode: "simulated",
    role: "experience_engineer",
    maxRuntimeSeconds: 60,
    maxTokens: 1000,
    maxModelRuns: 6,
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    CONTROL_PLANE_URL: origin,
    WORKER_ALLOW_LOCALHOST: "1",
    WORKER_CREDENTIAL_FILE: privateFile,
    WORKER_ADAPTER: "simulated",
    WORKER_CONCURRENCY: "1",
    WORKER_REPO: process.cwd(),
    WORKER_STATE_DIR: resolve(".runtime/verification-worker"),
  };
  await new Promise<void>((ok, fail) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/worker/src/main.ts", "--once"],
      { env, stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(new Error("Worker verification timeout"));
    }, 60000);
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) ok();
      else fail(new Error(`Worker exit ${code}`));
    });
  });
  const snap = await api<ControlSnapshot>("snapshot");
  const done = snap.tasks.find((t) => t.id === task.id)!;
  expect(done.state).toBe("ready_for_approval");
  expect(done.evidence.length).toBeGreaterThan(0);
  expect(done.evidence.every((e) => e.simulated && e.passed)).toBe(true);
  await page.reload();
  await expect(page.getByText(task.title, { exact: true })).toBeVisible();
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({
    path: "docs/evidence/mission-control.png",
    fullPage: true,
  });
  const approved = await api<ControlSnapshot>("commands", {
    type: "approve",
    taskId: done.id,
    commit: done.commit,
    evidenceIds: done.evidence.map((e) => e.id),
  });
  expect(approved.tasks.find((t) => t.id === done.id)?.state).toBe("complete");
  expect(approved.mergeEnabled).toBe(false);
  expect(approved.deploymentEnabled).toBe(false);
  changedPause = true;
  const paused = await api<ControlSnapshot>("commands", { type: "pause_all" });
  expect(paused.paused).toBe(true);
  const queued = await api<Task>("tasks", {
    title: "SIMULATED cancellation verification",
    description: "Verify pause and cancellation of queued local fixture work.",
    acceptanceCriteria: "Cancel before any worker execution starts.",
    mode: "simulated",
  });
  const cancelled = await api<ControlSnapshot>("commands", {
    type: "cancel",
    taskId: queued.id,
  });
  expect(cancelled.tasks.find((t) => t.id === queued.id)?.state).toBe(
    "cancelled",
  );
  await api("commands", { type: initialPaused ? "pause_all" : "resume_all" });
  changedPause = false;
  expect(errors).toEqual([]);
  const evidence = {
    at: new Date().toISOString(),
    adapter: "SIMULATED",
    transport:
      "Actual local HTTP, authenticated browser and separate worker process",
    taskId: done.id,
    states: snap.events
      .filter((e) => e.taskId === done.id)
      .map((e) => ({ type: e.type, message: e.message })),
    commit: done.commit,
    verification: done.evidence,
    executions: done.executions,
    approval:
      "Matched exact simulated commit and all evidence IDs; no real code approved.",
    checks: [
      "Unauthenticated dashboard API denied",
      "Browser operator login",
      "Revocable worker registered",
      "Separate --once worker completed simulated build/review/verify via HTTP",
      "Specific simulated evidence approved",
      "Pause/resume and queued cancellation",
      "Merge and deployment disabled",
    ],
    pageErrors: errors,
  };
  await writeFile(
    "docs/evidence/control-http.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { checks: evidence.checks, adapter: evidence.adapter },
      null,
      2,
    ),
  );
} finally {
  try {
    if (changedPause)
      await api("commands", {
        type: initialPaused ? "pause_all" : "resume_all",
      });
    if (workerId) await api("revoke-worker", { id: workerId });
  } finally {
    await rm(privateFile, { force: true });
    await browser.close();
  }
}
