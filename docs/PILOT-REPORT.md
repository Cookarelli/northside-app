# Northside supervised pilot — current update October 17, 2026

This update supersedes the October 3 configuration and preview status below.
The integration branch reached `dd5d471` before this verification; an older local
checkout and its uncommitted worker work have been preserved.

- Existing protected branch previews: [Customer](https://northside-customer-pilot-git-in-a7ee5f-steves-projects-e37a4ef4.vercel.app/account) and [Mission Control](https://northside-control-pilot-git-int-d1af17-steves-projects-e37a4ef4.vercel.app/mission-control). Both were READY Preview deployments at `dd5d471`. Runtime secrets already exist as sensitive, branch-scoped Preview variables, with different Customer and Control database roles. They were not overwritten during this verification.
- The later [provisioning report](commerce-provisioning.md#october-16-pooler-repair) records seven successful restricted pooler logins and hosted operator authentication on October 16. This checkout's separate operator-only migration URL still fails authentication with `28P01`; that failure must not be confused with the deployed runtime connections or used to justify resetting their working passwords. No database credential was rotated or provisioned on October 17.
- The existing Shopify Headless storefront `392058` has a confidential Customer Account client. Its existing credentials were preserved privately. Saved Storefront grants are only product-listing and inventory reads; Customer Account grants are only customer and order reads. All other displayed grants are off. The exact callback and logout URLs still match the Customer branch preview. The existing installed Northside Admin app was preserved.
- A fresh read-only Storefront query, including variant inventory and price fields, returned HTTP 200 with no GraphQL errors and zero products. No catalog publication, inventory change, cart or order was created.
- Real customer sign-in completed on the protected Customer preview and survived reload. The private cards page opened; the owner/admin inspector still denied the customer session. Logout returned to sign-in, closed the other private tab, remained signed out after reload, and private orders again returned `sign_in_required`. This does not establish two-customer or existing-object Storage isolation.
- Fresh invited staff sign-in exposed `invalid_origin` from native POSTs under `no-referrer`. The accompanying narrow fix uses CORS-mode fetch to fixed same-origin endpoints, same-origin credentials, `no-referrer`, and `redirect:error`; success navigates only to fixed destinations. Both staff handlers retain all existing Origin, provider, membership and session checks. The one-time confirmation page retains its no-referrer policy. No new credential or role is introduced.
- The actual browser regression reproduced native `Origin: null`, then verified correct Origin and absent Referer on both corrected POSTs. A synthetic 307 was rejected without reaching its destination. Independent security review found no actionable issues. TypeScript, lint (one existing warning), and 349 tests passed; both builds and the client configuration scan passed. Deployment and real staff email confirmation require subsequent evidence. No email delivery is inferred from the request acknowledgment.

Purchases, collection, POS, loyalty earning/redemption and real workers remain
disabled. Staff owner verification, existing private-object Storage authorization,
second-customer isolation, catalog mapping and live webhook delivery remain
acceptance requirements. No merge or production publication is authorized.

## Historical October 3 report

The integration continues `f713f47` on `integration/supervised-store` in **Cookarelli/northside-app**. The starting checkout was clean, the existing implementation was retained, and previous child-worktree scratch files were preserved. This report supersedes the earlier local-only status in `STATUS.md`, `VERIFICATION.md` and historical customer deployment notes.

**Protected readiness previews are deployed. An operational store pilot is not yet verified.** No real customer launch, paid order, live inventory change, staff invitation, POS installation or real worker activation occurred.

## Reviewable previews

[Draft pull request #1](https://github.com/Cookarelli/northside-app/pull/1) is open on the pushed `integration/supervised-store` branch.

- [Customer app](https://northside-customer-pilot-pt6gd2w7j-steves-projects-e37a4ef4.vercel.app/in-store)
- [Mission Control](https://northside-control-pilot-fzmhopjnl-steves-projects-e37a4ef4.vercel.app/mission-control)

Both run on the established Vercel provider, in the authenticated `steves-projects-e37a4ef4` team, in separate newly created pilot projects. No accessible existing project matched this repository; unrelated projects were not changed. Both successful app deployments have `target=null` (Preview), source commit `cb7ce164b2ee9d1f786c0ac711af923809c6fe25`, Node 24, frozen dependency installation with scripts disabled, the correct app root, and shared monorepo files enabled. Later operator/worker tooling and documentation commits do not change those deployed application bundles.

Vercel initially promoted first deployments despite preview intent. Those app deployments were removed. Each new project was then initialized with an authenticated **404-only static placeholder**, containing no application or credentials; its subsequent app deployment is a true preview. Authentication protection is `all`, including placeholder aliases. No custom Northside domain was assigned, no Git auto-deploy integration was enabled, and no existing production project was modified. Do not share the placeholder aliases as app URLs.

A Vercel team-authorized identity is required to view the previews. That outer protection is separate from application authorization. Mission Control still needs its own single-operator session; invited customer-app staff do not receive control privileges. The Mac mini makes outbound HTTPS requests only. No router forwarding, inbound remote shell, or public Mac listener was configured.

## Fresh verification

- Reviewed all 15 previously applied migrations against source and the remote catalog. Applied one additive correction: `20261003170654_restrict_private_function_execution.sql`. Supabase now has **16 management migrations** and **15 customer SHA-256 ledger entries**; all 15 source checksums match exactly. None of the original migrations were rewritten.
- New Supabase project confirmed: `nrsuosydvjqovrevmych`, name `northside-app`, us-east-2, PostgreSQL 17.11. All **112 private tables** have RLS. `northside-private` Storage remains private. All seven application roles lack superuser and BYPASSRLS privileges.
- Fixed inherited PUBLIC execution on private functions. Hosted readback: **zero PUBLIC EXECUTE grants; all 15 explicit runtime grants retained**. A new full-chain local test also verifies unchanged function bodies/owners/search paths, anonymous and service-role denial, absent-session RLS, and an authorized staff write with its audit trigger.
- Actual anonymous Supabase HTTP checks: both private schemas reject Data API selection with 406/PGRST106; private bucket listing returns no objects; signing a nonexistent object and bucket metadata lookup fail. The empty bucket/nonexistent-object probes do **not** establish authorization for existing private objects. Real customer/staff Storage checks remain pending.
- **Final local validation: 296 passing tests** (72 core, 16 customer script and 208 customer TypeScript tests). The full suite passed after provisioning hardening; the core suite was repeated after the last worker reconnect-delay change. TypeScript and lint passed (one pre-existing unused-variable lint warning). Both production builds passed; the customer build was repeated after TLS hardening. Client bundles contained none of the checked server credential configuration names (26 customer and 10 control artifacts). No application database or Shopify secrets were injected into the deployed apps. Focused provisioning security tests and the final patch received independent review; this is not a hosted role-login result.
- Browser-verified the deployed customer screen at 390×844 and Mission Control at 1440×1000: meaningful content, no horizontal overflow, no framework overlay, no browser page errors. Screenshots and actual HTTP outcomes are in [preview evidence](evidence/pilot-preview.json).
- Unauthenticated public requests to both previews redirect to Vercel authentication. After passing only that outer boundary with short-lived identity tokens, Mission Control snapshot rejects an unauthenticated app session with 401, credential-free worker polling returns 401, and a foreign-origin command returns 403. Customer staff setup shows no private integration data; private orders and hosted fixture APIs fail closed with 503 while configuration is absent. This is denial/readiness evidence, **not** successful staff/customer login or a working database connection.

## Application permission boundaries

| Principal | Intended authority; local tests and source review |
| --- | --- |
| Anonymous | Public shells only; no private records or Mission Control |
| Shopify customer | Own tenant/customer cards, orders and authorized files only |
| Invited operations staff | Tenant operations and audited permitted edits; no invitations or Mission Control |
| Content editor | Content scope; no private operational data/files |
| Read-only staff | Permitted operational reads/exports; no edits or invitations |
| Admin / owner | Bounded administration and invitations; no Mission Control authority |
| Mission Control operator | Bounded queue commands, worker registration/revocation and exact-evidence approval; no customer authority, merge or deployment |

`anon` and `authenticated` SQL roles have no USAGE on either private schema. Supabase sign-in alone does not grant database access: server sessions and `ns.context()` enforce the customer app's RLS. The operator account is still the existing single-operator `steve` identity, not a multi-user staff directory. Do not share its password among staff.

## Missing private configuration, precisely

Management-connector authentication lets this task inspect/migrate Supabase. It does not supply runtime PostgreSQL passwords. Fresh catalog checks show **all seven role passwords absent**, the original five roles still NOLOGIN, and **zero Supabase Auth users**.

| Private value | Why it is needed / where it belongs |
| --- | --- |
| `MIGRATION_DATABASE_URL` | Operator-only Session pooler login for provisioning the seven existing restricted roles; never deployed to an app or worker |
| `DATABASE_URL`, `AUTH_DATABASE_URL`, `COMMERCE_DATABASE_URL`, `ENGAGEMENT_DATABASE_URL` | Independent `northside_runtime`, `northside_auth`, `northside_commerce`, `northside_engagement` passwords and TLS URLs for the original customer server |
| `LOYALTY_DATABASE_URL` | Separate `northside_loyalty` URL for its dedicated commerce background process, not the coding worker |
| `NORTHSIDE_DATA_DATABASE_URL` | Different values per project: `northside_control_server` for Control, `northside_customer_server` for the additive customer aggregate. Never interchange them |
| `SUPABASE_SECRET_KEY` | Private server Storage/admin operations after application authorization; not the public/publishable key and not a database password |
| `SESSION_ENCRYPTION_KEY` / `OPERATOR_PASSWORD` | Independently generated encryption/operator secrets; provisioner saves them privately |
| Owner Auth user ID | A real Supabase Auth user and owner membership; no invented or automatic production owner |
| Shopify credentials | Actual installed app/channel credentials and expiry; see [exact Shopify setup](commerce-pilot.md) |
| Worker credential | Revocable one-time registration from an operational Mission Control, plus a separately scoped preview-protection credential; no database/Shopify/deployment secrets |

The operator file is ignored, mode 0600, under private mode-0700 `.runtime/pilot/`. Current values remain absent. A dry-run-first [provisioning helper](commerce-provisioning.md) prepares separate app configs with durable recovery and never rotates an existing password. It has not been run against the hosted database. If the actual Supabase postgres role cannot read/lock the required catalog, it stops before changes; do not grant it broader catalog access or weaken that check to proceed.

## Shopify and collection remain gated

Public discovery for `9i3hnb-jw.myshopify.com` responds with the expected issuer. The deployed owner/admin inspector reuses the canonical Storefront, mapping and Admin services; credentialed calls have not yet passed. The original `/shop` → product → `/cart` path remains the prepared online checkout path. Hosted `/in-store`, sample QR routes and fixture staff pages show preparation status and cannot simulate a live sale.

Current product/variant mappings, fresh prices/inventory, live cart creation, checkout host/fulfillment behavior, test payments, physical scans, real webhook deliveries, staff collection and POS device behavior remain unverified. HMAC, duplicate-event handling, ownership, price/stock changes and collection separation have local contract tests. No online checkout is claimed to become a POS transaction. Staff must use verified Shopify order/payment/fulfillment records; a browser return, scan or staff click is not payment proof. The POS extension and collection workflow remain rehearsal-only until separately verified. Detailed order/staff behavior and required scopes are in [commerce pilot setup](commerce-pilot.md).

## Worker service and exact blocker

The installed Codex `0.158.0-alpha.2.1` operational probe still cannot remove its own empty temporary directory with the required recursive credential-denial policy. A secret-free dedicated directory does not fix it. The rejected policy restriction change and package-manager verification override were not retried.

A committed-source export now produces explicitly scoped files and hashes, excluding private configuration, tool state and dependencies. It is marked **prepared-only, executable=false** and is not connected to an approval path. Real workers remain disabled. No compatible VM/container runtime was installed on this Mac. Concrete alternatives are a supported sandbox correction or a separately reviewed disposable verifier VM/container with no host secret mounts, pinned offline dependencies and only the minimal provider credential for the relevant role; see [worker pilot](worker-pilot.md).

A Mac LaunchAgent plist was generated and passed `plutil -lint` at `.runtime/pilot/prepared-worker.plist`. The separate environment selects **simulated** mode and lacks a worker credential. No LaunchAgent was installed or started. The implementation includes restart throttling, private rotated logs, health reporting, cancellation/stop, OS-held duplicate-process locks, bounded job retries, exponential connection backoff capped at 60 seconds, and database job leases/fencing. Actual simulated subprocess tests cover duplicate rejection, crash, restart and clean shutdown. [Worker evidence](worker-pilot-evidence.json) explicitly separates these from real Codex execution.

A user LaunchAgent starts at login and restarts after failure. After a reboot, FileVault must be unlocked and that account must log in. It does not run before login or during system sleep. Power/sleep/login settings were not changed. Once connectivity is verified, install/start with the documented launchd commands; stop with `node --import tsx scripts/launchd.ts stop`. Remote pause stops new claims; cancel active work separately; revoke the credential to remove access.

## Exact remaining operator steps

1. In the [new Supabase project](https://supabase.com/dashboard/project/nrsuosydvjqovrevmych), open **Connect → Session pooler**. Privately save its password-bearing URL as `MIGRATION_DATABASE_URL` in `.runtime/pilot/operator.env`, with port 5432, username `postgres.nrsuosydvjqovrevmych`, database `postgres` and `sslmode=verify-full`. Under **Settings → API keys**, save the secret key as `SUPABASE_SECRET_KEY` in the same private file. Never paste either into chat. No old Supabase project credential should be used.
2. Supply the intended owner's email or an existing Auth user ID. No invitation has been sent. After a real Auth account exists, bootstrap its verified membership using the preserved owner procedure. Privately provision restricted passwords, inject only the owning app's runtime secrets into Vercel Preview settings, then redeploy. Verify each actual login over TLS and run rollback-only cross-role/RLS probes before accepting app connectivity.
3. Supply the existing Shopify app credentials using the named fields in the operator file. Follow the exact callback, scope and webhook setup in `commerce-pilot.md`. Choose stable HTTPS app/QR origins before provider registration or printing. Do not point Shopify webhooks at an authenticated preview and assume delivery works; use a reviewed narrowly scoped delivery arrangement and prove HMAC/deduplication without paid orders or inventory changes.
4. Verify real staff/customer sign-in, refresh/logout, two-customer isolation, admin-only actions and existing private-object access. Inspect published catalog/mappings read-only. Agree the non-charging test checkout/fulfillment procedure before any activation change. Keep purchase, pickup and POS gates off until evidence passes.
5. Once Mission Control's actual database and operator login pass, register a single simulated worker for remote communication/lifecycle rehearsal. Save only its worker credential and scoped protection credential in private files. Install the prepared service only after that check. Keep Codex mode off until the independent sandbox acceptance and real build/review/verify chain succeeds.

## Short in-store pilot checklist

- Confirm the intended preview/project/store, named supervisor, and visible rehearsal/setup state.
- Sign in as the authorized role; prove a signed-out customer and a second customer cannot see staff/private records.
- Scan a reviewed label on an actual phone and shared iPad; compare exact variant, current price and stock; test an invalid/expired label.
- In the authorized non-charging environment, check cart edits and checkout handoff; verify independent Shopify payment/fulfillment evidence before any collection step.
- Re-scan/retry the same handoff, webhook and collection; prove no duplicate charge, stock movement, job or release. Verify POS separately.
- Sign out/reset the shared device, pause/cancel the worker, inspect health/logs, and rehearse restart/stop. End the session with gates closed unless the supervisor explicitly approves the verified next stage.

Official references: [Vercel first-deployment behavior](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting), [monorepo source configuration](https://vercel.com/docs/monorepos/monorepo-faq), [deployment authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication), [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres). Provider documentation is configuration guidance, not evidence of completed Northside acceptance.
