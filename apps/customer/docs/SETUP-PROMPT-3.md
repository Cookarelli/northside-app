# Prompt 3 — Shopify setup and external verification

Stage-specific implementation record. For the current combined handoff, see [RELEASE-REPORT.md](RELEASE-REPORT.md).

Local implementation is ready for review. Shopify credentials, a supported Admin installation, hosted migrations, real login, webhook delivery and checkout are **not verified**. Account password resets can wait; `./scripts/preview.sh` needs none of these inputs. No products, inventory, locations, fulfillment settings, webhooks or cloud services were changed during implementation.

## API and authentication configuration

Reviewed official documentation September 12, 2026. The pinned API contract is **2026-07** for Storefront, Customer Account and GraphQL Admin. `SHOPIFY_API_VERSION` is configurable but currently accepts only that tested version; a version upgrade requires reviewing documents and updating the contract tests/allowlist. A returned different API-version header fails closed. There is no obsolete Checkout API integration.

Northside's public discovery was read successfully: `https://9i3hnb-jw.myshopify.com/.well-known/customer-account-api` returns `https://shopify.com/103967392113/account/customer/api/2026-07/graphql`. The implementation validates HTTPS, the Shopify host, shop ID and endpoint path; the configured stable version replaces only the endpoint's version segment. This public check is not authenticated customer verification.

1. Complete the hosted identity prerequisites in [SETUP-PROMPT-2.md](SETUP-PROMPT-2.md). Real integration testing requires `NORTHSIDE_FIXTURES=0`, privately configured credentials and an exact registered HTTPS origin. Production always refuses fixtures, even if the fixture variable is set.
2. In Shopify, select the authorized Headless storefront/sales channel and configure its **private Storefront token** as `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`. Give that storefront the documented product/collection read, inventory availability and cart/checkout permissions needed by its operations (`unauthenticated_read_product_listings`, `unauthenticated_read_product_inventory`, `unauthenticated_read_checkouts`, `unauthenticated_write_checkouts` as applicable to its current configuration). Inspect the actual granted permissions; don't infer access from an environment variable.
3. Customer Account permissions must include the current customer profile/order reads (`customer_read_customers`, `customer_read_orders`) alongside the existing OAuth scopes `openid email customer-account-api:full`. Confirm protected customer data approval/access and use the confidential client from Prompt 2. Profile and order queries operate on `customer` under the verified access token; they accept no email/customer selector. Staff accounts do not become customer accounts.
4. Set `SHOPIFY_TRUSTED_BUYER_IP_HEADER` only to a header that the selected ingress **overwrites** with the buyer's actual IP. Verify this on the real HTTPS deployment, including attempted header spoofing. The code does not trust arbitrary `X-Forwarded-For`. Customer-authenticated checkout needs the buyer IP on server-side Storefront calls. Local checkout remains disabled.
5. Shopify's returned checkout URL is used directly after availability and buyer-identity checks. Its HTTPS host must be the configured myshopify.com host, shopify.com, or an exact independently reviewed host in `SHOPIFY_CHECKOUT_HOSTS`. Add a custom checkout domain only after inspecting Northside's real response. Guest checkout passes no customer token. Never place access tokens, raw cart IDs, personal details or an order-ownership claim in a public URL.

## Admin app installation — choose the actual supported path

Use the current Shopify Dev Dashboard app installation process; do not create instructions around an assumed legacy permanent custom-app token. Northside's organization ownership has **not** been established.

- **Same Shopify organization:** Only if both the app and target shop demonstrably belong to the same organization in the Dev Dashboard, release/install the app version with required permissions and select `SHOPIFY_ADMIN_AUTH_MODE=same_org_client_credentials`. Set `SHOPIFY_SAME_ORG_CONFIRMED=true` only after that check. Privately configure `SHOPIFY_APP_CLIENT_ID` and `SHOPIFY_APP_CLIENT_SECRET`. The server exchanges credentials with the exact shop, checks granted `read_orders`, and renews its cached token before the provider's expiration. Merely owning or installing an app does not prove same-organization eligibility.
- **Custom distribution to a different organization:** Install through the supported custom-distribution flow and obtain the grant using Shopify's supported authorization-code flow for an external app (or token exchange for an embedded installation service). Select `SHOPIFY_ADMIN_AUTH_MODE=installed_oauth`. A reviewed installation/token-management service must supply `SHOPIFY_ADMIN_ACCESS_TOKEN` and its actual `SHOPIFY_ADMIN_TOKEN_EXPIRES_AT` privately. This repository does **not** implement an Admin installation callback or automatic OAuth refresh-token rotation. The adapter refuses expired grants instead of assuming permanence. If no supported token-management path is available, keep Admin integration disconnected; never switch on the same-organization flag to bypass this requirement.

