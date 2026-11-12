# October 29 launch-readiness implementation

Implementation branch: `fix/launch-readiness-20261029`, based on verified
`pilot/staff-origin-20261017` commit `9f74e7c725fc9a0d85482afb91c73e6627979521`.
The separate dirty `outputs/northside-app` checkout was not edited or merged.
This extends the saved `.runtime/launch-audit-20261029/audit.md`; it is not a
new broad audit or proof of a production launch.

## Implemented and locally verified

- Updated Next.js and matching ESLint configuration to **16.4.1**, Zod to
  **4.6.6**, and vulnerable transitive Vite to **8.3.3**. Targeted compatible
  overrides also cover nested Zod. The regenerated pnpm lockfile installs with
  `--frozen-lockfile`; vulnerability reporting remains enabled.
- Added a separate owner/admin development-store checkout page, linked from
  `/staff/integrations/commerce-pilot`, at
  `/staff/integrations/checkout-test`. Its private POST endpoint preserves
  session, tenant, role, Origin and buyer-IP checks. It rejects Northside's live
  shop, production Vercel environments, fixtures and missing/expired grants.
  Every Storefront operation requires a fresh Admin `partnerDevelopment`
  attestation. It uses supported Cart APIs, guest carts, separate credentials,
  an exact development-shop checkout hostname and a final plan attestation.
  It never submits a payment/order, transfers a customer identity or changes
  the existing live purchase policy.
- Bound accepted deliveries to their raw-payload SHA-256, Shopify order GID,
  delivery UUID, shop, topic and API version. Raw HMAC verification precedes
  parsing. Conflicting replays fail; SQL makes delivery identity immutable.
  Existing transaction/lease/order locking and financial fingerprints preserve
  deduplication, cancellation and refund projection. Canonical reads must have
  `test=false`; expired leases fail after the provider read too.
- Added a bounded, private SQL importer from the existing metadata quarantine
  to the canonical order queue. Import and reconciliation commands default to
  disabled. Explicit `reconcile-only` mode cannot enqueue loyalty or break
  processing. No raw webhook/customer payload is added to the public receiver.
- Added owner/admin-only read diagnostics at
  `GET /api/private/commerce/inventory-proof?variantId=gid://shopify/ProductVariant/...`.
  The check cross-matches Storefront and Admin product/variant IDs, SKU/barcode
  and publication status, reads Storefront price/availability, and verifies
  three distinct, active Admin inventory locations. It does not compare Admin price.
  It preserves separate Retail/Breaker/Excess pools and does not infer pickup
  eligibility from aggregate online stock.
- Added regressions for disabled production purchases even with test-mode
  configuration, development-store attestation and authorization, unavailable
  stock, unsafe checkout destinations, raw signature integrity, conflicting
  replay/rollback, test-order exclusion, cancellation/refunds, role isolation
  and exact location mappings. No existing tests were removed.

## Verification and limits

Checks ran from an isolated copy of this source with no private environment
files and a frozen install, using Node 24 and pnpm 11.25.0. Local SQL tests use
PGlite; they are not proof of hosted permissions, network retries or concurrent
transactions across separate hosted connections.

| Check | Result |
| --- | --- |
| Full dependency audit and production dependency audit | Zero info/low/moderate/high/critical findings |
| `pnpm lint` | Pass; one pre-existing unused-variable warning in `packages/agent-runtime/src/control.ts` |
| `pnpm typecheck` | Pass, including customer TypeScript |
| `pnpm test` | 412 passing tests: 6 runner, 127 core, 17 customer script, 262 customer application |
| `pnpm build` | Customer, Control and Webhooks production builds pass |
| Customer `smoke:production` | All 12 loopback production rejection suites pass, including new private commerce endpoint rejection checks |
| Customer client configuration/secret-name scan | Pass |

Raw results are in `.runtime/launch-implementation-20261029/`, including
`implementation-results.json`, `final-results.json`, the implementation/final logs,
`dependency-audit{,-prod}.json`, `production-smoke.log` and `client-secrets.log`.
The signed-out checkout access page was inspected in Chrome at 390, 820 and
1280 pixels: no horizontal overflow, no page errors, no checkout form exposed,
and keyboard activation reached staff sign-in. `browser-results.json` and
`checkout-access-{390,820,1280}.png` record this limited access-screen check;
they do not prove an authenticated checkout browser journey.
Successful test checkout uses mocked provider responses; no actual Shopify
test checkout/order, provider-delivered order reconciliation or physical scan
has been completed by this change. The test checkout is deliberately separate
from live order reconciliation: development-store orders must not enter the
Northside financial ledger.

## Fresh read-only provider result and external blockers

At **2026-10-29 13:58 UTC**, the existing private operator Storefront token
returned a successful `2026-07` query with **zero products**, no next page,
and only the `frontpage` / Home page collection. This is the current response
for that Headless access, not a claim that Shopify Admin has no products or
that Online Store publication matches Headless. It supersedes the October 17
single-product observation for this check only. No catalog data was changed.

The inspected private configuration has no separate development-shop settings
or the three location GIDs. It does not declare the confirmed Admin auth mode
required by the existing same-organization read-only flow. No grant exchange,
scope change, app installation or inventory write was attempted. The expected
separate `customer.env` file was absent; the existing operator Storefront token
was sufficient for the catalog query. Provider-dependent work stopped at these
boundaries. Sanitized evidence: `shopify-readonly.json` in the evidence folder.

