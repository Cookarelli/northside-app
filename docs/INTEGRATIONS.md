# Integration inventory and inputs

No credentialed integration is connected. Prompts 2–10 identity, commerce, grading, consignment, custom loyalty, breaks, store preparation and engagement server paths/migrations are implemented locally. Shopify's public authentication and Customer Account API discovery documents were read; no credentialed provider requests, product changes, payments, emails, publication or paid subscriptions were performed. See SETUP-PROMPT-3.md for the pinned 2026-07 contract and exact external checklist.

| Boundary | Current | Needed / owner |
| --- | --- | --- |
| Shopify Storefront | Catalog/collection/search/pagination/variant/cart/checkout services locally implemented; disconnected | Steve: private Headless token, correct publication channel, trusted buyer IP, separately approved selected test catalog and real checkout. Keep bulk Draft catalog unchanged. |
| Shopify Customer Account | OAuth, profile and owned order history locally implemented; no real login | Steve: confidential client, permissions, HTTPS callbacks and hosted database; real grant/refresh/logout/profile/history checks. |
| Shopify Admin / webhooks / discount issuance | Order reconciliation, HMAC/durable jobs and exact-contract discount issuance/recovery locally implemented; no real discount created | Steve: supported installed app and order permissions, verified auth path, webhook subscriptions and a scheduled worker. Same-organization eligibility is unverified; installed OAuth requires external token management. |
| Supabase/PostgreSQL/private Storage | Not configured | Steve: project/env and private owner invite identity; migrations 001–009, five restricted roles and hosted isolation/restore tests. |
| Grading | Persistent intake/decisions/shared batches/reviewed CSV and examination references implemented; sample local database; live deployment unverified | Steve/operations: sanitized sheets and confirmation of “BGP”; PSA known, provider API absent. |
| Fanatics Collect | Manual consignment portal/import review implemented; capability-aware adapter disconnected; partner data contract unverified | Steve/partner: connector name, docs, consignor IDs, submission/listing/sale/fee/payout coverage, exports/webhooks/sandbox. Merchandise sync is not proof of payout coverage. |
| Custom Northside loyalty | Ledger, earning/refund reconciliation, holds/issuance, wallet, tiers, staff controls and analytics locally implemented; real gates off | Joey: earning rate, tier rules/period, exclusions, reward values, expiry, stacking, restoration. No paid loyalty plugin needed. |
| Breaks | Saved schedule/reminders, calendar, paid-line allocation, external purchase evidence and staff review locally implemented; real sales off | Operations: real dates/URLs, format/capacity/terms, physical fulfillment/stock pools, exact mappings and real last-spot checkout test. |
| Physical store | Staff schematic/locators/QR/scanner/pickup rehearsal implemented locally; public operations disabled | Operations: eight-aisle plan, zones, retail locators, pickup process, opening date and fulfillment verification. |
| Marketing Hub | Aggregate loyalty cohort and engagement CSV contracts; no live connection | Steve: actual export contract, campaign/consent requirements; no existing Hub modified. |
| Brand | Supplied SVG used intact | Steve supplied clean blue SVG during Prompt 1; real product/store photography remains optional input. |

Secrets belong in server environment, never commits or prompts. .env.example deliberately contains placeholders only. The development script opts into fixtures without creating a secret file.

## References and verification scope

Current Next installation guidance reviewed September 12, 2026: https://nextjs.org/docs/app/getting-started/installation . Stable package versions verified against npm registry; exact resolved versions recorded by package.json and pnpm-lock.yaml. Current TypeScript 7 is incompatible with the installed TypeScript ESLint API, so the compatible stable TypeScript 6 line is used. ESLint 10 also fails the current React plugin API; ESLint 9 is pinned for compatibility until the React plugin supports ESLint 10.

The supplied prompt preserves official links for Next PWA, Shopify Customer Account, Storefront cart, app authentication, webhook verification, Admin discount creation/lookup/deactivation, POS discount QR and Supabase RLS. Re-verify those actual provider contracts during the relevant stage, rather than claiming they were integrated now. No verified Fanatics or grading API contract is available.

Initial public logo lookup at northsidecollectibles.com failed to resolve; the user then supplied the approved-use SVG directly. No replacement logo was invented. Generic preview art is not store photography.

## Prompt 2 inputs received

Supabase project zuqktfohxqzkzumtqibg and Vercel project northsidecollectibles/northside-app were supplied. Both dashboards require sign-in in this browser. User cannot sign in until a password reset and confirmed these can wait. Do not block local work or request passwords. GitHub connected as Cookarelli has no push permission; owner can invite that account later.

Shopify discovery verified publicly: issuer https://shopify.com/authentication/103967392113, RS256 ID tokens, S256 PKCE, confidential client authentication. Actual client credentials, grant/refresh/logout remain unverified. See SETUP-PROMPT-2.md.

