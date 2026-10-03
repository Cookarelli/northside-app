# Northside supervised worker

## Status and scope

The queue, SQLite persistence, simulation runner, revocable credentials, lease fencing, and operator approval workflow work locally. Simulation is always labeled **SIMULATED**: no model, source edit, or test result is represented as real. The real adapter is implemented with supported `codex exec`, new executions for builder/reviewer, and fixed local verification commands. A simple installed Codex read-only smoke returned `NORTHSIDE_RUNTIME_READY` with exit 0; it reported 14,466 input tokens (12,288 cached), 9 output tokens, and no actual dollar cost. This does not prove an always-on deployment or lasting unattended authentication.

The installed macOS/Codex security probes passed using dummy files: workspace reads allowed; worker/auth credential reads denied; read-only writes denied; permitted verification output writes allowed; outbound networking and signaling the coordinator denied. The complete operational probe now also checks temporary-directory deletion and **fails on the installed CLI with EPERM for its own empty output directory**. Real mode therefore fails closed before claiming tasks. Required credential-denial rules and test assertions were preserved. No LaunchAgent was installed or started by this implementation. Full real builder→reviewer→verification is blocked on this sandbox compatibility issue and dedicated-account setup. See the precise [sandbox test evidence](worker-verifier-tests-evidence.json) and [independent build diagnostic](worker-verifier-build-evidence.json).

The final command configuration at `de97c42` retains normal pnpm dependency verification. Its isolated diagnostic invokes a dependency installation before the requested script and fails creating a temporary file at the read-only checkout root (EPERM). **No typecheck, tests or build start under this final configuration.** See [final dependency-check evidence](worker-verifier-default-deps-evidence.json). The earlier results below used an explicit dependency-verification override that has since been removed; they document additional compatibility issues, not a passing final verifier. Dependency preparation must be corrected without disabling verification or broadening source/secret permissions.

Historical isolated diagnostics used source commit `3dfdeb38f7c2859c46761aa58d1a0a063bba8450` and Node 24.19.0. `pnpm typecheck` passed. `pnpm test` reported 40 passed and 10 failed plus one suite teardown failure: directory removal returned EPERM in `tests/data.test.ts` lines 31/53, `tests/commerce-api.test.ts` line 32, and the worker test cleanup hook. The customer suite was not reached. A separate `pnpm build` diagnostic failed while Turbopack processed customer `globals.css`: its child process attempted to bind a local port, which the network-denied sandbox rejected. Control build was not reached. These are failed verification results; the same fixed scripts were not changed or their failures suppressed. Automatic approval review rejected narrowing recursive credential-denial patterns to work around deletion; that change was not applied.

This worker targets the concrete monorepo source paths in `apps/worker/src/policy.ts`. The integrated existing customer application's `apps/customer/app` pages and `components` are within Experience Engineer ownership, subject to the original repository's grading and disabled-feature requirements. Customer `lib/`, API/auth paths, control-plane authorization, worker code, dependencies, and policy files remain excluded. Extending ownership requires separately reviewed operator work; do not broaden policy through an ordinary task. Northside HQ is out of scope.

## Local simulation

1. From the repository root, install the pinned dependencies and start the apps using the root README. Open `/mission-control`, authenticate with the operator credential, and register a worker. Registration displays its credential once; the database stores only a SHA-256 digest. Save it privately to `.runtime/worker-credential` and run `chmod 600 .runtime/worker-credential`. Never paste the credential into a task or chat.
2. Copy `apps/worker/.env.example` to `.runtime/worker.env`, set private file mode 600, and fill local settings. Values below are examples of non-secret settings; use absolute paths for launchd:

   ```dotenv
   CONTROL_PLANE_URL=http://127.0.0.1:3101
   WORKER_ALLOW_LOCALHOST=1
   WORKER_CREDENTIAL_FILE=/absolute/northside-app/.runtime/worker-credential
   WORKER_ADAPTER=simulated
   WORKER_CONCURRENCY=1
   WORKER_REPO=/absolute/northside-app
   WORKER_STATE_DIR=/absolute/northside-app/.runtime/worker
   ```
3. Run `node --env-file=.runtime/worker.env --import tsx apps/worker/src/main.ts`. Create a task explicitly using simulated mode. `--once` polls, claims eligible work once, waits for those jobs, and exits. No models run while idle.
4. A completed simulation stops at `ready_for_approval`. Approval records the precise simulated commit/evidence and explicitly remains simulated. Merge and production deployment are disabled.