**P0 before any live launch:** actual paid-order reconciliation, pickup/POS
handoff and production-charge approval remain unverified and disabled. The
coding worker remains disabled. Passing local tests is not activation approval.
No new P0 code safety defect was identified by the independent diff review.

**P1 before physical commerce testing:**

1. Operator must privately provision a separate Shopify development store and
   its test payment setup, Storefront token and unexpired Admin grant. Then
   prove invited owner/admin sign-in and the actual test checkout handoff.
2. Confirm which Headless catalog/token is intended and make eligible test
   merchandise available through an authorized catalog operation. Current
   access returns no variants, so real variant/barcode/availability proof
   cannot proceed. Catalog changes remain outside this implementation.
3. Confirm existing live Admin authentication and grants for `read_orders`,
   `read_products`, `read_inventory` and `read_locations`; provide the exact
   three inventory location GIDs. Run read diagnostics and verify QR/barcode
   registry mappings and customer access with actual authorized sessions.
4. Review/apply the new migration in a controlled environment with the existing
   quarantine installed, prove restricted roles and separate-connection
   duplicate/lease behavior, then correlate a natural provider delivery and
   canonical order read. No hosted migration or processor was run here.

**Assessment:** ready for operator configuration and controlled local/staging
acceptance. **Not ready for end-to-end physical checkout, pickup or POS testing**
until those P1 items pass. Camera/printed-label/device and weak-network tests
remain physical acceptance work, not claims established by these unit tests.

## Operator configuration and migration order

All new settings are documented with disabled/blank defaults in
`apps/customer/.env.example`. Do not put secrets in this document or client
variables. Use only a separately approved non-production environment.

- `NORTHSIDE_CHECKOUT_TEST_MODE=development-store` opts into the isolated path;
  default `disabled`. Supply `SHOPIFY_TEST_SHOP`,
  `SHOPIFY_TEST_STOREFRONT_PRIVATE_TOKEN`, `SHOPIFY_TEST_ADMIN_ACCESS_TOKEN` and
  ISO expiry `SHOPIFY_TEST_ADMIN_TOKEN_EXPIRES_AT`. The shop must be a distinct
  `*.myshopify.com` development store; `partnerDevelopment=true` is mandatory.
  Grant only the test store's required product/inventory reads and supported
  Cart capabilities. A test-payment setting on Northside's live shop is not
  accepted as a substitute. Credentials never fall back to Northside's tokens.
- Diagnostics require three distinct Shopify Location GIDs in
  `SHOPIFY_RETAIL_LOCATION_ID`, `SHOPIFY_BREAKER_LOCATION_ID` and
  `SHOPIFY_EXCESS_LOCATION_ID`, matching the existing approved pool labels.
  Read scope requirements are checked explicitly; do not bypass them.
- Apply the existing customer migration chain and root pilot-inbox migration
  before customer migration
  `20261029133844_commerce_delivery_integrity.sql` on installations using the
  quarantine. The migration adds nullable integrity fields for historical jobs
  without inventing old hashes. Existing rows lacking this evidence cannot be
  accepted as matching replays; they need operator review. The conditional
  quarantine grant must be applied explicitly later if the inbox did not exist
  when this migration ran. Never broaden the public receiver role.
- `NORTHSIDE_ORDER_PROCESSOR_MODE=disabled` remains the default. Only after
  secure acceptance, an approved operator may use `reconcile-only` with the
  restricted commerce DB role and existing authorized Admin read access, then
  run bounded `pnpm --filter @northside/customer orders:import` and
  `pnpm --filter @northside/customer orders:work`. These commands were **not**
  executed against hosted data. There is no new public processor endpoint or
  automatic scheduling. This setting does not activate the coding worker,
  purchases, pickup, POS, rewards, fulfillment or inventory changes.

Design references: Shopify's [CartInput](https://shopify.dev/docs/api/storefront/2026-07/input-objects/CartInput)
has no per-cart test flag; [development stores](https://shopify.dev/docs/apps/build/stores/development-stores)
provide the separate test environment; [ShopPlan](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopPlan)
provides the development attestation. Signature handling follows
[webhook verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).
Inventory reads use [InventoryLevel](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryLevel).

## Changed-file map

- Dependencies: root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`;
  `apps/{customer,control,webhooks}/package.json`.
- Checkout: customer `lib/server/checkout-test.ts`,
  `app/api/private/commerce/checkout-test/route.ts`,
  `app/staff/integrations/checkout-test/page.tsx`,
  `components/checkout-test.tsx`, `app/staff/integrations/commerce-pilot/page.tsx`,
  and `lib/server/storefront.ts`.
- Reconciliation: customer `lib/server/{admin-shopify,order-jobs,receipt-import}.ts`,
  `scripts/import-order-receipts.ts`, and the new customer SQL migration above.
- Read diagnostics: customer `lib/server/inventory-proof.ts` and
  `app/api/private/commerce/inventory-proof/route.ts`.
- Tests: customer `tests/{checkout-test,inventory-proof,receipt-import}.test.ts`,
  existing `tests/{commerce,order-isolation,webhook-acceptance}.test.ts`,
  and `scripts/commerce-smoke.mjs`.
- Configuration/docs: customer `.env.example`, both `docs/STATUS.md` files,
  and this report. The public receiver and `lib/policy.mjs` are unchanged.
