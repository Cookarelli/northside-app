# In-store commerce rehearsal

The existing customer application and its grading, customer-account, loyalty, inventory-pool and provider boundaries remain intact. The new flow is additive at `/in-store` and `/api/in-store/*`. It uses the unchanged approved Northside SVG and scoped blue styling. The original Shopify Customer Account identity is not replaced by this guest session.

## Capability status

| Capability                                                            | Status                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stable product, variant-selection, collection and store QR routing    | Working locally, fixture-only                                                     |
| Guest baskets; quantities, removal, stock and stale-version rejection | Working locally, fixture-only                                                     |
| Expiring, frozen, one-time counter handoff with staff authentication  | Working locally, fixture-only                                                     |
| Simulated staff payment, preparation and single collection            | Working locally, fixture-only; no real payment                                    |
| Shared iPad timeout/reset and server-side expiry                      | Working locally; actual iPad hardware unverified                                  |
| Product/collection/store QR PNG generation and image decode           | Working locally; physical print/device scanning unverified                        |
| Storefront Cart API and authenticated order-reader boundaries         | Mock contract tested; live checkout blocked                                       |
| POS scanner/cart bridge                                               | Executable mocked prototype; app packaging, installation and device proof blocked |
| Membership ledger deduplication and exact refund reversal             | Foundation tested; no rates, thresholds or live rewards active                    |
| Existing customer accounts, grading and broader loyalty               | Preserved in existing application; see its original release evidence              |

## Run locally

From the repository root after the root setup instructions:

```sh
pnpm setup:local
pnpm dev
```

Use the customer URL printed by the startup command, then open `/in-store`. Local configuration must explicitly contain `COMMERCE_MODE=fixture`; production rejects fixtures even if that value is present. The in-store password staff interface is local-only and cannot act as a replacement for the existing invited-staff identity in production. Staff and operator credentials are distinct, generated locally and never pasted into chat.

1. Open `/in-store/q/N001`; confirm “pack,” choose quantity and add it.
2. Open `/in-store/q/N002`; explicitly select box or the unavailable case. Scanning never silently adds an item.
3. In Basket, change quantity or remove a line. Unavailable quantity and changed basket versions are rejected on the server.
4. Choose **Pay at counter**. Show the resulting unpaid handoff reference or 10-character fallback code. The basket freezes for ten minutes; it is not an inventory reservation. An unclaimed handoff can be cancelled and regenerated. A claimed one requires staff reconciliation.
5. On a separate staff browser/device, open `/in-store/staff`, sign in using the local staff password and look up/claim the handoff. A repeated claim is rejected.
6. **Simulate fixture payment** records a clearly labeled sample payment. No Shopify order, card charge, draft order or inventory mutation occurs.
7. Mark ready; customer Order Status polls the server every five seconds. Enter the customer's paid collection code to verify and collect once. Repeating collection is rejected atomically.
8. The shared iPad control creates a new guest basket and clears its local staff cookie. It refuses shared entry while the existing authenticated customer cookie is present; sign out through the existing account first. Its private guest session expires after three minutes of inactivity on the server. The browser clears displayed session data before attempting the reset request, including when the network is interrupted. After collection it resets in twenty seconds. There is no customer login or storage of customer PII in this rehearsal.

The same-origin API rejects cross-site writes. Customer access uses a high-entropy HttpOnly SameSite cookie; only its hash is persisted. HTTPS adds Secure. Session IDs and QR references cannot substitute for that cookie. Staff read/claim/prepare/collect routes require the separate staff cookie. Paid and unresolved claimed/checkout records survive customer reset for reconciliation. Expired unused sessions are pruned on creation; a 120/minute global creation limit and 1,000 retained-session capacity protect the aggregate. Capacity blocks **new** sessions and preserves existing basket/collection operations; archive resolved records via an operator maintenance migration before scaling this rehearsal.

QR registry edits are local fixture staff operations: POST `/api/in-store/admin/mapping` with `{ "code":"N001", "mapping":{"kind":"product","productId":"archive"} }`, a same-origin header and authenticated staff cookie. Product and variant identities are validated. Existing printed codes remain unchanged. Production administration must use the existing invited-staff system.

## QR output

