# Supervised worker pilot preparation

The pilot changes start from source commit `f713f47ffd240673f3404bb5533cf16cfa8e2943`. A real coding service is **blocked**, while the simulated polling process and service preparation can be tested independently. No LaunchAgent was installed by these checks. No real Codex build/review/verification task was run.

## Execution layout

`tests/worker-execution-export.ts` prepares a committed-source subset in a newly created private directory:

```sh
node --import tsx tests/worker-execution-export.ts /absolute/repository EXACT_40_CHARACTER_COMMIT /absolute/private/exports
```

It reads Git blobs for that exact commit, without checkout filters, hooks, dirty source, untracked files, Git metadata, or installed dependencies. It rejects symlinks, gitlinks, unsafe paths, case-colliding names, oversized exports, and common credential-like values. It excludes dotenv files, package-manager credential configuration, private tool/account state, key/data files, and credential filenames. A deterministic manifest records every included path/content hash and every omitted path/reason. The October 3 preparation of the base commit included 411 files and omitted five configuration paths. This is not a general secret detector; operator review of committed source remains required.

The manifest says `prepared-only` and `executable: false`. Omitting inputs may affect a build. The export is not wired into the adapter, and no result from it can make a task ready for approval. No dependency installation, metadata rewriting, or bypass of pnpm dependency checks is performed. The existing isolated worktree path and failing preflight remain unchanged.

## Exact real-runtime blocker

The installed CLI remains `0.158.0-alpha.2.1`. A fresh dummy-file operational probe still returns:

> Installed Codex sandbox cannot remove its own temporary directories with required credential-denial rules. Real execution is blocked; security rules were preserved.

This happens in a minimal workspace containing no real credentials, before any repository or package-manager activity. A new source folder alone therefore does not resolve it. The prior normal-pnpm verification failure and Turbopack local-port failure remain recorded separately in the existing evidence files. Credential-denial patterns, network rules, test assertions, and normal package-manager verification were preserved. The [official OpenAI permissions documentation](https://learn.chatgpt.com/docs/permissions) describes these profiles as beta; actual enforcement probes remain required.

No Docker, Podman, Colima, Lima, OrbStack, or Apple container runtime executable was available on this host, and no corresponding container app was installed. No runtime was installed or purchased. A concrete next implementation is an independently reviewed disposable verifier VM/container with its own process/filesystem/network namespace, no host secret mounts or Docker socket, an offline prepared pinned dependency image, and only reviewed source plus a fixture-only environment. Any loopback build communication must stay inside that namespace. The coordinator would receive bounded exit/output/hash evidence, retain the exact reviewed commit binding, and reject source changes. Before activation, that verifier must pass nested secret-canary, outside-path/symlink, process-signal, network, normal dependency-check, cleanup, and all three fixed command checks. This alternative is a design proposal, not an installed or tested runtime. A supported macOS Codex sandbox correction is the other option.

## Service preparation and recovery

```sh
node --import tsx scripts/launchd.ts prepare /absolute/private/worker.env /absolute/private/prepared-worker.plist
node --import tsx scripts/launchd.ts health /absolute/private/worker-state
```

`prepare` validates and writes a plist without registering a service. The environment file must be owned by this account, mode 600, non-symlink, and ignored/untracked when inside the repository. Plist arguments are distinct escaped strings, with no secret values. Its private umask, `RunAtLoad`, `KeepAlive`, 30-second restart throttle, and 20-second shutdown timeout are validated with macOS `plutil`. `install`, `start`, `stop`, `status`, and `uninstall` retain their separate explicit actions. `stop` uses `launchctl bootout`; `uninstall` preserves state, branches, reports, and credentials.

The coordinator now uses macOS `lockf -k -t 0` on a persistent private inode. A trusted helper holds the OS lock while its coordinator pipe is open; a crash closes that pipe and releases the lock. Competing workers are rejected; loss of the lock aborts active jobs. Live legacy PID locks are honored, and stale legacy markers are preserved for inspection. `health.json` records only bounded service status; rotated `worker.log` and `launcher.log` remain private. The remote dashboard still uses actual worker polling/leases for authority.

Actual subprocess tests passed for local simulated polling, duplicate rejection, forced coordinator crash, restart, and clean SIGTERM shutdown. They used a disposable loopback fixture and dummy credentials, without registering launchd or calling a model. A LaunchAgent runs only while that user is logged in; FileVault unlock, login, power, sleep, network outages, and authentication lifetime remain operational requirements. No power or login settings were changed.
