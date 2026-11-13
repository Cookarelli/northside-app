# Build 10 helmet lookup diagnosis — November 13, 2026

## Finding and delivery decision

**The helmet is excluded by the compiled test-product selection, not by its barcode, stock or current publication.** Signed Build10 has exactly seven product identities: the six Panini items plus Golf. Product `16135959970161` is absent. The deployed native API independently has the same seven-product restriction.

The source fix appends only the verified helmet as the eighth approved identity and updates diagnostic scope/count. The original seven full tuples, barcode normalization, canonical Add, publication checks, duplicate detection and inventory rules are unchanged. Four camera/plugin files, package/lock and app configuration/version are unchanged.

**Backend/configuration alone is insufficient for installed Build10.** Its ordinary barcode lookup fetches the embedded product IDs directly from Shopify and does not call the backend on a miss. OTA is disabled. Conversely, a new app alone would leave helmet Add rejected by the old backend's approved selection. Both the matching preview backend update and a new internal app are needed. Neither release action was started during this task. No production deployment, Shopify data edit, cart write or payment occurred.

This remains an explicit eight-product preview selection in source. Other products outside that selection remain excluded; this patch does not silently enable the entire Shopify catalog. A server-managed approved catalog would require a deliberate architecture change to avoid rebuilding the app for future product additions.

## Verified Shopify identity and eligibility

Read-only Admin and public Storefront reads independently establish:

- Product: **2026 Fanatics Under Wraps Replica Helmet Full Size**, `gid://shopify/Product/16135959970161`.
- Variant: `gid://shopify/ProductVariant/68224353927537`; handle `2026-fanatics-under-wraps-replica-helmet-full-size-square-mghiqfcx`.
- Actual stored variant barcode: **`793397728021`**. SKU separately reads `793397728021`; equality is incidental and is not used as an alias rule.
- ACTIVE; one complete variant; public availability true; variant availability true; currentlyNotInStock false. Current price399.95USD.
- Published to POS, Northside Headless and Online Store (also Shop and Fanatics). Public Storefront directly returns this exact identity/barcode with HTTP200/API2026-07. PublishedAt reads `2026-11-13T20:53:45Z`.
- Northside Retail Floor `121087263089` is active; inventory tracked; itemSKU matches; available99. Inventory pagination is complete.
- No product tags. The active native preview lookup does not request or evaluate approval tags. Generic collection/tag workflows are not the route used by this binary.
- Barcode search for `793397728021` and valid zero-prefixed `0793397728021` returns exactly this one variant, with complete pagination.

These facts do not override the approved selection. They show that stock, duplicate barcodes, missing publication and missing tags are not the demonstrated exclusion.

## One end-to-end reproduction

The user reports that the diagnostic control is unavailable. The phone's exact raw decode, symbology and native identity therefore remain **UNVERIFIED**. The displayed message is consistent with an accepted lookup attempt, but does not reveal its input. The following trace is an explicit software reproduction using Shopify's verified barcode, not an invented phone capture:

1. Input string `793397728021`, supplied format `upc_a`. Standards-valid candidates are `793397728021` and `0793397728021`; no SKU, title or price matching occurs.
2. Build10's `PublicCatalogApi.scan` calls `read(PREVIEW_CATALOG_SELECTION)`. The fixed endpoint is `https://9i3hnb-jw.myshopify.com/api/2026-07/graphql.json`; methodPOST, cache:no-store, credentials:omit.
3. Request body contains `PUBLIC_CATALOG_QUERY` and `variables.ids` with seven IDs. **The helmet ID is absent.** Raw scanned text is not sent as a Shopify search; matching is local against these fetched products.
4. Shopify returns HTTP200, seven valid public product nodes and no helmet. The recorded trace has catalogProducts7, unreturnedProducts0, matchingVariants0 and reason `no_matching_visible_variant`.
5. `matchCatalogScan` builds its index from returned **variant barcode** fields. Zero unique matches throws `not_found`.
6. The unavailable-product branch checks expected identities in the selection. Since the helmet is not configured at all, it does not classify this as an approved-but-unavailable item.
7. ScanScreen catches `MobileFailure("not_found")`; `scanMessage` at `apps/mobile/src/app/(tabs)/scan.tsx:69–70` emits “Product not found. No approved product matches this barcode.”

The camera, inventory lookup and Add action are not the excluding stage. No Add is available for a failed lookup. There is no persistent positive/negative app barcode cache; each read requests the fixed IDs again. Public data and inventory connections are complete, so pagination is not the issue.

