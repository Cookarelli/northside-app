# Northside catalog response contracts

W02 defines the portable `northside.catalog.v1` wire contract for a future Next.js producer and Expo/React Native consumer. It is a source-only module using the already installed Zod dependency. There is no package manifest, workspace registration, API route, provider adapter, network request, storage, environment access, native project or purchasing behavior in this slice.

Source files are `src/catalog.ts`, `src/index.ts` and `src/catalog.test.ts`. Consumers can use direct relative imports until package registration is separately implemented. Do not assume `@northside/customer-contracts` is installed or resolvable. Existing manifests and lockfiles remain unchanged.

## Authority and publication

Shopify remains the authority for products, prices, publication, online availability, carts and checkout. A trusted server producer must read the existing published Storefront channel before emitting ready product data. Never populate the DTO from Admin Draft records, staff inventory projections, browser-chosen metadata or fixture fallback.

Ready products require `publication: "published"`. Observed responses require source `shopify_storefront`, shop `9i3hnb-jw.myshopify.com` and pinned API version `2026-07`. Draft, unpublished, archived, missing, boolean or unknown publication values are rejected. Unknown properties, including an Admin `status: "DRAFT"` beside a public claim, are rejected rather than silently stripped.

These literals prevent accidental mixing of known non-public data. **They cannot prove that a caller actually contacted Shopify or that a malicious producer told the truth.** The eventual server endpoint must establish that provenance; mobile validates the response from its approved HTTPS API. Publication and authorization cannot be delegated to a schema or inferred from availability. The existing API/provider integration is intentionally unchanged in W02.

## Response states

| Kind | Status | Data |
| --- | --- | --- |
| `product` | `ready` | One published product with source and freshness metadata |
| `catalog-page` | `ready` | One to twelve published products, product pagination and a separate collection connection |
| `catalog-page` | `empty` | Zero products for the successful requested page/filter, terminal product pagination and a possibly populated collection connection |
| Either kind | `unavailable` | Only version, kind, status and a safe code; no product/price/image payload |
| Either kind | `stale` | Only version, kind, status and `refresh_required`; no retained product payload |

The unavailable codes are `not_found`, `not_published`, `provider_unavailable`, `invalid_data`, `unsupported_currency`, `unsupported_api_version` and `variant_mismatch`. They are declared result states, not automatic mappings from provider exceptions. An eventual public endpoint can coarsen not-found/unpublished distinctions where needed; it must not attach raw provider messages, request data or credentials.

Successful empty does not mean the whole shop has no products. An unavailable provider must not be converted into an empty catalog. All variants of the response are strict, including no-data errors, so stale/unpublished product details cannot be appended to an error envelope.

## Product and variant fields

| Field | Contract rule |
| --- | --- |
| Product/variant ID | Positive Shopify `Product`/`ProductVariant` GID, correct type, bounded decimal ID |
| Handle and title | Existing handle character/length shape, bounded nonblank/control-free title |
| Description | Plain text, including normal line breaks, up to20,000 characters; not trusted HTML |
| Product type | Existing bounded category/filter string; empty allowed when Shopify supplies none |
| Image | Explicit null when missing, otherwise approved public Shopify image URL and nullable alt text; no sample replacement |
| Money | Required integer USD cents in safe numeric range; zero is valid, unknown/malformed/negative/fractional/unsupported-currency price is rejected |
| Product minimum | Provider's product-wide minimum; never recompute it from a partial variant page |
| Identifiers | `not_provided` requires null SKU/barcode; `observed` contains provider-returned nullable strings. No numeric barcode conversion; preserve leading zeros. |
| Variant parent | Every returned variant explicitly identifies this product; duplicate variant IDs rejected |
| Selected variant | Explicit null or a variant present in this returned page; no automatic first-available selection |
| Aggregate availability | Preserve Shopify's product flag. Aggregate false cannot coexist with a returned variant available for sale. Aggregate true does not require a sellable variant in a partial page. |
| Product path | Exactly `/shop/{handle}`, matching the current customer website route |
| Online store URL | Explicit null unless actually supplied/verified; if present, exact pinned HTTPS shop `/products/{handle}` with no query/fragment/credentials/port |

Current online browse/detail queries do **not** request SKU, barcode or `onlineStoreUrl`; use `not_provided` and null for those absent fields. The existing scan proof does request SKU/barcode; an approved producer can preserve them as `observed`. This state does not certify staff registry mapping or barcode uniqueness. Duplicate SKUs are permitted; identity is the exact variant GID plus parent, not SKU/email/title.

