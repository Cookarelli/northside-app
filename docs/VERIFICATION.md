# Verification — October 3, 2026

> Historical baseline: the [current supervised pilot report](PILOT-REPORT.md) supersedes deployment, credential and migration counts below. Original evidence is retained.

All results below were executed on the Northside Mac mini (Apple M4 Pro, macOS 26.6.2) using Node 24.19.0 and pnpm 11.25.0. This report distinguishes ordinary local development checks from the worker's stricter sandbox.

## Integrated local checks

- `pnpm typecheck` — passed for monorepo and preserved customer application.
- `pnpm lint` — passed with no errors; one unused-destructuring warning in control credential redaction.
- `pnpm test` — **261 passed**: 50 new/core Vitest tests, 10 preserved script tests and 201 customer tests including the additive trigger-search-path test. No skipped tests reported.
- `pnpm build` — production builds for customer and control passed; no deployment.
- `pnpm qr` — four PNG labels generated and independently decoded to their exact stable route URLs. See `outputs/qr-samples/manifest.json`.

The core tests cover exact QR/variant mapping, availability and price changes, basket concurrency, expired/repeated handoffs, cross-customer denial, staff authorization, payment/collection separation, duplicate collection, shared-session expiry/reset, webhook HMAC and replay, POS partial import, membership deduplication/refund reversal, persistent queue leases/fences/recovery, remote commands and exact commit/evidence approval invalidation. The preserved customer suite continues to test its original grading, identity, Storage, commerce, loyalty, engagement and store gates.

## Actual browser and HTTP journeys

Run the apps with `pnpm dev`, then use the local Chrome executable with:

```sh
node --import tsx scripts/verify-local.ts
node --import tsx scripts/verify-control-local.ts
```

Both require the ignored `.env.local` fixture profile. The control verification refuses paused/busy queues or online workers and restores the prior pause state if its test changes it. Use a dedicated idle local rehearsal database; never run against a live worker installation. Temporary worker credentials are mode 0600, revoked after execution, removed from disk, and never included in evidence.

`docs/evidence/browser.json` records a 390×844 phone journey from QR confirmation through basket editing, visible checkout setup gate, counter handoff and staff fulfillment on a 1024×1366 iPad viewport. Staff signs in separately, claims once, explicitly simulates payment, marks ready and verifies the distinct collection code. Browser checks also covered shared mode across reload, Start over, and a three-minute inactivity reset using an accelerated browser clock. The preserved home page rendered. Tested pages had no horizontal overflow and no browser page errors. Screenshots in `docs/evidence/` were visually inspected; actual camera scanning and physical iPad behavior remain unverified.

`docs/evidence/control-http.json` records an authenticated dashboard browser session and a separate `--once` worker process using actual HTTP endpoints. It reached ready_for_approval, matched the exact simulated commit/evidence IDs, verified pause/resume and queued cancellation, and confirmed merge/deployment remain disabled. All build/review/verification activity from that adapter is explicitly **SIMULATED**, not evidence of a real model-authored change.

## Supabase integration

Target: `nrsuosydvjqovrevmych` (northside-app, us-east-2, Postgres 17.11). The initially empty project received all 13 original customer migrations, one additive migration pinning the search path on 12 existing trigger functions, and the separate private aggregate/control migration. The original migration source files were not rewritten. Their SHA-256 ledger plus the additive migration has 14 rows in `ns_migrations.applied`.

Remote readback confirmed 111 customer `ns` tables, zero without RLS, empty new aggregate state, a private `northside-private` Storage bucket, and security-advisor `lints: []`. No customer/order/staff/payment data was imported. Management-role impersonation of the new app roles was denied by Postgres membership settings, so application-role runtime access is **not** claimed verified. Restricted passwords, pooler/TLS connections, invited users, live Storage operations, backup/restore and hosted concurrency remain activation work.

## Real runtime and limitations

The installed Codex CLI `0.158.0-alpha.2.1` is authenticated. One read-only noninteractive smoke completed successfully with the exact expected response; reported usage was 14,466 input tokens (12,288 cached) and 9 output tokens, actual dollar cost unknown. This does not prove persistent unattended authentication or a full builder/reviewer workflow.

Earlier actual macOS security probes verified dummy credential/auth files could not be read, source writes were denied, designated output writes were allowed, outbound network was denied and the coordinator could not be signaled. These security checks are distinct from the final operational preflight, which also requires test/build output cleanup. The real verifier uses copied dependencies and read-only source. Under an earlier command configuration, its actual integrated typecheck passed, but the installed sandbox blocked recursive cleanup in test-owned temporary directories under the recursive secret-file deny rules. Those failures were retained; tests and credential policy were not weakened to produce a green result. Those historical diagnostics used a pnpm dependency-verification override subsequently removed at `de97c42`. Under the **final command configuration**, pnpm performs its normal dependency check, attempts an installation and fails writing a temporary file at the read-only checkout root; typecheck, tests and build never start. The exact latest result is `docs/worker-verifier-default-deps-evidence.json`. No override was reintroduced.

The historical separate production-build diagnostic initially exposed an inferred workspace-root issue, corrected by explicit monorepo roots. It then reached Turbopack CSS/PostCSS processing and failed on a sandbox-denied port bind. The operational preflight now checks temporary-directory removal and fails before real task claims on this machine. See `docs/worker-verifier-tests-evidence.json` and `docs/worker-verifier-build-evidence.json` for the two distinct historical results. The sandbox test run passed 40 tests and failed 10 plus one suite; it did not reach the preserved customer suite. The ordinary local 261-test result above does not imply the sandboxed pipeline passed.

Independent review was performed by a separate agent that did not author the changes it reviewed. Review found and prompted fixes to persistence permissions, canonical-origin checks, session retention, sandbox isolation, dependency snapshots, shared reset feedback and verification script pause handling. The separate reviewer’s conclusion is bound to `3dfdeb38f7c2859c46761aa58d1a0a063bba8450` in `docs/evidence/independent-review.json`; the worker preflight patch at `5c65df8` and restoration of normal package-manager verification at `de97c42` have separately reviewed addenda in that file.

No LaunchAgent was installed, no continuously running model crew is claimed, and no public application was deployed. Real Shopify checkout/POS, order/inventory effects, hosted database credentials and physical-device scans remain unverified.
