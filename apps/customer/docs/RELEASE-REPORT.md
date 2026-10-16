# Prompt 10 release report

September 12, 2026. **Local functional stages 1–10 and the release handoff are complete. Production launch remains pending external configuration and verification.** No site was deployed, paid plan activated, message sent, Shopify record changed or live purchase/reward/store feature enabled.

## What works now

The labeled local preview supports shopping demonstrations, owned grading and consignment records, shared grading batches, reviewed imports/customer matching, custom Northside loyalty with ledger/reservations/recovery, break schedules/reminders/purchase reconciliation, staff store/QR preparation, PWA public offline fallback, generic in-app notices, and consented show/interest metrics/exports. Saved sample records remain intact in ignored local storage. One clearly labeled long-description grading sample was added for this release review; existing records were not reset.

Prompt 10 adds a requirements/evidence matrix, Node/Vercel configuration, private variable inventory, deployment/migration/rollback and backup/restore instructions, staff quickstart, launch input owners and native/Hobby Key boundaries. Integration health now covers all providers and explains the missing next steps.

Concrete fixes: setup commands no longer expose arbitrary driver/provider error details; owner/migration malformed-configuration checks use synthetic secrets to verify that behavior. The rewards connection-error screen now separates its account/retry controls with usable target spacing, shows **Trying again…**, and disables repeated retries while a read is pending. Historical documentation now points to the current release handoff.

## Final local evidence

| Check | Result / reproducible evidence |
| --- | --- |
| Typecheck, lint, production build | PASS: `pnpm release:check` after the retry-control change. Pinned Next 16.3.5 / React 19.3.0 / TypeScript 6.0.3; Node 24.19.0 and pnpm 11.19.0. No dependency upgraded or added. |
| Automated tests | **150 passed, 0 failed**: 10 Node policy/PWA/setup tests and 140 TypeScript SQL/service/contract tests. The existing 146 remain; Prompt 10 adds 2 CLI secret-error tests and 2 complete-migration/restore tests. |
| Complete migration sequence | Actual SQL 001–009 applies in order to isolated PGlite with a minimal local Supabase Storage contract. No customer, owner, session, balance/rule, order, consignment or show/break records are seeded. Five roles start NOLOGIN/non-superuser/non-BYPASSRLS. No hosted schema was changed. |
| Backup rehearsal | Isolated data-directory archive restored all `ns` table counts, ledger-account balances and a pending reward reservation; customer A remained isolated and private session access/history rewriting remained denied. It touched only its own temporary database. Hosted PostgreSQL/Auth/Storage recovery remains unverified. |
| Production rejection suite | **105 passed** via `pnpm smoke:production` on the final build. Production received `NORTHSIDE_FIXTURES=1` deliberately and still denied demo APIs/identity/records; private endpoints rejected anonymous/cross-origin requests and live purchase/store gates remained closed. |
| Read-only staging smoke | **29 passed locally** via `pnpm smoke:staging http://127.0.0.1:3001`. Public shells, no-store, fixture rejection, private access denial, disabled routes, manifest and service worker. No remote staging target has been verified. |
| Client artifacts and command output | **23 generated client artifacts** contained none of the sensitive server environment names. The scanner also checks supplied long secret values when run in a privately configured environment; no real credentials were available here. Synthetic malformed-connection tests prove raw error values are withheld. Host/proxy/provider logs still need external inspection. |
| Mobile/desktop | Chrome measured **390/390px** and **1280/1280px** viewport/document widths for long grading descriptions, with readable wrapping and no horizontal overflow. Mobile grading intake and expanded engagement forms had no unlabeled visible inputs. The empty sample cart and honest unavailable production catalog were also inspected. In-app hidden-panel sizing did not honor requested dimensions, so exact-size evidence came from Chrome. |
| Keyboard | Enter saved the labeled sample intake and operated the retry button. ArrowRight selected Shows & QR links, with a visible focus ring and correct selected state. This is a targeted check, not accessibility certification. |
| Loading/error/retry | Read-only local proxy delayed production API reads by 3.5 seconds and injected a synthetic 503. Wallet showed loading then a visible error, no fake points or account data. Keyboard retry displayed a disabled progress control; restoring the upstream path returned the honest sign-in-required state. Proxy was temporary and never forwarded writes. |
| Existing operational risks | Full suite covers actual tenant/customer RLS, two owners in pooled batches, private files/exports, duplicate HMAC webhooks, refund ordering, last-spot constraints, signed ledger/property reconciliation, concurrent reservation/timeout/crash recovery, disabled store APIs and exact PWA static-only cache/privacy. See REQUIREMENTS-MATRIX.md for individual test files. |
| Preservation | All six source-controlled public flags remain false. Migrations 001–009, Shopify products/locations/fulfillment, three inventory pools, supplied logo and existing fixture data are unchanged. Git whitespace check passed; no `.env.local`, credential, backup archive or real customer export was added. |

Run logs are ignored local evidence under `work/prompt10-release-check.log`, `work/prompt10-production.log` and `work/prompt10-staging.log`. The source-controlled tests and scripts reproduce the checks. Browser screenshots were visually inspected during this task; they are preview evidence only and do not establish integration verification. Chrome's unrelated extension warnings were observed separately from app behavior. Earlier PWA offline/logout demonstrations and their limits remain in STATUS.md.

## External evidence and remaining gaps

Only the previously recorded **unauthenticated Shopify discovery reads** have external technical verification: Northside's pinned issuer, supported OIDC metadata and Customer Account GraphQL shop/version endpoint. These do not prove an installed grant, customer login, checkout or order delivery. Steve supplied the approved logo and confirmed the Fanatics partnership; partnership is not a verified partner API.

Still waiting: GitHub write access; chosen stable protected HTTPS deployment origin; hosted database/roles/Auth/Storage/backup/restore; actual Shopify app/channel/scopes/token lifecycle, guest/customer checkout, signed webhook delivery, concurrent PostgreSQL workers/Shopify last-spot protection and fulfillment; Joey's real loyalty economics/reward checkout approval; Fanatics contract/coverage; confirmed stream URLs/provider/show details; scheduler/monitoring; physical iPhone/Android install/push/camera/logout checks. Public scanner/directions/pickup, native distribution and a multi-vendor Hobby Key marketplace remain deferred. Email/push and live HobbyKey interest capture stay disabled. No paid loyalty plugin is needed or installed.

## Start and next action

Local preview: **http://127.0.0.1:3000/**. Exact command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

Build/verify with `pnpm release:check`; use the full runtime setup, production smoke and deployment instructions in [DEPLOYMENT.md](DEPLOYMENT.md). Staff start with [STAFF-QUICKSTART.md](STAFF-QUICKSTART.md); missing inputs and owners are in [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).

The next operational priority is account access and a stable protected HTTPS staging origin, followed by real identity and private-file verification before payments. **Return now for the requested design pass**: local functionality is complete, and the visual review can proceed while external access is restored. No dedicated redesign or next feature stage was started in this release work.
