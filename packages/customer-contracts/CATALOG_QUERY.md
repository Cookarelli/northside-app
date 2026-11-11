# Catalog browse request contract

`src/catalog-query.ts` adds the missing portable search and category request
contract for W02. Import it directly; the existing index and response contract
are preserved. It uses only the already installed Zod dependency.

`CatalogBrowseRequestV1` accepts these optional fields:

| Field              | Meaning and bounds                                                     |
| ------------------ | ---------------------------------------------------------------------- |
| `q`                | Literal search text, 1–100 characters, not blank or control-bearing    |
| `category`         | Exact Shopify `productType`, 1–80 characters; not a taxonomy ID        |
| `collection`       | Published collection handle matching `[a-z0-9-]{1,150}`                |
| `after`            | Opaque product cursor, 1–1500 characters, not blank or control-bearing |
| `collectionsAfter` | Independent collection cursor with the same bounds                     |

An empty object requests initial discovery. Omit absent filters and initial
cursors; explicit null, empty strings, arrays, numbers and unknown keys are
invalid. Values are not trimmed, coerced, decoded or truncated. Page size remains
the existing server's twelve products/collections, not a client-selected limit.

Search plus category and collection plus category are supported. Search plus
collection is rejected: the existing server adapter ignores collection whenever
search is present. This contract avoids promising a combined filter that the
adapter cannot honor. It does not change that adapter's existing web behavior.

`validateCatalogBrowseRequestV1(unknown)` returns validated data or only the safe
code `invalid_catalog_query`. It returns no raw Zod issues or rejected values.
The schema cannot establish publication, authorize a shop/customer or execute a
query. The eventual trusted server must map the validated fields to its existing
Storefront adapter, including literal search escaping and product-type filters.
Treat `q` as text, never as raw Shopify search syntax or GraphQL source. Do not
log search/cursor values merely because validation succeeded. Reset the product
cursor when product filters change; never reuse the collection cursor for it.

The existing response contract already carries categories via `productType`
and published collection handles. SKU and manufacturer UPC/GTIN/ISBN values are
observed nullable strings under each exact variant's `identifiers`; UPC uses the
`barcode` field with leading zeros preserved. A barcode is not unique identity,
retail registry approval, a validated symbology or permission to reserve stock.
No provider identifier is invented when its query did not supply it.

No endpoint, package registration, dependency installation, live provider call,
publication, price/inventory change or W03 work is included.