```sh
NORTHSIDE_PUBLIC_URL=http://localhost:3100 pnpm qr
```

The generator writes `outputs/qr-samples/{N001,N002,C001,STORE}.png` and `manifest.json`. It encodes stable `/in-store/q/…` destinations, square modules, contrast and a four-module quiet zone. It decodes every PNG with an independent decoder before reporting success. Use the eventual verified Northside-controlled HTTPS domain before printing real labels. A localhost sample is not a phone-accessible public domain. Start with at least 35 mm square; physical print stock, distance, lighting and real phones/iPads remain unverified. Rounded modules and a central N are deliberately deferred until standard labels pass device testing.

## Shopify integration requirements and safe limits

The known admin URL did not itself prove a storefront. The integrated repository separately documents `9i3hnb-jw.myshopify.com`, a published-channel requirement and the three pools; it also records a Square Online public site. Reconfirm the actual current storefront/app domain, Headless channel, API credentials, POS plan/location and fulfillment behavior before changing any gate. Existing Draft products and inventory settings remain untouched.

The new server adapter uses supported Storefront `cartCreate` and `checkoutUrl` with API version default `2026-07`, explicit variant IDs and server-only credentials. It rejects returned warnings/user errors. This is a tested API boundary, not a proven live transaction. The customer Pay Now endpoint intentionally remains blocked: the prototype does not prove that Shopify will enforce pickup at the retail location, or validate taxes, discounts and plan capability. An environment switch cannot silently enable shipping for an in-store purchase.

When integrating with the established commerce service, reuse its durable webhook receipts/jobs, current authenticated Shopify order reconciliation and server-only full-cart storage. This rehearsal supplies raw-body HMAC validation and a current Admin order read, a matching server-issued correlation reference, paid financial-state verification and exact frozen variant quantities. Browser returns, customer QR codes, arbitrary order IDs and POS cart contents never prove payment. Its webhook boundary is not a second production worker. Reconciliation entry points are prototype-only and require the existing durable/least-privilege installation before use.

The original app already supplies customer identity; integrate that approved adapter rather than issuing a second account. Environment names required by the new boundary (no values here):

```dotenv
COMMERCE_MODE=
NORTHSIDE_PUBLIC_URL=
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_API_VERSION=
SHOPIFY_STOREFRONT_PRIVATE_TOKEN=
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=
```

POS bridge details are in `apps/shopify-extension/README.md`. Storefront carts do **not** automatically populate POS. The prototype uses scanner events, a backend-validated one-time claim, numeric variant additions and cart correlation properties; staff adjustments are permitted in POS, but a paid order differing from the frozen basket currently routes to reconciliation rather than collection. No live extension is installed. No custom sale or draft order imitates an actual purchase.

An issued Shopify checkout URL may remain usable after a Northside session or handoff changes. There is no proven supported revocation here. Therefore the domain never automatically switches to a counter path after a web checkout attempt and marks uncertain Cart API calls for reconciliation. A duplicate paid order is held for review and cannot authorize a second collection. This does **not** promise exactly-once Shopify sales; live checkout/POS concurrency, abandoned checkout recovery and refunds require a development-store proof and documented mitigation.

## Verification

Builder checks executed October 3, 2026:

- `node node_modules/typescript/bin/tsc --noEmit` — passed for the added scaffold before integration.
- `node node_modules/vitest/vitest.mjs run tests/commerce.test.ts tests/commerce-api.test.ts tests/commerce-pos.test.ts` — 22 tests passed: QR identities, stale-version/price and inventory rejection, cross-customer access, expired/replayed/concurrent handoffs, unpaid-vs-paid transitions, atomic collection, shared reset, ledger dedup/reversal, Shopify HMAC, POS token checks, Cart API warnings, paid-event dedup/reconciliation, HTTP staff authorization/CSRF and production fixture denial, and mocked POS partial-import/replay.
- `node --import tsx scripts/generate-qr.ts` — generated four 800px PNGs; independent jsQR decode matched all four stable destination URLs. No printed-device claim.

The coordinator's integrated browser/build verification is recorded separately. Hosted Supabase/RLS, real Shopify checkout/POS/order/inventory behavior, actual phone scanning and iPad installation remain blocked or unverified. No deployment, store app installation, inventory modification or payment was performed.