Image URLs must use canonical `https://cdn.shopify.com/s/files/...` destinations without credentials, explicit ports, fragments or duplicate query keys. Only the public transform/version parameters `v`, `width`, `height`, `crop` and `format` are allowed, with bounded simple values. Private signing/token query parameters, non-Shopify hosts, data/local URLs and sample images are rejected. Other legitimate future CDN patterns require a deliberate compatible contract/consumer change, not an arbitrary-host escape hatch.

These are Northside v1 response bounds, not a claim that Shopify universally imposes them. Producers must emit `invalid_data` or a reviewed safe projection when source data cannot be represented; do not truncate identity, invent money or mislabel a broken image as a confirmed missing image.

## Inventory and pagination

Variant availability preserves all three provider inputs and a consistent display state:

- `unavailable` when `availableForSale` is false, `currentlyNotInStock` is true, or quantity is zero.
- `unknown` when for-sale is true, backorder-only is false and quantity is null.
- `in_stock` only when for-sale is true, backorder-only is false and quantity is a positive safe Shopify Int.

Null quantity is not zero and does not imply stock is available to buy. Negative, fractional, string, missing or overflowing quantities are rejected. Online availability is not a retail shelf count, reservation, location projection or authorization to purchase. Existing cart/checkout revalidation and disabled purchase gates remain authoritative.

Product and collection connections keep independent cursors. `hasNextPage:true` requires a nonempty bounded cursor; a nonempty terminal page may retain its last cursor. Ready product lists contain at most12 entries; collection windows at most12; variant windows at most100. IDs/handles cannot duplicate within a product page and a variant ID cannot be reused across products.

Variant connections carry explicit `after`, using null for the initial window. An empty initial variant window is invalid. An empty exhausted continuation is valid only with a non-null requested cursor, no next page, null end cursor and no selected variant. This handles a legitimate request after the final cursor without inventing a variant or claiming the product was unpublished. Do not infer full product price/stock from the loaded variant window.

## Freshness and safe validation

`catalogResponseV1Schema` and the named sub-schemas validate structural wire data. **Use `validateCatalogResponseV1(input, policy)` at the response boundary** to enforce time as well. Structural validation alone does not establish freshness.

The caller supplies `nowMs` and a positive safe-integer `maxAgeMs`; this module reads no global clock and selects no live caching policy. Observed timestamps must be canonical UTC with milliseconds, and expiry must follow observation. The validator rejects future observations and rejects a snapshot at or beyond either its expiry or caller maximum-age boundary. Confirmed-empty responses have the same freshness requirements. No-data unavailable/stale envelopes do not pretend to have a successful provider observation.

Validation returns either `{success:true,data}` or `{success:false,error:{code}}`. Failure codes are `invalid_payload`, `unsupported_contract_version`, `invalid_freshness_policy`, `future_snapshot` and `stale_snapshot`. Rejected payloads and raw Zod issues are not returned. Trusted tests/developer tools may inspect the exported schemas' Zod issues, but production responses/logs must use safe bounded codes.

Use the existing server money helper to produce integer cents; the contract does not calculate Shopify prices or call a provider. It also does not authorize requests, grant publication, reserve stock, choose customers or enable commerce. Arbitrary text/cursors still require a correct source projection; strict fields are not a general personal-data detector.

## Validation and integration boundary

Focused tests exercise positive and rejected publication, malformed/private payloads, product/variant ownership, missing images, identifiers, unsupported money, stock ambiguity, pagination and exact time boundaries using synthetic unit inputs only. They import no application fixture adapters or provider code. The independent verification evidence and W02 completion status are delivered in this chat's `outputs/W02_IMPLEMENTATION_REPORT.md` and evidence files.

Future integration must use the approved mobile API/session plan and trusted Storefront services. Package registration, endpoint wiring, any additional provider fields or production content/device acceptance belong to their separately authorized work packages. There is no claim of a new live catalog endpoint or native app in W02.

Official reference context: [Storefront Product 2026-07](https://shopify.dev/docs/api/storefront/2026-07/objects/Product), [Storefront ProductVariant 2026-07](https://shopify.dev/docs/api/storefront/2026-07/objects/ProductVariant), [Zod strict objects and refinement](https://zod.dev/api).