Prompt 4 persistence uses the documented [PGlite Node filesystem](https://pglite.dev/docs/filesystems) for local samples and PostgreSQL for live operations. Bounded CSV parsing uses [csv-parse sync](https://csv.js.org/parse/api/sync/), pinned 7.0.2. See SETUP-PROMPT-4.md for production migration 004 and external verification. No grading provider endpoint or paid plugin was added.

## Prompt 5 Fanatics evidence inventory

No partner contract was found in the supplied project. Documentation version/date, endpoint contract, authentication/rotation, exact permissions, rate limits, private consignor mapping and submission/listing/sale/fee/payout coverage remain **unknown**. The adapter advertises all provider capabilities unavailable and has no transfer capability. Its proposed normalized fields are not an assertion of partner support. No API credential, endpoint, webhook, network request, partner-page scrape, connector installation or live test was added.

Manual intake, approved matching, staff updates, CSV imports and informational partial settlement records work without that connection. Mocked adapter outage checks leave saved records intact. See [FANATICS-DATA-REQUEST.md](FANATICS-DATA-REQUEST.md) for the exact draft questions; it was not sent. [SETUP-PROMPT-5.md](SETUP-PROMPT-5.md) records migration 005, workflow bounds and the pending hosted/partner verification. Existing Next/PGlite/csv-parse versions were reused; no dependency or paid plugin was added in Prompt 5.

Prompt 6 adds a private `LOYALTY_DATABASE_URL` for the `northside_loyalty` role, a privately verified `LOYALTY_APPROVER_STAFF_ID` for Joey, installed Shopify discount permissions and a recorded authorized checkout test before `SHOPIFY_LOYALTY_CHECKOUT_VERIFIED=true` can be considered. This boolean does not enable the hard-false public gates. No credentials or real approval have been supplied. [SETUP-PROMPT-6.md](SETUP-PROMPT-6.md) records official Shopify contracts, supported checkout bounds and the complete external verification matrix. The [Marketing Hub loyalty contract](MARKETING-HUB-LOYALTY-CONTRACT.md) is a proposed Northside export, not a connected provider API. POS QR links are prepared internally only; scanner, aisles, pickup and all inventory pools remain unchanged.

Prompt 7 reuses the commerce database role and installed Admin order reader, adds read-only exact variant/inventory proof and `SHOPIFY_BREAK_CHECKOUT_VERIFIED=false`. Physical fulfillment and stock-pool checks require independent staff evidence; no Shopify setting is written. [Prompt 7 setup](SETUP-PROMPT-7.md) records API contracts and worker operations; the [before-sale checklist](BREAK-SALE-CHECKLIST.md) records required real concurrency/refund tests. Actual Facebook/Instagram URLs remain unconfirmed; only external links are supported. In-app reminders are saved locally, with no email or push sent.

Prompt 8 adds pinned [zxing-wasm 3.1.4](https://github.com/Sec-ant/zxing-wasm) for QR encoding and camera/image barcode reading, with verified local WASM hashes and license notices; no runtime CDN. Sharp 0.35.4 (already used by Next) is an explicit dependency for captioned PNGs. Live SKU/barcode verification and availability use read-only [Storefront 2026-07 ProductVariant fields](https://shopify.dev/docs/api/storefront/2026-07/objects/ProductVariant), not Admin merchandise or arbitrary scanned URLs. `NORTHSIDE_QR_ORIGIN` is an unset exact HTTPS app origin and does not activate store routes. The supplied Vercel project URL is not a verified public QR domain. Real plan, domain, catalog mapping, iPhone/Android camera and pickup/fulfillment evidence remain in [STORE-ACTIVATION-CHECKLIST.md](STORE-ACTIVATION-CHECKLIST.md). No Shopify products, stock, locations or fulfillment settings were changed.

## Prompt 9 delivery and measurement

Email adapter: Resend HTTP API with stable idempotency key and a bounded retry window. Push adapter: pinned web-push 3.6.7, VAPID, validated provider endpoint hosts and generic lock-screen payload. Both unconfigured and delivery disabled; local attempts are UNSENT. Separate `notifications:work` and `measurement:work` commands require a private hosting schedule before live operation. No scheduler or Marketing Hub connection was installed. Setup and export contract are in SETUP-PROMPT-9.md and MARKETING-HUB-ENGAGEMENT-CONTRACT.md.

## Release handoff and missing inputs

Current per-feature evidence is in REQUIREMENTS-MATRIX.md, exact private variable scope in ENVIRONMENT.md, and named input owners in LAUNCH-CHECKLIST.md. Migrations 001–009 and all five database roles are ready for hosted verification. Staff Integration health now includes staff/files, grading, Fanatics, custom loyalty, streams, notifications, Marketing Hub and phone/store readiness with next actions. A nonempty environment value never implies authenticated verification. Marketing Hub has separate loyalty and engagement export contracts and no live connection. Only previously recorded public Shopify discovery has external technical evidence.
