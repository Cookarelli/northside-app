# Architecture

## Prompt 1 implementation (historical foundation)

Next.js App Router is the sole application framework. Server layout loads typed domain services, then provides safe fixture data to a client preview shell. React context holds sample identity, cart and draft tier edits only in memory; refresh resets them. No localStorage, sessionStorage, cookies, provider secrets or customer database. Native buttons/labels/selects and Radix tabs provide accessible controls; Lucide supplies generic UI icons.

- app/: explicit customer and staff routes, dynamic server rendering, metadata/manifest, not-found handling and global brand tokens.
- components/preview.tsx: customer UI and in-memory fixture interactions.
- lib/contracts.ts: commerce, accounts, grading, consignment, breaks and Northside loyalty interfaces.
- lib/adapters/fixtures.ts: server-only fictional source, no network requests.
- lib/adapters/disconnected.ts: explicit empty/unavailable implementation, no inferred balances.
- lib/services.ts: server-only adapter selection. Fixtures require NORTHSIDE_FIXTURES=1 AND NODE_ENV != production. Production cannot request demo identity or details via a URL parameter.
- lib/policy.mjs: immutable false public flags; checkout and redemption boundaries always reject. No mutation APIs or live purchase paths exist in this stage.
- /staff: server-gated to fixture development only, 404 otherwise. This is not staff authentication or authorization.
- scripts/: local start helper and policy regression tests.

All pages are dynamic and responses request private/no-store. No service worker or offline/private caching. Manifest is foundational only; real install/offline/update/privacy validation belongs to Prompt 9. No real customer information enters the application in Prompt 1. The aggregate preview loader is for fictional data only: Prompt 2 adds a separate authenticated per-route loader for private live records; the aggregate fixture loader never receives those records.

## Prompt 2 infrastructure

PostgreSQL via Supabase, private object storage and invited staff Auth; Shopify OAuth/OIDC customer identity through supported current libraries and HTTPS callbacks. Runtime database role distinct from migrations, server verified tenant/customer context and database isolation; no claims that service-role bypass credentials enforce RLS. Domain authorization must precede signed private file URLs. No cross-shop SSO by email.

Server-only provider configuration and tokens. Durable verified webhook receipts/outbox, asynchronous idempotent jobs and ledger transactions replace in-memory state in later stages. No process timers as production delivery. Loyalty reservations survive uncertain voucher creation and reconcile before retry. Marketing gets consent-aware redacted export fields, not operational private notes/payouts.

Normal `next build` and `next start` deployment; Vercel project northsidecollectibles/northside-app was supplied, and no deployment was performed. Prompt 10 documents migrations/rollback/backups and the concrete launch handoff in DEPLOYMENT.md. Domain contracts can be reused for native later; web UI reuse is not guaranteed.

## Prompt 3 commerce implementation

`lib/server/storefront.ts` implements the published-channel catalog, cursor browsing/search/collection filters, variant availability, cart lines, buyer identity and fresh hosted-checkout URLs. Storefront is the only public merchandise source; no Admin-product proxy exists. `lib/commerce.ts` defines the live types, separate from explicitly fictional Prompt 1 records. Live shop/product/cart components load through per-route services; fixture shopping state now preserves filters/page in the URL.

Cart IDs are encrypted in `ns.commerce_carts`, addressed by a random Secure/HttpOnly cookie. Raw cart IDs and raw cart-line identifiers never enter client props. A cart bound to a customer requires that authenticated customer; a signed-out or different customer cannot read it. Origin-checked mutation bodies accept only action/variant-or-line handle/quantity, reject client prices and identities, and hit a hard disabled purchase gate before any live operation. Stock checks include existing quantities and refuse unknown stock/backorders; Shopify remains the authority at checkout. Application checks are not reservations.

Verified Customer Account profile responses bind the shop-scoped Shopify customer ID to the internal verified OAuth customer. Owned history uses the current Customer Account token without an arbitrary ID/email selector. Local reconciled-order reads additionally use server filters and runtime RLS through that mapping. No cart or campaign can claim an order.

