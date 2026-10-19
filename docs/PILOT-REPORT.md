# Northside supervised pilot — current update October 19, 2026

## October 19 acceptance runner and isolated order tests

The new `pnpm acceptance:pilot` runner verifies the two fixed, authenticated
Preview deployments without changing browser sessions. The initial live run
against `2a93d57` passed all ten application checks, including the approved Zion
catalog/detail, anonymous private-data and Control denials, disabled cart/pickup
and unsigned webhook rejection. External webhook ingress is **blocked**: the
same unsigned POST without Vercel access returned 401 before reaching the app.
No deployment protection, subscription, credential or activation setting changed.

Fresh isolated tests exercise signed raw intake, transactional receipt/job and
order/ledger rollback, replay, four-topic convergence and retry exhaustion using
in-memory PGlite and synthetic provider state. They do not create hosted orders or
run any real worker. Full commands, proof limits and exact remaining setup are in
[pilot acceptance](pilot-acceptance.md). Purchases, collection, POS and all real
workers remain disabled; production launch and merge remain gated.

Final local verification passed 361 tests, TypeScript, both builds and the
28-artifact client configuration scan. Lint has one pre-existing warning.
Independent review verified all 12 new tests and cleared the curl configuration
isolation fix. No runtime application source, credentials or schema changed.

## October 17 historical verification

This update supersedes the October 3 configuration and preview status below.
The integration branch reached `dd5d471` before this verification; an older local
checkout and its uncommitted worker work have been preserved.