Request `read_orders` for reconciliation and the corresponding order/refund webhook topics. Verify access to the Shopify customer identity attached to each order and any required `read_customers`/protected-data permissions. Normal order history access is time-limited; `read_all_orders` requires separate approval when historical reconciliation beyond that window is actually needed. Do not request product, inventory, fulfillment or order-write scopes for this stage. There is no generic `write_webhooks` scope to invent; subscriptions need the resource access required by their topics.

Future custom loyalty requires `read_discounts` and `write_discounts` for supported lookup/create/deactivate operations. Record those in the installation plan and obtain approval when configuring Prompt 6. No discount mutation or paid loyalty plugin is implemented or needed now.

## Database and durable worker

Migration `202609120003_commerce.sql` adds encrypted cart handles, verified Shopify-customer mappings, order jobs/current snapshots/immutable ledger, and consented opaque campaign references. It seeds no products, customers, campaigns, prices or orders.

Apply through `pnpm db:migrate` using the previously documented migration-only connection. Provision a distinct LOGIN password for the new `northside_commerce` role and set `COMMERCE_DATABASE_URL` privately. Never reuse migration/auth/runtime credentials. This server role is restricted to Northside commerce records and cannot read session tokens or operational cards. The authenticated runtime can read owned orders through the verified Shopify customer mapping plus RLS; email and cart handles cannot establish ownership.

After the app installation and database are configured, subscribe only these topics to the exact HTTPS route `/api/shopify/webhooks`, with the pinned API version:

- `orders/paid`
- `orders/cancelled`
- `orders/updated`
- `refunds/create`

Use `SHOPIFY_APP_CLIENT_SECRET` from the installed app for raw-body HMAC verification. Invalid signatures/shops/topics are rejected. The route streams a bounded raw body, validates it, and atomically inserts a receipt and job before returning 200. It stores a delivery ID, shop, topic and order ID; it does not retain the raw payload, email, address or card notes. `X-Shopify-Webhook-Id` deduplicates delivery retries. Distinct deliveries with identical current order state do not add duplicate ledger snapshots. Shopify secret rotation must be coordinated; the current implementation accepts one active secret, so test/replay deliveries across the provider's rotation window before changing it.

Run a bounded worker pass with:

```sh
pnpm orders:work
```

The command exits after up to ten jobs. Configure a durable scheduler on the selected Node worker host to run it every minute after review; **no scheduler is installed or running now**. A Vercel website deployment alone does not run this CLI. Use an explicitly provisioned scheduled worker with the same private database/provider configuration; account access and deployment selection are still pending. No process timers or fire-and-forget work inside webhook requests are used.

Jobs use row locks, `SKIP LOCKED`, lease tokens, two-minute crash-recovery leases and bounded exponential retry delays. After eight failures they enter a visible failed state (expired final leases are swept by the next worker run). Provider reads are serialized per order before committing a current snapshot. Older provider timestamps cannot overwrite newer refunds/cancellations. Receipts, current order and ledger writes commit together. A crashed worker can be rerun safely. Monitor pending/failed jobs and last received/processed timestamps at `/staff/integrations`; this page requires an authorized staff session outside fixtures. Failed jobs need a privileged, reviewed requeue after the cause is resolved. Keep the original receipt and ledger intact.

This order ledger records Shopify's current financial status and authoritative total/received/refunded amounts. It is **not** the points ledger, a consignment payout, or a full per-line loyalty eligibility snapshot. Prompt 6 adds approved earning allocations and reconciliation. Null customer orders remain unclaimed; no email matching/backfill is performed. A checkout return URL and browser cart ID are never proof of payment.

## Selected test catalog — only when Steve is ready

No publication is authorized by this setup document. Review this exact small-catalog checklist separately with Steve:

