# iOS live catalog preview — November 11, 2026

The existing Expo app supports tokenless public Shopify catalog reads in the
approved iOS preview. Existing cards, detail routes, loading/error states,
refresh controls, branding, colors and freshness handling are retained.

## Connection and scope

- Shop: `9i3hnb-jw.myshopify.com`; pinned Storefront API: `2026-07`.
- `MOBILE_PUBLIC_CATALOG_PREVIEW=true` selects `PublicCatalogApi` through the
  existing `MvpProvider` and shared catalog contracts. No replacement app or
  duplicate server is introduced.
- `src/api/public-catalog.ts` holds six product/variant/UPC/handle identities as a
  public read scope, independent of server selling authorization. Titles, images,
  descriptions, prices and availability always come from Shopify. No saved
  product values or fixture fallback are used by this transport.
- A null Storefront node is omitted because public visibility was not proved.
  A published unavailable product remains visible with unavailable messaging.
  Unknown handles, changed identities, malformed data, GraphQL errors, unexpected
  API versions and additional variants fail closed.
- Donruss Optic NBA Blaster Box is the seventh original selection, now reported
  out of stock by the owner. Requested UPC `746134157646` had no exact verified
  product ID; similar draft Optic records have different UPCs. Neither draft is
  published or substituted by the app.

## Credentials and services

Shopify supports public Products/Collections reads without a Storefront token.
Requests use HTTPS, omitted credentials, no authorization headers, bounded
responses, cancellation, timeout and a one-minute observation lifetime.
See the [pinned Storefront reference](https://shopify.dev/docs/api/storefront/2026-07).
No Admin, private Storefront, customer or deployment-protection credential enters
the app. A tokenless read does not assert a particular Headless token context;
Northside Headless publication is verified separately through Admin reads.

`apiOrigin` remains absent and customer services remain disconnected. Native
authentication, scan lookup, shopping, checkout, orders, wallet and service
requests still require the existing secure backend. Releases and Singles/New
Arrivals are not inferred from this six-product selection. Private browser
review and test fixtures retain their explicit isolation and cannot be selected
with the live catalog mode.

The web/customer backend is protected by Vercel SSO. This catalog-only connection
does not change that protection or deploy any backend or website. Ordinary
production and Android identity guards remain intact. The preview cloud guard
pins team `NF42JBZCBW`, bundle `com.northsidecollectibles.customer.preview`, Expo
owner `northside-collectibles` and project
`ecfde92e-a01e-4158-b0ce-13908afa39ab`.

## Retail Floor stock

The approved location is Northside Retail Floor, Shopify Location
`121087263089`. All six products were verified stocked there and published to
Online Store, POS and Northside Headless. Public `availableForSale` is online
availability; it does not prove location quantities or reserve stock. The app
retains `quantityAvailable: null` and shelf-stock caveats. Location-specific
selling, scan and POS checks remain server responsibilities. No inventory,
prices or publication state are changed by this integration.

## Validation and phone acceptance

With Node 24 and existing dependencies:

```sh
pnpm typecheck
pnpm test
pnpm check:catalog:live
pnpm build:check preview ios
```

The live check performs read-only public catalog and product-detail requests and
fails unless all six approved products are currently visible. It needs network
access but no credentials. Unit fixtures exist only under tests.

`eas.json` preview uses internal distribution, a physical iOS build, and
`developmentClient: false`. Live catalog build number is `2`. OTA updates are
disabled, so installed interface-only build `0.1.0 (1)` needs a new IPA. Reuse
existing EAS-managed signing and the registered iPhone; do not rotate credentials
for a catalog change.

On the updated iPhone build, verify six images/titles/prices; search/categories;
details and variant identity; refresh; airplane-mode errors without samples or
old prices; reconnect recovery; and foreground refresh after a minute. No
development server should be running. Sold-out messaging is covered with unit
responses because all six products were publicly available at validation time;
no inventory was altered to manufacture a test. Only the owner can confirm
these physical-device acceptance results.