The separate `northside_commerce` role handles encrypted cart records, durable webhook receipts/jobs, current Shopify order snapshots and immutable order ledger entries. It cannot read sessions, customer authentication tokens or grading/consignment tables. The auth role can write verified customer mappings but cannot read order ledger records. Customer runtime views cannot read raw jobs/ledger or cart storage. All new tables have RLS.

`order-jobs.ts` verifies raw-body HMAC, exact shop and supported topics, persists receipt+job atomically, and processes asynchronously through the bounded `orders:work` CLI. Claimed jobs have expiring leases and retry backoff; per-order locks precede authorized Admin reads. Current-state snapshots converge across duplicate and out-of-order notifications; stale reads cannot reverse newer refunds. Immutable snapshots describe financial order state only. No loyalty earnings, voucher issuance or per-line economics run before Prompt 6.

Server config pins 2026-07. `admin-shopify.ts` supports the same-organization credential exchange only after explicit configuration of verified eligibility; otherwise a supported installation/token-management path must provide an unexpired OAuth grant. Admin installation/refresh-token management is an external prerequisite, not a fabricated permanent token. `staff/integrations` exposes redacted live read status to authorized staff; fixtures make no provider calls. No scheduler is deployed.

Optional campaign consent stores first/latest registered opaque references, timestamps and expiry in server records. Checkout forwards only eligible references via cart attributes. No personal data is put in those URLs or attributes, and attribution is not purchase evidence. Full marketing workflows remain Prompt 9. See SETUP-PROMPT-3.md for exact scope, provider references, setup and unverified external checks.

Prompt 2 adds lib/server for separate runtime/auth PostgreSQL connections, provider verification, encrypted durable sessions, transaction-scoped RLS, owned record services and private Storage authorization. app/api/auth and app/api/private expose only guarded server endpoints; components/live-records.tsx provides production account/cards/staff states without loading private records into the fixture context. Supabase migrations define the real persistence model. PGlite runs the migration and actual services locally; hosted provider checks remain pending. See AUTH-AND-PRIVACY.md for the exact enforcement path and SETUP-PROMPT-2.md for environment setup.

## Prompt 4 grading persistence

Migration 004 adds snapshotted intakes, stable physical-card records, editable rate/status configuration, public append-only milestones, private append-only audit history, customer decisions, case-scoped receipt claims, source-separated payment references and stable external import IDs. Grading services and CSV/batch operations use the existing runtime actor and transaction, compound foreign keys and RLS. Security-definer decision/claim functions use a fixed search path and the verified session context. Customer data projections omit shared batch details and private audit reasons. Existing consignment presentation is kept separate from the current grading status view.

`/api/private/grading` is authenticated and same-origin for mutations. `/api/preview/grading` is guarded local-only and uses PGlite filesystem persistence with the same SQL roles/services and fictional actors. The database module loads only after fixture rejection in the route. It never uses real provider secrets and has no production fallback. `work/grading-preview/` is ignored and not deployment storage. Live card images use private Storage; the local sample attachment is a known illustration only.

Imports save bounded mapped previews before reviewer confirmation; commit rechecks state under a transaction lock. Safe reversal voids untouched intakes and adds cancellation history while reserving external IDs. Intakes snapshot integer-cent rates, and full-intake subtotals are computed by SQL. Payment references never mutate Shopify financial records. SETUP-PROMPT-4.md documents exact bounds and hosted verification gaps.

## Prompt 5 consignment persistence

Migration 005 extends `ns.consignment_items` and preserves existing rows. Composite foreign keys link the actual card/case/customer; item and approved external ownership are immutable. Public append-only events, private audit history, append-only settlement/reversal entries, external link fingerprints/timestamps and saved import rows/snapshots are separate tables with RLS. Services require the existing refreshed actor, explicit customer filters and staff permissions. Settlement totals are informational, locked per item and capped against known net; reference locks/uniqueness and immutable reversals prevent double recording. Unknown amounts stay nullable. No payment-transfer method or Shopify/loyalty financial write exists.