1. Choose the exact product handles and variant IDs for a small test set, such as one ordinary in-stock item and one safely controlled finite-stock variant. Record their current Draft status, channel publication and location quantities before any change. Keep the bulk catalog untouched.
2. Confirm product descriptions, real USD prices, shipping requirements, taxes and allowed customer markets with Northside staff. Do not use fixture prices as real merchandise settings.
3. Identify the **same Headless storefront sales channel that issued this app's token**. A publication to Online Store alone is not sufficient proof of headless visibility.
4. Obtain Steve's explicit approval for activating/publishing those named products to that selected channel. Make only those approved changes. Then verify the published products appear through Storefront while an unselected Draft product remains inaccessible, including by direct handle/variant ID.
5. Confirm real finite stock and the store's existing oversell policy. Do not change inventory quantities or “continue selling” settings during this build. Any setting change belongs to a separate reviewed store operation.
6. Preserve **Northside Retail Floor**, **Northside Breaker Storage**, and **Northside Excess Storage** individually. An online sellable quantity is never advertised as floor pickup stock. Have operations verify location routing and fulfillment behavior before the authorized checkout; pickup remains off.
7. Use Shopify's explicitly authorized test payment configuration and test customers. Agree how test orders are identified, canceled/refunded and cleaned up without altering the remaining catalog. Payment-mode/fulfillment changes require their own review; none were performed here.

## Campaign boundary

Opaque registered campaign references can be supplied as `/shop?campaign=<opaque-reference>`. A visible optional consent form records a first and latest eligible touch, timestamps and a 30-day expiry using an HttpOnly cookie. Only enabled references from `ns.campaign_refs` qualify; no arbitrary URL strings/emails become campaign metadata. There are no seeded live campaigns. Before using this boundary, register reviewed random references through the migration/admin workflow and verify permission wording. Full marketing administration and UTM normalization belong to Prompt 9.

At checkout the server attaches only `ns_first_campaign` and `ns_last_campaign` cart attributes, clearing them when no eligible consented touch is present. Account → campaign preference control can withdraw the remembered touch. Attribution is never used as identity, payment evidence, or proof of incremental sales. Logout clears both campaign and cart cookies. Shopify's own checkout data requirements remain separate.

## Required real checks before purchases can be enabled

- Hosted migration/role/RLS/TLS/pooling verification, real customer OAuth/refresh/logout, profile and customer-scoped order pagination. Prove customer B cannot obtain A's orders using IDs, email, cart handles or query parameters; include shared-device logout/account-switch tests.
- Actual authorized Headless collection/filter/search/cursor/variant requests, including a missing channel grant, empty Draft catalog, unpublished direct handle, zero stock, unknown inventory permission and provider outage.
- Real guest and signed-in Shopify-hosted checkout with trusted buyer IP, correct identity, prices, discounts, taxes and quantities. Verify a changed price/stock/cart is reviewed and checkout URL expiration is handled. Recheck buyer identity and logout on real devices.
- Actual raw HTTPS webhook delivery and duplicate retries into Supabase, asynchronous worker scheduling, timeout/crash recovery, repeated execution, cancellation and partial refund followed by delayed paid notification. Prove the ledger converges and failed jobs are visible. Check delivery latency and provider subscription health.
- Verify installed app ownership/authentication/scopes/token renewal. For installed OAuth, prove the external token-management path rotates safely and the app becomes unavailable after expiry. Review protected customer data permissions and permitted history window.
- Confirm Shopify location routing and fulfillment in the authorized test order. No floor-pickup claim or summed three-pool stock count.
- Verify optional campaign consent, eligibility, first/latest touch and actual Shopify cart-to-order attribute preservation. No personal or provider-secret values in URLs, client bundles, proxy logs or marketing fields.

Public purchases remain a code-level `false` flag. There is no environment-variable shortcut. Enablement requires a separate reviewed change after these checks pass. Loyalty earning/redemption, scanner, aisles and pickup also remain disabled. Stop after Prompt 3; do not start Prompt 4 without a new instruction.

## Official references reviewed

- [Storefront cart management and authenticated checkout](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Continuous cart authentication and buyer IP](https://shopify.dev/changelog/continuous-cart-authentication)
- [Customer Account API discovery and authentication](https://shopify.dev/docs/api/customer/latest)
- [Customer profile and owned orders](https://shopify.dev/docs/api/customer/latest/objects/Customer)
- [Customer Account order fields](https://shopify.dev/docs/api/customer/latest/objects/Order)
- [Storefront product variant availability](https://shopify.dev/docs/api/storefront/latest/objects/ProductVariant)
- [Admin order financial totals](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)
- [Same-organization client credentials and other installation paths](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
- [Raw webhook signatures, duplicates and retries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
