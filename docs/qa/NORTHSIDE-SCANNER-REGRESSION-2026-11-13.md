# Northside Preview 9 barcode investigation and repair — November 13, 2026

## Outcome and scope

The repaired internal build is configured as **0.1.0 (10)**. It fixes a reproduced UPC/EAN equivalence gap for product GTINs carried in Code 128 or entered manually, supplies the verified canonical Shopify barcode to explicit Add, and makes QA evidence durable enough to diagnose physical failures. No backend deployment is required. Camera capture/autofocus/exposure/zoom/format/lifecycle implementation files are unchanged from `ccb2139`. No permanent ESL housing resolution was implemented; obsolete housing-related diagnostic fields were removed. Product barcodes on the ESL screen and original boxes are the only customer workflow.

**Physical cause remains unverified.** The user supplied a build9 report with configured build9, rawValue/format/lookup=null and all event counts0. It contains no retained decoded value or HTTP attempt. It cannot prove the cause of “product not found,” the symbology/content on an ESL, or the actual native binary. Build9 cleared reports on tab/background/Scan-next transitions; that evidence-loss behavior is repaired. No claim of Shopify POS parity is made.

## Build and environment verification

| Property | Inspected build8 | Inspected build9 |
|---|---|---|
| Source commit | `ccb21395d59177b582fc5e775e28325d066e82dd` | `9fdaab65aa789cf8f1d7c6fd5adc6cf23e139561` |
| EAS ID | `e44cb84e-0e93-4a94-b8fa-b254e159ff8c` | `a481dbba-8499-4e00-a1a7-743a5f2a3af9` |
| Native version/build | 0.1.0 / 8 | 0.1.0 / 9 |
| Bundle | `com.northsidecollectibles.customer.preview` | Same |
| Storefront lookup | `https://9i3hnb-jw.myshopify.com/api/2026-07/graphql.json` | Same |
| Commerce API | `https://northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app/api/mobile/v1` | Same |
| Public preview/catalog selection | Seven pinned product/variant/barcode identities | Same values and compiled control flow |
| Native camera bridge/capture/matcher | Verified signed IPA | No behavioral matcher/camera/config drift found |
| OTA | Embedded updates.enabled=false; native EXUpdatesEnabled=false, no channel/update URL | Same; no OTA capability in inspected artifact |
| Diagnostics | Absent | Explicit preview flag enabled; build number/config flag are the only embedded config differences |

Both actual downloaded IPAs were inspected, not inferred from the current checkout. Native identifiers, signing/profile, query text and decoded catalog tuples match expected records. Old artifacts do not embed a Git SHA; their source is established by EAS metadata and exact source-archive bytes. The phone's supplied report identifies only JS configured build9, so its native build remains unverified until a new native-identity report is captured.

The current native API alias resolves to READY deployment `dpl_J8tqAu1df3c7NFF6FvAFUeHcuCKJ`, created November12 at22:09:18UTC. CLI-upload metadata has no whole-deployment Git SHA. Relevant file fingerprints match retained source at `8e08e383877277b690f5a219b70e9cc0d3d14edf`; matcher/catalog files are older than current source. Shopping, ingress/gate and cart-service fingerprints still match the current retained files. This is per-file evidence, not an asserted deployment-wide commit. The configured public alias accepts scan reads; a unique deployment URL separately returned401 deployment protection. No protection bypass or auth/environment change was made. Env metadata was inspected by variable name/target/type only.

Ordinary product scans in signed8/9 use the public Storefront adapter directly; they do **not** call this backend. The backend is involved in explicit Add and independent registered-QR workflows. Backend age therefore does not by itself explain the reported product-lookup regression. No housing routing or new housing verification guard was present.

## Proven software failure and repair

Fresh Shopify records and both old matchers reproduce this matrix for every approved Panini UPC:

| Decoded/request representation against stored12-digit UPC | Before | Repaired app |
|---|---|---|
| UPC-A12 | PASS | PASS |
| EAN13-tagged normalized12 | PASS | PASS |
| Checksum-valid zero-prefixed EAN13 | PASS | PASS |
| Literal Code12812 | PASS | PASS |
| Checksum-valid zero-prefixed13 carried in Code128 | FAIL — not_found | PASS — valid UPC/EAN equivalence |
| Same zero-prefixed13 entered manually | FAIL — not_found | PASS — valid UPC/EAN equivalence |

