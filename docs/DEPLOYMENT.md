# Deployment handoff — prepared, not deployed

September 12, 2026. Prompts 1–10 provide a local release candidate. **Customer launch is blocked on external verification.** Steve supplied Vercel project `northsidecollectibles/northside-app` and Supabase project `zuqktfohxqzkzumtqibg`; the app domain, account access and actual hosting configuration remain unverified. No paid plan or deployment has been activated.

## Reproduce the local release

Use Node 24.x (tested 24.19.0) and pnpm 11.19.0 from `packageManager`; keep `pnpm-lock.yaml`. On this Mac, if Node is missing from PATH:

```sh
export PATH=/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app
pnpm install --frozen-lockfile
pnpm release:check
```

The local sample preview uses `./scripts/preview.sh` at `http://127.0.0.1:3000`. Saved samples in `work/grading-preview/` must be preserved; they are never hosting storage. Run only one preview process against that directory.

After building, use a second terminal for the deliberately disconnected production test server:

```sh
APP_ORIGIN=https://local-test.invalid NORTHSIDE_FIXTURES=1 pnpm start --port 3001
```

Then run:

```sh
pnpm smoke:production
pnpm smoke:staging http://127.0.0.1:3001
```

The production suite deliberately supplies fixture opt-in and proves it is refused. Its POST checks contain only synthetic invalid/gated requests and the expected `https://local-test.invalid` Origin; the runner restricts that suite to loopback. Stop port 3001 after testing. These commands do not verify Supabase or Shopify.

## Selected Vercel staging deployment — actions still pending