A separate read-only POST to the deployed `/api/mobile/v1/scan` returns404/not_found for five helmet representations. All six Panini UPC-A controls return200 and the correct variant. The backend's `approvedNativeScan` fetches only its approved IDs; `nativeRetailQuantity` and cart validation also require selection membership. Its failure is corroborating scope evidence; **it is not a backend request made by the installed app's ordinary miss path**.

## Verification before any build request

| Product | Shopify barcode | Physical ESL decode | Installed10/deployed scope | Corrected source |
|---|---|---|---|---|
| Fanatics Under Wraps Full Size Helmet | `793397728021` | UNVERIFIED | FAIL: absent / API404 | PASS: variant `68224353927537` |
| Prizm Hanger | `746134150968` | UNVERIFIED | PASS read/control | PASS: `64521944891761` |
| Phoenix Mega | `746134172663` | UNVERIFIED | PASS read/control | PASS: `64521945022833` |
| Select Hanger | `746134170294` | UNVERIFIED | PASS read/control | PASS: `64521945121137` |
| Phoenix Blaster | `746134158551` | UNVERIFIED | PASS read/control | PASS: `64521956622705` |
| Monopoly Blaster | `195166245478` | UNVERIFIED | PASS read/control | PASS: `64521956655473` |
| Prizm Mega | `746134151026` | UNVERIFIED | PASS read/control | PASS: `68224325419377` |

PASS here means software/read-only identity resolution, not physical iPhone or POS parity. Actual signed10 remains immutable and excluded; local tests do not change that binary.

Fresh corrected-source public lookups resolve all seven requested products. Forty-two representation cases—UPC-A12, iOS EAN13-tagged12, zero-prefixed EAN13, Code12812/13 and manual—resolve the expected variants through the app and local backend adapter using fresh Shopify data. Canonical Add input remains the verified variant barcode/code128. The local stock guard accepts the helmet's real read-only Floor snapshot as99. No provider mutation was used.

Automated checks: mobile376/376 across23suites; shared matcher46/46; backend native-catalog/RetailFloor/cart/shopping/ingress39/39; mobile and customer TypeScript; scoped lint in the correct workspaces, zero warnings. New regressions cover exact helmet identity, original-seven preservation, SKU-only rejection, drifted barcode/variant, duplicate claims, missing public node, and wrong/untracked/inactive/incomplete Floor proof. Independent review and frozen-camera checks pass.

Changed runtime files: `packages/customer-contracts/src/native-scan.ts` (one explicit tuple) and `apps/mobile/src/shopping/scan-diagnostics.ts` (derived scope/count). Focused tests and status documentation were updated. No camera behavior or native dependencies changed. App version is still10; no new build was queued during this evidence-first task. A later release must increment its build number.

## Next execution order

1. Review this evidence and the limited eight-product scope before another release. Decide separately if general scanning of all legitimately app-visible products is intended.
2. Update the matching preview backend selection, preserving existing gates; verify helmet scan200 and six controls before any real Add. Do not alter a production service or visibility policy without its applicable authorization.
3. Increment the internal app build and package the corresponding client selection. Verify the signed binary's source/native/config identity and eight request IDs. No backend-only workaround exists for installed10.
4. Physical acceptance: helmet ESL product barcode three consecutive scans, original box, six Panini controls, Scan reentry and explicit Add only after reviewing the exact product/price. The user's diagnostic-control absence remains unverified; do not assert a captured physical payload or successful Add until tested.

## Evidence

Current chat `work/helmet-scan/`: `admin-current.json`, `floor-proof.json`, `duplicates.json`, `public-direct-helmet.json`, `build10-source-reproduction.json`, `helmet-api-scan.sanitized.json`, `signed10-helmet-omission.json`, `source-fix-verification.json`, `reviewer-source-scope.json`, `reviewer-frozen-camera.json` and test logs. Signed10's decoded selection is also preserved in `outputs/iphone-preview-10/compiled-catalog-selection.json`.

Key code: shared `NORTHSIDE_NATIVE_SELECTION`; public-catalog.ts159–161/287/375; native-scan.ts matchCatalogScan unique-match guard; mobile ScanScreen scanMessage; customer `approved-native-catalog.ts` approved reads/Floor membership and `storefront-cart.ts` allowed merchandise checks. These are source references, not instructions to change Shopify data.