This gap predates build9. It is a demonstrated software defect, **not established as the physical failure cause**. Raw and symbology from the physical ESL screens are still required.

The matcher now retains the exact input first and adds only a checksum-valid12-digit UPC-A /13-digit zero-prefixed EAN equivalent. It does not strip arbitrary zeros, infer UPC-E without its format, correct bad check digits, use SKUs/titles/prices/substrings, or follow scanned URLs. Existing standards-correct UPC-E expansion and separate QR workflows remain. Multiple exact/equivalent variant claims remain ambiguous, even if one is an exact raw claim. Drifted/quarantined claims still participate in collision detection.

The old live backend also rejects raw padded Code128/manual input, so a client lookup-only patch would break Add. `verifiedScanAddInput` proves the fresh selected Shopify barcode belongs to the original validated candidate set, preserves raw decode/symbology separately, and sends that exact canonical barcode with literal Code128 format for explicit Add. This also avoids sending expanded UPC-E with an incompatible UPC-E format. The deployed handler repeats canonical identity, selected variant, reviewed price, availability and Retail Floor checks before mutation. No Add/cart/checkout or stock-changing request was sent during this audit.

## Actual six-product verification

Read-only Admin confirms the exact six product/variant identities, ACTIVE status, clean primary barcode strings and publication to POS, Northside Headless and Online Store. Each public record has one complete variant and its expected barcode. Duplicate barcode searches across the six UPCs and their valid zero-prefixed forms returned exactly six distinct variants with complete pagination. Additional existing URL barcodes were preserved. No product, price, stock, barcode or publication was changed.

| Product | Shopify barcode | ESL decoded value / symbology | Resolved variant (numeric Shopify GID suffix) | Result |
|---|---|---|---|---|
| 2023–24 Panini NBA Prizm Hanger Box | `746134150968` | UNVERIFIED | `64521944891761` | PASS software lookup; physical pending |
| 2023–24 Panini Phoenix Basketball Mega Box | `746134172663` | UNVERIFIED | `64521945022833` | PASS software lookup; physical pending |
| 2023–24 Panini Select NBA Basketball Hanger Box | `746134170294` | UNVERIFIED | `64521945121137` | PASS software lookup; physical pending |
| 2023–24 Phoenix NBA Blaster Box | `746134158551` | UNVERIFIED | `64521956622705` | PASS software lookup; physical pending |
| 2023–24 Prizm Monopoly NBA Blaster Box | `195166245478` | UNVERIFIED | `64521956655473` | PASS software lookup; physical pending |
| 2023–24 Panini NBA Prizm Mega Box | `746134151026` | UNVERIFIED | `68224325419377` | PASS software lookup; physical pending |

Do not substitute these expected values for actual ESL decodes. The screen could encode a different value; the new report will capture it.

The app has no persistent positive/negative barcode cache and fetches all seven pinned public records with cache:no-store. No incomplete product pagination was found. Current public requests return HTTP200/API2026-07; absence of Age/Cache-Control response headers does not prove anything about upstream CDN internals. The live backend accepted all six exact12 UPCs under UPC-A, Code128, normalized iOS EAN13, true zero-EAN13 and manual formats (30 successful reads) and rejected all twelve padded Code128/manual cases (404). Six validation negatives returned expected400/404. The new canonical Add representation is accepted by that deployed read path for all six; completed cart-write acceptance remains untested.

## QA and error handling repair

