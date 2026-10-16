# Shopify pilot: current connection and activation boundary

October 3, 2026. This pilot continues the existing customer app. It does not enable production fixtures, replace invited staff authentication, create a Shopify cart/order, install an app, publish products, change inventory, or activate a sale.

## What is available

- Production and any non-fixture `/in-store` URL render an honest preparation screen. Sample QR URLs such as `/in-store/q/N001` cannot display sample merchandise or payment controls in production. The existing local rehearsal remains available only with explicit `COMMERCE_MODE=fixture` outside production.
- `/shop`, product detail and `/cart` remain the canonical customer commerce path. Published merchandise comes only from the existing Storefront service. Empty publication, unavailable credentials and unknown inventory never fall back to sample merchandise.
- `/staff/integrations/commerce-pilot` requires the existing refreshed Supabase-backed application session and an active owner/admin role, checked before provider calls. Vercel deployment protection is an additional preview boundary, not staff authorization. A local rehearsal password never grants access.
- The inspector performs only reads through the existing Shopify adapters: installed app identity, granted Admin scopes, shop plan, published catalog, exact product/variant IDs, SKU/barcode, fresh USD price and online availability, and API-listed webhook subscriptions. No raw provider errors, token values or callback URLs are rendered. Provider callback URLs can contain secrets, so only exact endpoint/version match booleans are exposed.
- The existing `/staff/store` registry owns product/variant/barcode mappings, three separate location pools and stable live QR tokens. Its verified Storefront resolution and server-side mapping checks are reused. The short rehearsal labels N001/N002/C001/STORE are not migrated into live product mappings.

The inspector's product lookup is bounded to one exact product and 100 variants. Products with further variants require separate staff review. Catalog browsing shows the first 12 products and explicitly identifies additional pages. Subscription inspection is bounded to 100 entries for the four required topics, reports incomplete pagination, and does not claim app-configured subscriptions or actual delivery are verified by a listing.

## Fresh external evidence

Credential-free reads of both Northside discovery documents returned HTTP 200 on October 3:

- `https://9i3hnb-jw.myshopify.com/.well-known/openid-configuration`: issuer `https://shopify.com/authentication/103967392113`, RS256 signatures, S256 PKCE.
- `https://9i3hnb-jw.myshopify.com/.well-known/customer-account-api`: the current advertised GraphQL endpoint is `https://shopify.com/103967392113/account/customer/api/2026-10/graphql`.

This confirms the expected public shop discovery. It does **not** verify a configured app, grant, catalog, customer login or checkout. The application deliberately retains its tested `2026-07` contract. Its existing Customer Account adapter substitutes that pinned version after validating discovery; the transport rejects unexpected provider version headers. An API upgrade needs its own reviewed contract change.

No Shopify credentials were available to this builder. The installed app, granted scopes, token lifecycle, product/variant/SKU/barcode mappings, published current prices and inventory, location/pickup setup, POS plan and webhooks therefore remain externally unverified. The inspector is executable preparation, not evidence that its provider calls have passed.

## Exact private setup

Use the existing canonical environment names, privately configured by the operator:

| Purpose                      | Existing configuration                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact shop / API             | `SHOPIFY_SHOP=9i3hnb-jw.myshopify.com`; `SHOPIFY_API_VERSION=2026-07`                                                                                                                                                                                                  |
| Published catalog            | `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` from the actual authorized Headless channel; verify `unauthenticated_read_product_listings` and `unauthenticated_read_product_inventory`                                                                                            |
| Supported Admin grant        | `SHOPIFY_ADMIN_AUTH_MODE=installed_oauth` with `SHOPIFY_ADMIN_ACCESS_TOKEN` and actual `SHOPIFY_ADMIN_TOKEN_EXPIRES_AT`, supplied by an authorized installation/token broker; or the existing same-organization exchange only after its actual eligibility is verified |
| Same-organization exchange   | `SHOPIFY_SAME_ORG_CONFIRMED=true`, `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET`; a flag alone is not proof of organization ownership                                                                                                                           |
| App/webhook/QR origin        | Registered HTTPS `APP_ORIGIN`; exact long-term `NORTHSIDE_QR_ORIGIN`; no invented production domain                                                                                                                                                                    |
| Staff sessions               | Existing invited Supabase user/membership, separate `DATABASE_URL` and `AUTH_DATABASE_URL`, `SESSION_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`                                                                                                       |
| Canonical cart/order records | Separate least-privilege `COMMERCE_DATABASE_URL`; never a migration/service-role credential                                                                                                                                                                            |
| Customer checkout            | Existing Customer Account client/issuer configuration, real OAuth test and verified ingress for `SHOPIFY_TRUSTED_BUYER_IP_HEADER`; exact reviewed checkout hosts                                                                                                       |

The separate prototype package accepts `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_WEBHOOK_SECRET`; those names do not configure this canonical pilot. Use `SHOPIFY_SHOP` and the installed app's `SHOPIFY_APP_CLIENT_SECRET` for the existing canonical integration. Do not wire a second order worker to the rehearsal webhook boundary.

After actual access is available, an invited owner/admin can open the inspector, confirm the exact app/install IDs and its granted scopes, then choose a published product or enter its exact GID. Record verified product/variant/SKU/barcode relationships in the existing store workspace and resolve the same stable label against Storefront. Do not activate Draft products, republish channels, change inventory/location settings or install an app to make a preview appear populated without the separately authorized store operation.

### Exact scopes and customer callbacks

