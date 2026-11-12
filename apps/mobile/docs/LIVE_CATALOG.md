# iOS live catalog preview — updated November 12, 2026

## Current scan/cart pilot

The owner approved **2026 Upper Deck Allure Golf Hobby Box** as the seventh native
pilot product on November 12. The original six basketball products stay in scope;
the out-of-stock Donruss Optic is not substituted or published. Allure product
`15993268240753`, variant `64522039460209`, SKU/barcode `92840090001065` and handle
`2026-upper-deck-allure-golf-hobby-box-regular` are verified against Shopify.
Live prices, stock and images remain Shopify data. Allure currently has no image;
the existing unavailable-image placeholder is intentional.

Allure is published to Online Store, POS and the named Northside Headless channel.
The stable public product URL is the approved shelf QR; the same URL is a secondary
POS barcode, preserving the original numeric barcode first. Numeric QR codes and
temporary preview/admin URLs remain outside the permanent Northside QR contract.
The 14-digit Allure identifier is exact manual/Code128 lookup data, not UPC/EAN-13;
physical box barcode format has not been verified.

Build **0.1.0 (5)** is prepared for this expansion. Existing scan/cart API staging,
checkout-disabled behavior and approved build 4 camera/UI remain in place. The
small-label zoom experiment is excluded. The live checker now requires all seven
products. Retail Floor was read at 3 available / 3 on hand / 0 committed for Allure;
online availability alone never proves that location's stock. Phone and POS
acceptance of the updated shared shelf QR remain owner tests.

The following section records the original catalog-only build 2 implementation;
its six-product count and disconnected services describe that historical build.

## Original catalog-only implementation (November 11)

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