- A visible **QA** button shares the Scan/Cart control row, without adding a row above the camera. It opens diagnostics without restarting Scan. Long-press navigation is no longer needed.
- The last timestamped public scan attempt survives tab changes, Scan-next and background/foreground. It remains memory-only and is replaced by a new lookup, explicit Clear, identity/API change or app restart. Pending interrupted lookups are marked cancelled; stale async/native callbacks remain fenced. Clear is disabled while a lookup is pending.
- Copy uses an explicit allowlist, URL/control redaction and bounds. No images, auth/cart/customer identifiers, headers, raw provider bodies, persistence, analytics or automatic sending were added.
- Native iOS build is read from the installed `expo-constants`58.0.16 supported `platform.ios.buildNumber` (Info.plist). It is separate from configured JS build. Build10 embeds validated EAS Git SHA/build ID using the [documented cloud build variables](https://docs.expo.dev/eas/environment-variables/usage/). Missing locally is unknown, not a fabricated source revision. OTA remains disabled; expo-updates is absent, so no runtime update ID is invented.
- The copied trace includes raw value/format, timestamp, lookup candidates, actual endpoint/path, HTTP status (null when no response), API version, no-store request setting, matching/eligibility stage, matched variant/barcode and planned canonical Add input.
- Unknown barcode, ambiguous match, unavailable public item, input/verification failure, transport outage/timeout, server error/rate limiting and access/endpoint errors have distinct states. An expected approved identity returning a null public node is unavailable rather than an unreadable/unknown barcode. HTTP500 with a not_found body is still a server error; raw response bodies never enter diagnostics.

## Checks and remaining acceptance

PASS: mobile374/374 tests across23 suites; shared matcher44/44; local mocked native-catalog/shopping/cart/ingress35/35; TypeScript; changed-source ESLint with zero warnings; unchanged native plugin10 tests and4 Swift syntax checks. Independent source review found no production-code blocker. Real public exact reads6/6 pass;36 representation cases on fresh Shopify data pass after repair. These are code/read validations, not physical-camera or real cart-write evidence.

Changed: mobile config, Scan screen, public/backend scan HTTP observability, diagnostics, canonical Add helper, shared matcher and targeted tests. No native dependency upgrade, POS change, ESL layout change, backend deployment, production deployment or App Store submission. Existing user changes outside this scope were preserved.

NOT TESTED: physical labels, three-in-a-row success, real explicit Add transaction and actual on-phone clipboard behavior. NOT VERIFIED: the exact ESL decoded payloads and the cause of the user's broad build9 physical regression. Shopify POS parity is a physical acceptance condition, not a unit-test result.

## iPhone acceptance and capture

1. Install the new internal build on the registered iPhone. Open Scan → **QA** and confirm **native build10**, configured bundle10, the source SHA and EAS build ID agree with the delivery record. OTA should show disabled. This requires an IPA installation; no OTA was published.
2. For each of the six products, aim at only the **product barcode on the ESL screen**, not the permanent housing code. Scan three consecutive times, using Scan next between attempts. Each must return the exact variant above. Then repeat using its original box barcode. Record which surface and label size was used.
3. After any failure, tap QA immediately, Copy scan diagnostics, then paste the report into chat. The timestamped report now survives changing tabs/backgrounding. Include the product, ESL-vs-box, distance and zoom. If rawValue remains null, no accepted event was retained; test manual entry of the exact printed digits as a separate attempt and copy that result too.
4. Confirm unknown codes show not-found, offline mode shows a connection error, and restoring network plus Retry works. No failed or ambiguous lookup may display Add for a guessed product.
5. Leave Scan for another tab and reopen it; background/foreground once; confirm automatic camera startup, sharp preview, 1×/1.5×/2×, torch and Scan next. Test small/large ESL labels and box print at8/12/16 inches. Review before explicit Add; scanning alone must never add.

Install/build provenance is appended after the signed artifact is verified. The correction is app-side: it does not change currently installed builds8/9 or the deployed backend. A new internal install is required for normalization, canonical Add and QA retention.

Evidence in the current chat `work/scanner-regression-10/`: `signed8-vs9-identity.json`, `compiled-lookup-comparison.json`, `admin-current.json`, `barcode-duplicates-current.json`, `storefront-current.json`, `baseline-current.json`, `lookup-after.json`, `api-scan-http.sanitized.json`, `api-validation-http.sanitized.json`, `api-audit-findings.txt`, and independent test logs. Existing safeguards are in `packages/customer-contracts/src/native-scan.ts` and customer `mobile/{shopping,approved-native-catalog,storefront-cart}.ts`.