The existing Admin reconciliation path requires `read_orders`. Its ordinary history window is 60 days; `read_all_orders` needs separate approval only if older history is required. Confirm protected customer-data access and any `read_customers` needed for the order's customer identity. This pilot requests no product, inventory, fulfillment, discount or order-write Admin permissions. There is no generic `write_webhooks` scope: order/refund subscriptions depend on the relevant resource access. Separately, Storefront cart operations need `unauthenticated_read_checkouts` / `unauthenticated_write_checkouts`; these are not Admin order-write permissions. Verify grants on the actual installed app/channel. [Shopify scope reference](https://shopify.dev/docs/api/usage/access-scopes).

Use the configured Headless storefront's **confidential Customer Account client**, with `SHOPIFY_CUSTOMER_CLIENT_ID` and `SHOPIFY_CUSTOMER_CLIENT_SECRET`. The application requests OAuth scopes `openid email customer-account-api:full`; configure the channel's `customer_read_customers` and `customer_read_orders` permissions for its existing profile/history reads. Set `SHOPIFY_EXPECTED_ISSUER=https://shopify.com/authentication/103967392113`. Register exactly the chosen HTTPS `APP_ORIGIN` plus `/api/auth/shopify/callback`, and the same origin plus `/account` as the post-logout return. No placeholder origin or HTTP localhost registration is usable. These values are separate from the Admin app client and the Supabase staff callback. [Customer Account setup](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started).

### Where staff handle orders

Real staff order operations remain in **Shopify Admin → Orders** for `9i3hnb-jw.myshopify.com`. Northside's `/staff/integrations` shows reconciliation health; `/staff/store` manages mappings; `/staff/integrations/commerce-pilot` inspects readiness. There is no live `/staff/orders` route or fulfillment queue implemented in this pilot. `/account/orders` is the authenticated customer's own history. `/in-store/staff` is solely the explicitly enabled local fixture queue; production renders the preparation screen.

A Storefront cart's hosted checkout is an online checkout, and completing it can create a Shopify order. It does not populate a Shopify POS device cart. POS import requires the separately installed extension, verified device/session/staff/location, supported POS Cart APIs and one-time correlation; the prototype has no installed-device proof. Staff must reconcile actual paid order evidence before collection. Neither opening Admin Orders nor importing lines proves payment.

## Checkout handoff and remaining proof

The existing `/api/commerce/cart` checkout action already reuses the canonical encrypted cart/session service, verified customer context or guest flow, same-origin checks, fresh aggregate quantity checks, refreshed buyer identity, unchanged prices/lines, Shopify `checkoutUrl` and exact allowed HTTPS hosts. Full cart IDs and provider tokens stay on the server. Tests exercise guest/customer handoff and stock/price/expiry changes.

The in-store pilot links to that existing shop/cart path. It does not convert a fixture basket into a real cart, treat an online cart as a POS cart, or enable a shipping-capable checkout for an in-store pickup promise. Purchase and pickup flags remain source-controlled `false`; there is no new environment shortcut or “verified” checkbox.

Before a reviewed activation change, retain actual evidence for:

1. Exact installed app/channel/grants and token renewal; the selected published product/variant set with current USD amounts and finite stock.
2. Approved retail location, distinct breaker/excess pools, actual pickup/fulfillment behavior, tax and discount behavior, guest/customer identity, and the store's applicable plan.
3. Separately authorized non-charging development/test checkout and checkout URL behavior. Do not create a paid order or alter payment mode as part of this read-only pilot.
4. Canonical HTTPS `/api/shopify/webhooks` subscriptions for `orders/paid`, `orders/cancelled`, `orders/updated`, `refunds/create`, matching the app's pinned webhook API version. Prove raw HMAC acceptance, durable receipts, duplicate/out-of-order/refund convergence, and a configured running order worker. An API subscription listing alone is insufficient.
5. A separately authorized POS extension/device proof of scanning, exact one-time import/correlation and actual paid-order reconciliation. The prototype is not installed. Browser return, staff click, scan or POS cart contents cannot prove payment.
6. Verified public QR origin, print size/lighting and physical iPhone/iPad/Android scans, plus staff/customer isolation and shared-device logout.

Shopify's documented delivery preferences prefill checkout and can be overwritten; they do not prove enforced retail pickup. A generic checkout URL must remain blocked for the promised in-store flow until the actual configured behavior is verified.

## Verification performed

- Customer TypeScript checking and scoped ESLint: passed.
- 32 focused customer commerce/store/pilot tests: passed, including exact shop rejection, owner/admin-only access before reads, no fixture/provider mixing, callback/error secret redaction, endpoint/version lookalikes, missing inventory, unpublished products, current mappings, QR encode/decode and canonical checkout contract tests.
- The previous 24 in-store domain/API/POS prototype tests remain separate fixture/mock evidence.
- Production build, integrated protected preview and physical devices are coordinator verification; no claim of those checks is made by this builder.

Official Shopify references reviewed October 3: [installed app and access scopes](https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation), [webhook subscription fields](https://shopify.dev/docs/api/admin-graphql/latest/objects/WebhookSubscription), [subscription listing](https://shopify.dev/docs/api/admin-graphql/latest/queries/webhookSubscriptions), [shop plan](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopPlan), [Storefront permissions](https://shopify.dev/docs/api/usage/access-scopes), and [delivery preferences](https://shopify.dev/docs/api/storefront/latest/objects/CartDeliveryPreference). Current documentation is not proof of Northside's installed capabilities. The pinned adapter and all new read queries remain subject to actual authorized provider verification.
