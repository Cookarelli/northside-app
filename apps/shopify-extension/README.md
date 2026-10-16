# Shopify POS bridge prototype — blocked for installation

`src/bridge.ts` is executable, dependency-free protocol code with mocked POS API tests. It covers the documented `pos.home.modal.render` scanner/cart/session APIs and stops on uncertain import rather than duplicating sales. It is **not a packaged, installed or device-verified Shopify extension**. There is deliberately no merchant app ID, extension UID, app install or CLI deployment config.

The existing customer app at `/in-store/staff` rehearses claim → simulated payment → prepare → collect. That fixture staff password is never a production POS credential. The bridge's `HandoffBackend` contract is not connected to that password route. Live support requires an installed app, authenticated Shopify session token verification, app/installation and location authorization, a current Storefront retail-only catalog validation service, durable import claims/acknowledgements and a complete POS extension shell generated with Shopify's current CLI. Do not enable an endpoint that accepts a browser-supplied actor or JWT shop claim alone.

The bridge starts only with an empty editable POS cart and never clears staff work. It places `_northside_reference` and `_northside_basket_version` cart properties, then calls `addLineItem` with numeric variant IDs. Shopify documents properties persisting through checkout into orders; the exact order webhook correlation, variant quantity behavior after staff adjustments, discounts, refunds and the selected POS plan/device still require a development-store proof. Private properties hide display but are **not secrets**.

No call here marks an order paid. Server-authoritative order reconciliation must complete payment; collection then uses its own state and single-use code. A partial import, network timeout or missing acknowledgement requires staff reconciliation. Restarting an extension cannot provide replay safety by itself; the backend one-time claim is mandatory.

Official references checked October 3, 2026 (pinned contract target 2026-07):

- [Cart API](https://shopify.dev/docs/api/pos-ui-extensions/2026-07/target-apis/contextual-apis/cart-api)
- [Scanner API](https://shopify.dev/docs/api/pos-ui-extensions/2026-07/target-apis/platform-apis/scanner-api)
- [Session API](https://shopify.dev/docs/api/pos-ui-extensions/2026-07/target-apis/standard-apis/session-api)
