# Dynamic native catalog — November 14, 2026

Base: `8c06768`. This source change is unreleased; no deployment, iOS binary build, merchandise write, cart write or payment was performed by this work.

The backend now resolves native catalog, product and scan DTOs from the complete Shopify Storefront publication rather than eight compiled product tuples. The configured public preview adapter delegates all catalog/product/scan attempts to that backend. Historical tuples remain only as regression evidence and for the known `/m` Monopoly label. No camera/native dependencies changed.

Every product and variant page is traversed. Incomplete, repeated, duplicate-identity or over-capacity traversal fails closed rather than claiming a unique barcode. Exact and supported standards-valid UPC/EAN matches still use variant barcodes, never implicit SKU aliases. Unavailable public claims participate in ambiguity rejection. Draft/Admin product data never becomes public catalog data.

Before native Add/set, the canonical public product/variant, current availability, price, exact parent identity and tracked ACTIVE Northside Retail Floor proof are revalidated. Other inventory pools are not exposed or summed. Withdrawn cart merchandise remains removable; checkout is still disabled by the existing native preview policy. The general website sales policy is unchanged.

Fresh read-only source-adapter verification used the exported Storefront query against API `2026-07`: 11 public products with complete pagination; 40/40 representations across the original seven products plus helmet `793397728021`; unknown barcode controls return `not_found`. The additional existing Topps Series One Value Box `887521154753` resolves product `15993265488241`, variant `64522035298673` without a source tuple. Independent Admin proof confirms ACTIVE/tracked, exact SKU, active Floor quantity 277 and current Headless/Online Store publication. No test merchandise was created or published.

Evidence in this task's `work/catalog-scanner/`: `source-live-matrix.json`, `live-storefront.json`, `extra-retail-proof.json`, `extra-publications.json`, exact GraphQL documents and `frozen-camera-and-release-inputs.json`. These are software/read-only checks, not a captured physical iPhone decode or deployed acceptance. Synthetic duplicate/unavailable/continuation cases are explicitly unit tests.

Checks: mobile 23 suites / 378 tests; backend catalog/retail/cart/shopping/MVP/ingress 60 tests; shared barcode matcher 47 tests; camera native plugin 10 tests; customer and mobile TypeScript; affected customer/mobile/shared ESLint; whitespace checks. The matching deployed preview and physical device remain UNVERIFIED until integration. The reserved native alias must receive the lead's narrow GET catalog/product ingress extension before a public-preview client can use those reads.