`/api/private/consignment` serves authorized records, edits, files, exports and staff import review. `/api/preview/consignment` requires the same explicit loopback/non-production guards as grading. Both previews share the ignored local filesystem database; a local initializer applies only the new schema and labeled examples, preserving grading edits. Hosted runtime always uses PostgreSQL and never loads these sample identities.

The server-only `FanaticsCollectAdapter` defines capabilities and proposed normalized nullable fields, plus a disconnected implementation. Those field names are Northside's boundary, not a discovered partner schema. No provider HTTP call or authenticated scrape is implemented. Health failures return an unavailable state while manual records remain untouched. Partner specification version, authentication, permissions, quotas and live evidence are unknown; see FANATICS-DATA-REQUEST.md.

Consignment imports use the existing bounded CSV parser. Saved source rows retain current item snapshots/versions for review. Approved stable identity is checked independently of title/email, duplicates are no-ops, stale/conflicting source data stays in review, and the commit rechecks all matches/versions atomically. Blank optional fields preserve known values. Changes after preview require a fresh reviewed preview. Unlike untouched grading-intake reversal, consignment imports may update existing financial records and use explicit item/settlement corrections instead of a broad destructive rollback. CSV exports exclude other owners/private evidence and neutralize formulas.

## Prompt 6 custom loyalty

Migration 006 extends the original loyalty tables and adds current normalized order snapshots, frozen line allocations, durable leased jobs, immutable usage/restoration/clearance/audit records and a staff review queue. A database AFTER INSERT trigger updates cached points only for actual new ledger entries. Source uniqueness plus account/per-order locks protect idempotence; financial history cannot be updated or deleted. A mismatched cache blocks financial operations and appears in reconciliation.

`loyalty.ts` owns draft validation, version approval, verified enrollment, per-line integer earning/reversal, scoped wallets and spend-based tiers. `loyalty-orders.ts` reads complete supported Shopify order data without tax/shipping/gift-card earning. `order-jobs.ts` now atomically enqueues a loyalty order job after commerce reconciliation. A separate `northside_loyalty` SQL role can reconcile order snapshots and issue rewards but cannot read sessions, tokens or grading/consignment data. Auth and commerce keep their original separate roles.

`loyalty-redemption.ts` reserves points and enqueues an issuance job in one runtime transaction. The worker claims expiring leases, queries a stable high-entropy code before creation and atomically saves a confirmed voucher, exchange debit and completed reservation. Uncertainty keeps the hold. `loyalty-discounts.ts` implements the supported Admin discount contract with exact customer/value/scope/minimum/expiry/combination checks. Actual paid usage is a separate immutable record. Manual capped restoration requires evidence; cancellation requires confirmed deactivation and independent pending/paid checkout clearance, never an asynchronous usage-count guess.

`/api/private/loyalty` uses the existing verified actor, same-origin mutations and scoped runtime RLS. `/api/private/loyalty/cart` accepts only an owned voucher ID, binds its customer’s cart and reads Storefront applicability. Both public purchase and redemption gates stay off. `/api/preview/loyalty` rejects production and requires loopback/same-origin fixture opt-in before loading the ignored persistent database and its local provider simulator. No live adapter is used by samples.

`/rewards` and `/staff/rewards` use `components/loyalty-workspace.tsx`. Rules and stored voucher snapshots are independent of brand UI. `loyalty-reporting.ts` provides period/source/definition metadata, signed balances, separate issue/use counts, explicit exposure scenarios, reconciliation and an aggregate CSV contract with small-cohort suppression. No PII or operational payouts enter that export. The future POS URL helper has no public QR/scanner route or enabled staff redemption interface. See SETUP-PROMPT-6.md for limits; actual checkout, hosted parallel-worker behavior and provider reconciliation are not locally provable.