For hosted control, use its HTTPS origin and remove `WORKER_ALLOW_LOCALHOST`. The worker initiates outbound requests only to `/api/worker/poll`, `/claim`, `/heartbeat`, and `/report`. No public listener, shell endpoint, or port forwarding exists. Redirects are rejected so worker credentials are not forwarded to another origin. Only explicit loopback HTTP development is accepted.

For a Vercel-protected preview, optionally set `WORKER_VERCEL_BYPASS_FILE` to a separate mode-600 regular file owned by the worker account, with no symlink components. This option requires the exact HTTPS `CONTROL_PLANE_URL` origin. The coordinator sends its contents only as the `x-vercel-protection-bypass` header on those four control requests, never in a URL, task, log, or Codex subprocess environment. The worker bearer credential remains required. Omit the option locally. Provision and revoke this narrowly scoped project bypass separately; see [Vercel's automation-bypass documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

The state directory must be owned by the account with mode 700. Worker health is recorded privately in `health.json`; `node --import tsx scripts/launchd.ts health /absolute/worker-state` checks freshness, process existence, status, and last successful poll. It reports `starting`, `online`, `degraded`, `blocked`, `stopping`, or `stopped`, without credentials or response bodies. A healthy fixture worker is still explicitly simulated.

Connection failures use the configured poll delay on the first failure, double it on successive failures up to 60 seconds, and reset after a successful polling/claim cycle; health records the effective delay. Job retry gates and lease heartbeats are unchanged.

## Real coding runtime

The supervised-pilot preparation and concrete remaining execution alternative are documented in [worker-pilot.md](worker-pilot.md). Its sanitized source export is explicitly incomplete and never accepted as verification evidence. It does not activate real mode or replace any sandbox rule.

Use a dedicated, non-administrator macOS account and a dedicated clone with installed pinned dependencies. Keep business/provider/control-plane credentials out of that account except the worker's revocable credential and the dedicated Codex login. Do not grant Accessibility, automation, or broad keychain permissions. Configure `WORKER_CODEX_HOME` outside the checkout, authenticate privately under that account using the installed supported CLI, and check `CODEX_HOME=/absolute/dedicated-codex-home codex login status`.

Set `WORKER_ADAPTER=codex`, `WORKER_ISOLATED_ACCOUNT=1` only after provisioning that isolated account, `WORKER_CODEX_HOME`, `CODEX_BINARY`, and `PNPM_BINARY` to stable absolute paths. `PNPM_BINARY` must reference the direct installed pinned pnpm `bin/pnpm.mjs` or `bin/pnpm.cjs` implementation; Corepack shims are rejected because they may resolve or download outside the sandbox. The selected Node executable and pnpm implementation are granted read access. Pin and retest CLI upgrades. No model is pinned here: the account's supported default is used. Current inspected CLI was `0.158.0-alpha.2.1`; required flags are checked on startup. `--ignore-user-config` retains CLI authentication but ignores its normal user configuration. Project/system Codex config is rejected rather than silently inheriting extra policy. Apps, plugins, browsers, Computer Use, hooks, extra agents, skill discovery, and hosted web search are explicitly disabled. A sanitized child environment omits worker, Shopify, database, and operator secrets.

The model tools use a named Codex permissions profile: deny filesystem root, permit minimal runtime paths, Homebrew binaries/libraries, and read-only worktree files; deny the worker state and Codex auth directories, Git/config directories, environment files, and network. **Do not add `--sandbox`: legacy sandbox settings override named profiles.** The trusted CLI can authenticate; its model-spawned tools cannot read that authentication directory. Every startup probes actual enforcement and temporary-directory operations with dummy files and fails closed if unavailable. The installed CLI currently denies temporary-directory removal; use a supported runtime correction or a separately reviewed cleanup harness, never a broad credential-denial exception. The probe itself makes no model call or outside request:

```sh
node --import tsx tests/worker-sandbox-probe.ts
```

Builder executions return bounded structured file proposals. The coordinator rejects traversal, symlinks, unauthorized file paths, credential/auth files, manifests, dependencies, and policy changes before applying anything. Only the coordinator writes the isolated branch and commits locally. A separate reviewer execution receives the complete bounded patch and current source; a truncated patch is rejected. Reviewers cannot write. No push, PR publication, merge, external mutation, or deployment is provided by the worker.

Verification source and copied dependencies are read-only. Only predefined build/test output directories (including Vite caches and customer fixture outputs) and a task-local temporary directory are writable. Verification runs `pnpm typecheck`, `pnpm test`, and `pnpm build` under a supported Codex OS sandbox. Trusted installed dependencies are copied with preserved relative workspace links into the task checkout; verification never follows links back to main-branch source. Secrets and network remain denied. No executable or shell command comes from task text. Verification records actual exit status, bounded redacted output, timestamps, and the exact reviewed commit. Changed source after verification invalidates readiness. Dependency installation and any browser/hardware journeys not in the fixed scripts must be explicitly prepared by the operator; do not claim them passed from model prose.

Official sources checked October 3, 2026: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [authentication](https://learn.chatgpt.com/docs/auth), [permission profiles and enforcement](https://learn.chatgpt.com/docs/permissions). Account eligibility and unattended authentication lifetime are not inferred from a login status. If login, access, configuration, or sandbox checks fail, run the simulation adapter and resolve the recorded requirement.

## launchd

Run as the dedicated user from the repository root after a successful foreground test:

```sh
node --import tsx scripts/launchd.ts install .runtime/worker.env
node --import tsx scripts/launchd.ts start
node --import tsx scripts/launchd.ts status
node --import tsx scripts/launchd.ts stop
node --import tsx scripts/launchd.ts uninstall
```

Install writes a mode-600 user LaunchAgent plist but does not start it. Start uses `launchctl bootstrap` and `kickstart`; stop boots it out so KeepAlive cannot immediately restart it. Uninstall preserves all data, credentials, branches, and checkpoints. Paths and XML values are escaped; no secrets appear in the plist. Process output is redacted and rotated by the launcher. The worker refuses root.

A **LaunchAgent** runs after that user logs in, in the user's GUI session. It is not an always-running boot daemon. A **LaunchDaemon** can run before login with an explicit unprivileged `UserName`, but credential/keychain access, filesystem availability, permissions, and session-dependent tools require separate setup and testing. This implementation intentionally installs only a LaunchAgent. After power loss, FileVault may require physical unlock and user login before the worker runs. No FileVault, automatic-login, sleep, or power settings are changed. Sleep, logout, network loss, and expired authentication can make the worker offline; the dashboard uses actual heartbeats.

## Recovery, controls, limits

Claims atomically allocate an attempt ID and monotonically increasing fence. Heartbeats renew 60-second leases by default. Every update checks worker identity, attempt, fence, and unexpired lease. Revocation immediately blocks its active tasks. Expiry blocks uncertain work; it never automatically repeats a possible mutation. Inspect local `journals/`, `executions/`, and `worktrees/` before creating replacement work. A late worker cannot overwrite a new attempt. Per-process state-directory locks prevent accidental duplicate coordinators.

Pause immediately stops new server claims and allows current work to finish. Active cancellation stays pending until a worker acknowledges it, then sends SIGTERM and, after two seconds if needed, SIGKILL to the child process group. Offline workers cannot acknowledge immediately. Stopping the worker or losing lease contact halts its children and preserves useful work. Retry accepts only eligible `failed` tasks, never uncertain `blocked` tasks, and retains cumulative run/fix limits. Dependencies must already exist in the same project, preventing cycles or recursive task creation. Only operators create tasks; workers cannot spawn new queue tasks.

Defaults: concurrency 1, maximum 2 across the control plane; 900 seconds per attempt (maximum configurable 3,600); 2 attempts (maximum 3); at most 6 model executions; 2 fix/review cycles; reported token limit 100,000. Model-run and wall-clock limits are local hard stops. Token usage is checked between executions when provided; it can overshoot during one execution and is not a hard provider cap. Actual cost is `unknown` unless reported—no invented estimates. Configure provider-side spending policy separately if available for the account; this system cannot promise hard provider spending enforcement.

The worker samples its state directory disk usage and free space each poll, aborts active jobs and stops claims over the configured budget (10 GiB default) or below 1 GiB free space, and preserves worktrees. This is a best-effort sampled limit, **not an OS disk quota**: a process can exceed it between samples. Log files rotate at 5 MiB with three backups. Command output is capped at 2 MB, proposals at 512 KB, and model response files at 600 KB. Run `node --env-file=.runtime/worker.env --import tsx apps/worker/src/main.ts --cleanup` to delete only old rotated log backups. It never deletes worktrees, branches, journals, evidence, or checkpoints. Archive/integrate preserved work manually after review; no automatic unmerged-branch cleanup exists.
