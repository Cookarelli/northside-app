# October 29 commerce continuation

Branch `fix/launch-readiness-20261029`; HEAD remains
`9f74e7c725fc9a0d85482afb91c73e6627979521`. Existing uncommitted work was
preserved. No commit, merge, deployment, hosted migration, production-data
mutation or worker activation was performed. The separate
`outputs/northside-app` checkout was not edited.

## Changes in this continuation

- Commit encrypted cart ownership before sending any customer buyer token to
  Shopify. Anonymous cart creation and ownership binding now commit before
  the provider operation; the next transaction rechecks ownership under lock.
  A provider mutation whose response is lost can no longer roll ownership back
  and leave a customer-bearing Shopify cart accessible through a guest handle.
- Establish the order-ownership mapping from the authenticated Customer Account
  API before customer cart mutations. Visiting the Account page first is no
  longer required. Neither request-body IDs nor email establish ownership.
- Reject missing cart merchandise, invalid quantities and buyer-update changes
  to lines, totals or discounts. Recheck availability and cart contents before
  returning an allowlisted HTTPS Shopify checkout URL. This is an in-request
  consistency check, not a persisted client review/version handshake.
- Reject unsupported canonical Shopify financial states.
- Add joined SQL/provider-fixture acceptance covering encrypted saved carts,
  committed ownership before lost responses, retry, cross-customer/guest denial,
  add/update/remove, unavailable variants, expired carts, repricing, raw signed
  deliveries, duplicate delivery, canonical-read retries, failed payment,
  paid-order projection, cancellation, refund and private order reads.

The existing raw-HMAC/delivery-integrity, transactional durable job, lease,
canonical Admin read, immutable ledger and metadata importer implementation
was retained and exercised. The metadata-only public receiver is unchanged.
Live purchase gates, test-order exclusion and disabled processor/worker defaults
remain unchanged. No client Admin credentials were introduced.

## Files modified in this continuation

- `apps/customer/lib/server/cart-session.ts`
- `apps/customer/lib/server/customer-commerce.ts`
- `apps/customer/lib/server/storefront.ts`
- `apps/customer/lib/server/admin-shopify.ts`
- `apps/customer/tests/commerce.test.ts`
- `apps/customer/tests/purchasing-flow.test.ts` (new)
- `apps/customer/docs/STATUS.md`
- `docs/STATUS.md`
- `docs/commerce-continuation-20261029.md` (this report)

Other previously modified files, including the patched manifests/lockfile,
checkout-test path, webhook jobs/importer and migration, were preserved.

## Verification performed

Checks used a synchronized isolated source copy with no private environment
files and frozen offline dependencies at
`.runtime/launch-implementation-20261029/source`. Evidence is under
`.runtime/commerce-continuation-20261029/`.

| Check | Current result |
| --- | --- |
| Frozen lockfile install | Pass |
| Full and production dependency audits | Zero vulnerabilities at every severity |
| Lint | Pass; one existing unused-variable warning in agent-runtime/control.ts |
| Typecheck | Pass, root and customer |
| Full tests | 416 pass: 6 runner, 127 core, 17 customer script, 266 customer application |
| Final focused purchasing-flow rerun | 4 pass |
| Customer, Control and Webhooks production builds using `next build --webpack` | All pass |
| Default `pnpm build` / Turbopack | Blocked by internal PostCSS port-binding EPERM, including the permitted retry; not counted as passing |
| Client bundle scan | 118 artifacts pass for server configuration names; no actual provider secret values supplied in this isolated run |
| Current production rejection smoke suites | Not run: automatic approval review could not complete the loopback server start because its selected model was at capacity |
| Hosted payment/reconciliation, SSO and real devices | Not verified |

Earlier twelve-suite smoke success belongs to the preceding implementation,
not this continuation. No tests were removed, vulnerability reports suppressed,
or failed attempts erased. Independent review found the cart orchestration
regression addressed and identified the test-realm gap below. UI was unchanged;
no new mobile/desktop browser acceptance is claimed while the loopback start
and hosted SSO remain blocked. PGlite tests do not prove hosted multi-connection
concurrency or provider-delivery success. Synthetic `test:false` snapshots test
the live-domain reconciliation contract; they are not Shopify receipts.

## Remaining blockers and exact operator requirements

**P1 implementation gap:** the existing development-store checkout is an
owner/admin-authorized, transient guest cart. It does not yet connect an
isolated test customer's encrypted saved cart and test-order ledger. The live
processor deliberately pins Northside's shop and excludes `test:true` orders.
A separate test identity/cart/order realm and processor must be implemented
and reviewed before claiming authenticated development-store end-to-end
checkout. Supplying credentials alone does not close this gap. Never reuse a
Northside customer token in another shop or weaken the live order exclusion.

**P1 Shopify configuration:** a separately approved development store with
verified `partnerDevelopment=true`, a published test variant and test payment
setup; `NORTHSIDE_CHECKOUT_TEST_MODE=development-store`, `SHOPIFY_TEST_SHOP`,
`SHOPIFY_TEST_STOREFRONT_PRIVATE_TOKEN`, `SHOPIFY_TEST_ADMIN_ACCESS_TOKEN` and
an unexpired `SHOPIFY_TEST_ADMIN_TOKEN_EXPIRES_AT`. The endpoint additionally
requires a verified Northside owner/admin session and trusted buyer IP, and
rejects Vercel production and local-fixture mode. Provision credentials
privately; do not change live shop payment/catalog settings to satisfy this.
These settings were missing in the preceding operator inspection; they were
not reread or changed here.

For customer ownership acceptance, the test realm needs its own Customer
Account client, issuer, HTTPS callbacks and verified customer session.
The current live-domain code requires the existing `SHOPIFY_CUSTOMER_CLIENT_ID`,
`SHOPIFY_CUSTOMER_CLIENT_SECRET`, `SHOPIFY_EXPECTED_ISSUER`, exact auth hosts
and `APP_ORIGIN`, plus the existing restricted runtime/auth/commerce database
roles and `SESSION_ENCRYPTION_KEY`. Confirm the intended Headless publication:
the previous read-only access returned zero products, which this run did not
recheck or change.

For hosted reconciliation, review/apply the existing customer migration chain
and `20261029133844_commerce_delivery_integrity.sql` in an approved isolated
installation, verify least-privilege roles, supply the authorized Admin grant
and `read_orders`, and prove concurrent replay/lease behavior. Live processing
remains disabled. Existing inventory diagnostics also require confirmed read
scopes and the exact distinct Retail/Breaker/Excess location GIDs. Do not infer
pool membership or pickup configuration from aggregate online availability.

**P1 verification access:** approved tester access through ordinary Vercel SSO;
no bypass token or deployment was created. Retry the loopback production
rejection suite when automatic approval review is available. Its failure was
review infrastructure capacity, not a finding that the requested start was
unsafe. The app server did not start.

**P0 before any live activation:** live payment approval and real paid-order,
refund, pickup/POS and device acceptance are still absent. Keep all live gates
and disabled workers off. Local test success is not launch approval.

## Controlled-testing assessment

Local joined fixture acceptance is possible and passes. The existing staff
**guest** development-store checkout can be attempted after its external
configuration is supplied, but was not attempted here. Authenticated Shopify
customer checkout through to a reconciled owned test order is **not ready**:
it still needs the isolated test-realm implementation and provider/hosted
acceptance above. No successful real payment or receipt is claimed.