- Existing protected branch previews: [Customer](https://northside-customer-pilot-git-in-a7ee5f-steves-projects-e37a4ef4.vercel.app/account) and [Mission Control](https://northside-control-pilot-git-int-d1af17-steves-projects-e37a4ef4.vercel.app/mission-control). Both branch previews were READY at `25e63a2` during the completed staff checks, with Preview target `null`. The application changes are Customer `0f9bc9e` and Control `71742a1`; subsequent commits record verification evidence. Runtime secrets are sensitive, branch-scoped Preview variables with different Customer and Control database roles. The separately approved Control operator password replacement below is the only credential rotation in this verification.
- The later [provisioning report](commerce-provisioning.md#october-16-pooler-repair) records seven successful restricted pooler logins and hosted operator authentication on October 16. This checkout's separate operator-only migration URL still fails authentication with `28P01`; that failure must not be confused with the deployed runtime connections or used to justify resetting their working passwords. No database credential was rotated or provisioned on October 17.
- The existing Shopify Headless storefront `392058` has a confidential Customer Account client. Its existing credentials were preserved privately. Saved Storefront grants are only product-listing and inventory reads; Customer Account grants are only customer and order reads. All other displayed grants are off. The exact callback and logout URLs still match the Customer branch preview. The existing installed Northside Admin app was preserved.
- A fresh read-only Storefront query, including variant inventory and price fields, returned HTTP 200 with no GraphQL errors and zero products. No catalog publication, inventory change, cart or order was created.
- Real customer sign-in completed on the protected Customer preview and survived reload. The private cards page opened; the owner/admin inspector still denied the customer session. Logout returned to sign-in, closed the other private tab, remained signed out after reload, and private orders again returned `sign_in_required`. This does not establish two-customer or existing-object Storage isolation.
- Fresh invited staff sign-in exposed `invalid_origin` from native POSTs under `no-referrer`. The accompanying narrow fix uses CORS-mode fetch to fixed same-origin endpoints, same-origin credentials, `no-referrer`, and `redirect:error`; success navigates only to fixed destinations. Both staff handlers retain all existing Origin, provider, membership and session checks. The one-time confirmation page retains its no-referrer policy. No new credential or role is introduced.
- The actual browser regression reproduced native `Origin: null`, then verified correct Origin and absent Referer on both corrected POSTs. A synthetic 307 was rejected without reaching its destination. Independent security review found no actionable issues. TypeScript, lint (one existing warning), and 349 tests passed; both builds and the client configuration scan passed. The subsequent live staff confirmation and logout checks below now pass. Email delivery is never inferred from a request acknowledgment alone.

### October 17 private authentication follow-up

- The approved Mission Control Preview password replacement is complete. The new random password was saved durably in the original checkout's ignored, owner-only `.runtime/pilot/mission-control-password.txt` before updating the exact sensitive branch-scoped Preview variable. It is not in this repository, report or browser bundle. The local Vercel CLI login was refreshed by the user; no other runtime credential or production environment was changed.
- Live checks against the final Control deployment at `71742a1` passed: anonymous snapshot **401**, foreign-Origin login and logout **403**, correct login **200**, authenticated persisted snapshot **200**, logout **200**, and replay of the revoked cookie **401**. The session cookie is Secure, HttpOnly and SameSite=Strict. The snapshot showed **zero workers and zero tasks**. Real browser operator login, sign-out and signed-out reload also passed.
- Sign out was hidden inside the sidebar footer below 900px. It now stays in the wrapping header actions. Snapshot responses from a previous authentication generation are discarded, preventing a delayed poll from restoring private data after logout. Independent review passed. Browser verification confirmed the button at an actual 822px viewport without horizontal overflow. The browser's requested 390px/820px overrides did not change the measured viewport, so exact phone/iPad dimensions remain a verification limitation.
- All **349 tests**, TypeScript and lint passed (one existing warning); both apps built successfully, and Control was rebuilt after the stale-response fix. The first test attempt failed because the sandbox denied a temporary loopback listener; the full simulated suite passed with loopback access. No real worker was started. The Customer client scan checked 28 artifacts for server configuration names; no supplied live credential was used in the secret-free build.
- In the correct Supabase project, Site URL now points to the protected Customer branch Preview and the exact `/api/auth/staff/callback` URL is allowlisted. Magic-link and invitation templates now send users to `/staff/confirm` using `TokenHash` with the respective `email`/`invite` type. Fresh dashboard readback confirmed both templates and the URL settings. An earlier email attempt expired. The later fresh email confirmation completed successfully and produced the verified owner session described below.
- The designated, email-confirmed Auth account now has the Northside **owner** role. After the user approved the owner grant, the original insert transaction stopped before writing because Supabase rejected `SET ROLE northside_auth` (`42501`). Readback then found an existing active **admin** membership; no new membership was inserted. A separately reviewed transaction used existing operator authority to promote only that exact confirmed identity's existing membership from admin to owner, preserving every other field and adding one append-only operator audit record. It changed no database grants, credentials, RLS, runtime authorization or activation gates. Independent post-commit readback confirmed `owner`, active, email confirmed, **one active owner**, and **one owner-setup audit record**. The separate live staff browser checks below also passed.
- Hosted read-only data checks found **zero ready private-file records**, **zero objects** in `northside-private`, and **one Shopify customer identity**. Existing-object Storage and two-customer isolation cannot be established from this empty/single-customer data; no artificial customer or live file was created to imply those tests passed.
- After the owner grant, live anonymous requests to private identity, cards, orders and export returned **401**. An empty staff-invitation request without a session returned **401**, and a foreign-Origin request returned **403**. No invitation address was submitted and no invitation was created by these checks. The subsequent fresh email confirmation produced a real owner session; no synthetic session or cookie was injected.
- **Live staff sign-in and logout are verified.** The user completed the fresh email confirmation; reload displayed “Signed in as owner,” and `/api/private/me` returned `{"kind":"staff","role":"owner"}`. The database-backed integration workspace and owner/admin Shopify inspector loaded. Customer-only orders returned `customer_account_required` for this staff session, and Mission Control still required its independent operator login. Logout reached `/signed-out?complete=1`, closed the other private inspector tab, restored `sign_in_required` from the private identity API, and both staff and owner-only pages remained inaccessible after navigation/reload. The browser was intentionally left signed out. Responsive staff controls were visible at an actual 628px width with no horizontal overflow; this is not an exact physical-phone/iPad test.
- The authenticated owner inspector freshly observed the existing Northside Shopify Admin installation, **`read_orders` only**, and the Advanced plan (not a development shop). Storefront still returned zero published products. Required subscriptions were not observed at the expected destination/API version for **ORDERS_PAID, ORDERS_CANCELLED, ORDERS_UPDATED and REFUNDS_CREATE**. This is not proof that no app-configured subscription exists. No recorded order jobs or received/processed Shopify receipts appeared. Both purchase and pickup gates remained disabled; no cart, order, inventory or subscription was changed by these read-only checks.
- Password replacement invalidates old operator sessions on the new deployment. Older immutable Vercel deployments retain their previous environment and remain Vercel-protected; this is **not global revocation** of their old credentials/sessions. Retiring those deployments is a separate operator action.

### October 17 Shopify catalog connection

- The empty catalog was a publication-state issue. Shopify Admin's **Active** product view returned no products; the inspected imported products were **Draft**, including stocked items. The deployed `/shop` successfully read Storefront collections but returned no products. A fresh private, read-only Storefront `2026-07` query returned HTTP 200, zero products, no further page, and `null` for the selected Draft product. There was no need to replace credentials or broaden API scopes.
- The user explicitly approved **one** pilot product: **Zion Slab Case XL**, product `gid://shopify/Product/15993305465201`, variant `gid://shopify/ProductVariant/64522145857905`, handle `zion-slab-case-xl-regular`. Its selected Shop, Point of Sale and Fanatics Collect Storefront channels were removed while it was still Draft; Online Store remained off and **Northside Collectibles Loves Park Headless** remained selected. That channel selection was saved and independently read back before changing this product to Active. No other product was activated.
- After activation, a fresh Storefront query at `2026-10-17T19:47:06.418Z` returned exactly **one product**, the exact matching variant, **USD 144.95**, `quantityAvailable: 4`, `availableForSale: true`, and `currentlyNotInStock: false`. Shopify Admin independently showed the same unchanged price and quantity; the variant's stock is at **Northside Retail Floor**. No price, inventory, fulfillment setting, order or cart was changed. The product has no image, SKU or barcode; missing data remains missing.
- The deployed `/shop` now shows the real product, search for `Zion` returns it, and its product-detail link renders the exact price and variant with **“Purchases not open yet”** disabled and **“Pickup is unavailable.”** The live `/api/commerce/cart` still returns `purchases_disabled`. Final publication readback showed Headless only; Online Store, Shop, Point of Sale and Fanatics were off, and the Agentic category showed **Shopify Catalog: Unpublished**.
- Saved Storefront permissions remain only product-listing and inventory reads; checkout permissions remain off. These settings and app gates prove the application's restricted pilot behavior, not a Shopify-wide checkout prohibition. No application code, credential, runtime role or feature gate changed. Product/variant provider identity is now verified; no in-app QR/store-registry mapping was created and physical barcode/QR scans remain unverified.
- Independent code review found no ungated app purchase path. All **21 focused commerce, commerce-pilot and policy tests passed**. Seven direct local requests across cart GET, add/update/reset/checkout, breaks and loyalty were rejected before any provider call. These local route probes used mocked provider transport; they are not live Shopify cart or checkout acceptance. Documentation whitespace validation passed.

Immediate remaining steps: select and separately approve any additional products for Headless-only publication; provide the real image/SKU/barcode for the pilot item if required; complete its reviewed retail mapping and physical scans. Use authorized test data and a second real customer to verify private Storage and cross-customer access, and complete the remaining operations/content-editor/read-only role matrix. Staff owner login/logout, owner-versus-customer separation and separate Mission Control login have passed. The separate operator migration URL last returned `28P01`; runtime passwords must not be reset to work around it. Live webhook delivery remains unverified, and exact phone/iPad checks require a working viewport override or physical devices. Default Supabase email delivery remains rate-limited and is unsuitable as evidence of production mail readiness.

Purchases, collection, POS, loyalty earning/redemption and real workers remain
disabled. Existing private-object Storage authorization, the remaining staff role matrix,
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