1. Use the newly selected [Cookarelli/northside-app](https://github.com/Cookarelli/northside-app) repository. The connected GitHub account has write access as verified September 16, 2026; hosted dashboard access/configuration still needs verification. Follow [SETUP-PROMPT-2.md](SETUP-PROMPT-2.md) for provider setup, treating its older repository-access blocker as historical. Review the release commit and all launch blockers before deployment. The repository is the project root; do not select the enclosing Codex folder.
2. Inspect the supplied Vercel project and confirm ownership, permitted costs, a protected staging environment, region near the chosen database, and a stable HTTPS origin. Set `APP_ORIGIN` to that exact verified origin. Configure Shopify and Supabase callbacks against the same origin before testing identity. Random preview URLs are not interchangeable registered OAuth callbacks.
3. Use the Next.js preset, Node **24.x**, and `ENABLE_EXPERIMENTAL_COREPACK=1` in build settings. `vercel.json` specifies a frozen pnpm install and Next build. Keep framework output auto-detected; this app requires Node server functions and cannot be exported as a static site. The config sets fixtures, notification delivery and HobbyKey capture off. All six commerce/store code gates are also false. No cron route or domain is included.
4. Add only the necessary server variables in [ENVIRONMENT.md](ENVIRONMENT.md), scoped separately to staging and production. Never supply migration-owner credentials to the website. Keep secrets out of Git/build output, browser variables and screenshots. Verify that Vercel actually installs pnpm 11.19.0 and bundles Sharp and the local QR writer WASM; local Next build is not a Vercel bundling test.
5. Back up and inspect the selected staging database, then apply the complete migration sequence with `pnpm db:migrate`: **001–009**, followed by `20260916174953_grading_photos_and_northside_exam.sql`, `20260916185139_customer_grading_quotes_and_approvals.sql` and `20260916192111_grading_batch_service_setup.sql`. Prompt 10 itself required no schema change; the later authorized grading extensions do. Privately provision the five restricted LOGIN roles; verify current_user, RLS, TLS, pooling and policies using the staged application. Review existing Supabase objects before touching them. Follow [BACKUP-RESTORE.md](BACKUP-RESTORE.md). These timestamped migrations have only local test/preview evidence so far.
6. Bootstrap only the independently invited/confirmed owner. Complete actual customer login/refresh/logout, staff roles and private files using the linked setup checklists. Do not copy sample data or create a default production owner.
7. After Steve selects and authorizes the concrete target, create the protected staging deployment and run the read-only smoke command below. Then record authenticated/physical-device evidence separately. No deployment was performed by preparing these instructions.

Vercel's [Node version policy](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) supports selecting 24.x, with provider-managed patch updates. Its [Corepack instructions](https://vercel.com/docs/builds/configure-a-build#corepack) describe the build variable and package-manager pin. Checked September 12, 2026; account capabilities remain unverified.

## Conventional Node alternative

Use the same frozen install and build, privately injected environment, a process supervisor and TLS reverse proxy. `pnpm start --port 3000` binds loopback for a proxy on the same host; a container/service requiring a public interface can use `pnpm exec next start --hostname 0.0.0.0 --port 3000` behind its reviewed ingress. Set restart/health monitoring, connection budgets and redacted request logs at the host. Do not use the development server or PGlite for real records. Keep `.next`, `public`, pinned production dependencies and the local QR writer assets together. Workers require `tsx`, so their image must retain that pinned dependency as well.

## Read-only staging smoke

Replace the placeholder only after choosing the actual origin:

```sh
pnpm smoke:staging https://THE-SELECTED-STAGING-ORIGIN
```

This sends anonymous GET requests without cookies or followed redirects: public shells, production fixture denial, disabled store/interest routes, private-record denial, manifest and service worker headers. It makes no checkout, webhook, authentication, worker or message request. A hosting protection redirect is **not a pass**: use the authorized protected browser session for equivalent checks, or arrange a narrowly approved test access method. Never disable deployment protection just to obtain a green result. This does not validate authenticated ownership, provider accounts or actual delivery.

## Durable workers and operations

A Vercel website build does not run the CLI workers. Steve must select and provision a durable Node scheduler; no schedule is installed. Review a once-per-minute interval initially, bounded runs, non-overlapping execution and alerts before activation. Use the same release version and private role-specific configuration, with migrations applied first:

```sh
pnpm orders:work
pnpm breaks:work
pnpm loyalty:work
pnpm measurement:work
pnpm notifications:work
```

Order receipt persistence precedes acknowledgment; workers reread current Shopify evidence and fan out durable jobs. Two-minute leases, backoff, source uniqueness and per-order/account locks survive retries. Final expired attempts move into failed/review, rather than remaining invisible. All commands exit after a bounded pass. Loyalty stays gated; notification outcomes remain UNSENT while delivery is disabled. A zero process exit alone does not prove all jobs completed: inspect recorded state and counts.

Staff inspect `/staff/integrations`, `/staff/breaks`, `/staff/rewards` and `/staff/engagement`. Before launch, assign an on-call owner and alert on missed scheduler runs, oldest due job, failed/review counts, repeated lease expiry, webhook lag, unknown ownership, ledger discrepancies and held vouchers. Never put payloads, recipients, card details or tokens in an alert. Requeue exact durable jobs after investigation; do not delete receipts, replace uncertain voucher codes or reset points. [Loyalty recovery](LOYALTY-RECONCILIATION.md) and [break reconciliation](BREAK-SALE-CHECKLIST.md) define the business checks. Webhook secret rotation accepts one active secret and needs coordinated provider replay validation.

## Rollback and incident recovery

Record app commit, applied migration names/hashes, environment revision and verified backup before each release. Stop affected workers/new operations, keep gates off and preserve incoming receipt evidence. Roll back the app to the last tested commit only if it is compatible with the current schema; Vercel code rollback does not undo a database migration or a Shopify voucher. Prefer an additive forward migration for database defects. Never edit applied SQL or drop operational/financial history.

If data restoration is necessary, restore into an isolated target, verify it and reconcile changes since backup against current Shopify orders, surviving discount codes and notification acceptance before resuming. Revoke restored sessions; do not replay externally accepted messages or free uncertain reward holds blindly. Database and Storage recovery are separate. Steve must approve recovery objectives and the selected target before a real restore.

## Grading extensions acceptance — September 16

No new dependency or environment variable was added for photos/exams or customer quotes/approvals. The full local production rejection runner `node scripts/release-smoke.mjs` includes the exam and customer portal suites (eleven suites at that extension; twelve after staff operations below). Private photos, receipts, reports and exports must remain no-store and owner scoped. Test actual Shopify return destinations, hosted private uploads, simultaneous quote/exam/approval/dispatch changes, current approval and provider/service dispatch rejection on HTTPS staging. Preserve existing records with missing batch services; staff may configure them before first dispatch, never rewrite already dispatched service/membership history. Local test success does not establish those hosted results.

The inspected public website is Square Online. The user deferred live website navigation until later; follow [WEBSITE-GRADING-ENTRY.md](WEBSITE-GRADING-ENTRY.md) only when resumed with a verified portal domain and editor access. A Vercel project dashboard URL is not the customer-facing link target.

## Staff grading operations acceptance — September 16

Apply the additional reviewed migration `20260916195007_grading_staff_custody_and_dispatch.sql` after prior grading extensions; never rewrite applied SQL. It preserves legacy custody history without inventing dispatch/pickup evidence. No dependency or environment variable is added. The production runner now includes twelve suites, adding staff operations sessions/labels/manifests/imports/origin/fixture denial checks. Verify real multi-connection dispatch/approval/cancellation locks, mixed owners, partial return/photo readback, independent representative pickup and restored idempotent retries on HTTPS staging. Confirm the operations route trace includes the pinned QR writer WASM. Keep email disabled during testing and inspect queued failures/UNSENT without real sends. Physical camera and actual identity verification remain external acceptance. See [staff guide](STAFF-GRADING-OPERATIONS.md).