## Prompt 7 break operations

Migration 007 extends schedule/mapping records and adds reminders, participant preferences, immutable audits/checks/purchase events, provider snapshots, durable jobs, source-separated purchases, constrained allocations and exceptions. Runtime customer/staff RLS and commerce worker access remain separate. Public security-definer projections expose only published finite spot counts and consented aliases. Immutable source line identities, tenant/customer/mapping foreign keys, maximum-slot checks and an active-slot unique index enforce allocation boundaries.

`lib/server/breaks.ts` handles schedule/ownership-aware reminders/mappings; `break-calendar.ts` serializes RFC 5545; `break-purchases.ts` reconciles verified current Shopify lines and independently evidenced legacy purchases; `break-commerce.ts` verifies finite tracked physical merchandise and guards every cart path; `break-worker.ts` handles bounded durable reconciliation. The shared read-only normalized order reader does not mix loyalty or retail ledgers into break allocations. Per-order locks precede provider reads; stable event locks serialize allocations. Refunded holds require an explicit eligible release and can never be automatically reactivated by replay.

`components/break-workspace.tsx` powers customer and staff routes with separate private fetches and account-keyed state. The home next-break module reads the public schedule. Fixture routes dynamically load the shared saved local PGlite database only after loopback/production/origin checks. Production never substitutes this database or its events. Calendar download/reminder persistence is independent of future notification delivery. See SETUP-PROMPT-7.md for rollout order, limits and concurrency proof still required outside PGlite.

## Prompt 8 store preparation

Migration 008 separates editable aisles/nodes/edges and three-pool physical locators from registered Shopify product/variant identities and assignments. Staff runtime RLS, role checks, version/transaction locks, compound foreign keys and immutable identity triggers protect edits. Store reasons and transitions enter append-only audit. Pickup storage is explicitly fixture-only: live recording is rejected.

`lib/server/store.ts` implements staff services and safe customer projections; fixed-search-path SQL projection functions exclude internal storage and private QR placement. `store-api.ts` dispatches authenticated staff actions; `store-preview.ts` initializes saved local samples only behind the fixture/loopback/origin checks. The public customer routes return 404 and `/api/store` first enforces hard-false flags. There is no production fallback to PGlite.

`store-label.ts` uses pinned local ZXing WASM to encode stable opaque app URLs and Sharp to render visibly captioned downloads. `components/store-scanner.tsx` decodes video/images locally, validates text through the registry, selects verified variants and reads fresh Storefront prices/online availability. Arbitrary scanned URLs are never fetched. Its future add action uses the existing gated Shopify cart route; it has no inventory-writing capability. See SETUP-PROMPT-8.md for role boundaries, lookup/list bounds, WASM hashes, domain and activation prerequisites.

## Prompt 9 engagement boundary

Migration 009 adds preference/contact/subscription, in-app notification/outbox, show/placement, consented visitor/event and measured-order/job tables. A separate least-privilege `northside_engagement` connection handles delivery and attribution state. Transactional status/reminder triggers enqueue jobs; order ledger changes enqueue current-provider-read measurement independently of loyalty. Runtime APIs enforce verified ownership and staff roles. The service worker only caches an exact public static allowlist and provides a generic offline page. See SETUP-PROMPT-9.md for leases, cancellation, encryption, consent, logout and limitations.

## Current release handoff

Prompts 1–10 are locally implemented. Node 24.x and pinned pnpm drive the existing Next server; vercel.json prepares the same app for a reviewed Vercel target. No hosting or scheduler was deployed. All migrations 001–009 are preserved unchanged; Prompt 10 requires no new schema. The release test applies the full sequence without live sample seeds and restores an isolated data-directory backup with privacy roles and reward holds intact. Setup CLIs now withhold raw driver/provider errors. REQUIREMENTS-MATRIX.md and RELEASE-REPORT.md are the current evidence index; earlier sections describe the architecture as it grew.
