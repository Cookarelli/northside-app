# Shelva housing barcode readiness — November 13, 2026

## Result

Internal **0.1.0 (9)** finished November 13 at 18:27:15 UTC. [Install on the registered iPhone](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/a481dbba-8499-4e00-a1a7-743a5f2a3af9). App source commit: `9fdaab65aa789cf8f1d7c6fd5adc6cf23e139561`. The downloaded signed IPA passed signature/profile/device, native camera binding, compiled diagnostics/Copy and source identity verification. SHA-256: `e439842849dfced574ab8914596b593a0e4f586e7e6a9fdc873a5a6725a9fcf2` (13,831,077 bytes). Physical acceptance remains untested. No backend was deployed.

**PARTIAL.** Internal iPhone build 9 adds scan diagnostics; it does **not** enable permanent ESL housing resolution. The source of current assignments is Shelva, but no supported assignment-read API, assignment-change feed or readable Shopify assignment field was available. The user confirmed that vendor documentation/access is not available and requested a vendor request. No guessed endpoint, browser-session credential reuse, static housing map or second manually maintained registry was introduced.

The four camera implementation files and shared barcode matching source remain byte-identical to `ccb2139`. The existing product review, explicit Add, duplicate protection, Shopify identity proof and availability checks remain in place. Generated ESL-screen barcodes and independent QR workflows remain unchanged. There was no production deployment, App Store submission, pairing/unpairing, publishing or product/inventory edit.

## Confirmed assignment conflict

Read-only Shelva Products, Prizm Configure and Hardware views showed the following pairings during this investigation. Hardware explicitly labels these numbers **Barcode**; Prizm Configure links the labels to the exact variant below. This establishes their meaning in the UI, not an undocumented API `devId` or the decoder's exact symbology/value.

The user's physical report associates **Select with `8003148023`** and **Prizm with `8003147389`**. Shelva's inspected pairing view associates those numbers with the opposite variants. This conflict is unresolved; possible causes such as physical placement, stale screen content or changed pairings have not been established. An attempted fresh browser recheck was blocked by an open Chrome extension UI. No pairings were changed. Capture each housing number, rendered product, original box UPC and current Find Label pairing together before repair.

## Six verified Shopify variants and observed Shelva pairings

Exact product/variant IDs were verified through Shopify Admin reads, rather than inferred from price/title. Public lookup results below used the app's actual tokenless Storefront adapter against fresh Shopify responses on November 13, including UPC-A, zero-prefixed EAN-13 and iOS-normalized UPC tagged EAN-13. These are read-only lookup tests, **not physical scanning parity or Add acceptance**.

| Product | Shopify variant ID (numeric GID suffix) | Stored variant barcode | Shelva UI paired barcodes | App UPC lookup / eligibility | Fix needed |
|---|---|---|---|---|---|
| 2023–24 Panini NBA Prizm Hanger Box | `64521944891761` | `746134150968` | `8003148023`, `8012050820` | PASS / published and available | Diagnose original device failure; resolve housing conflict; assignment feed |
| 2023–24 Panini Phoenix Basketball Mega Box | `64521945022833` | `746134172663` | `8003147365`, `8004007256` | PASS / published and available | Assignment feed |
| 2023–24 Panini Select NBA Basketball Hanger Box | `64521945121137` | `746134170294` | `8003147389` | PASS / published and available | Diagnose original device failure; resolve housing conflict; assignment feed |
| 2023–24 Phoenix NBA Blaster Box | `64521956622705` | `746134158551` | `8003136422` | PASS / published and available | Assignment feed |
| 2023–24 Prizm Monopoly NBA Blaster Box | `64521956655473` | `195166245478` | `8003147344` | PASS / published and available | Assignment feed |
| 2023–24 Panini NBA Prizm Mega Box | `68224325419377` | `746134151026` | `8003147387`, `8004006720` | PASS / published and available | Assignment feed |

All six were ACTIVE and published to POS, Headless and Online Store. Each Storefront product returned its single complete variant and expected primary barcode. Admin barcode searches across all six UPCs and their zero-prefixed equivalents returned six distinct variants with complete pagination, without cross-variant duplicates. No malformed/whitespace primary barcode, missing index entry or insufficient pagination was found for these six. Floor quantities were positive in read-only inventory records; no cart write or reservation was used to establish this result.

Admin 2026-10 exposes `ProductVariant.barcodes`; the existing Storefront 2026-07 application reads `barcode`. Existing additional product-URL barcodes on two variants were preserved. Product and variant metafield connections for all six returned empty and complete to this connector. That does not prove Shelva has no private app-owned data; it means this connection exposes no reusable assignment field.

## Trace of the two earlier product failures

| Stage | Prizm Hanger $69.95 | Select Hanger $39.95 |
|---|---|---|
| Accepted decode / displayed result | User reports “Product not found”; an accepted value reached lookup | Same |
| Exact raw value and format from that failed scan | NOT VERIFIED; not captured by build 8 | NOT VERIFIED; not captured by build 8 |
| Current stored UPC lookup | PASS: exact intended variant | PASS: exact intended variant |
| Current UPC/EAN equivalence | PASS for the three tested retail representations | Same |
| Current publication/index eligibility | PASS on read-only data | PASS on read-only data |
| Cause of the original physical failure | NOT VERIFIED pending copied device diagnostic | NOT VERIFIED pending copied device diagnostic |

The new physical housing values are not proof that the earlier failed scans read those same values. No data change was justified. A valid zero-prefixed 13-digit value tagged Code 128 or entered manually currently remains literal rather than gaining the EAN alias; this coverage gap was reproduced but is **not established as the original failure cause**. It was deliberately left unchanged with matching backend Add behavior until actual device evidence identifies the failing representation.

Current path: `BarcodeCamera` accepted event → Scan screen format/input/checksum guards → shared `barcodeCandidates` → `PublicCatalogApi.scan` → all seven pinned preview product IDs, fresh Storefront `cache: no-store` read → exact variant barcode index and ambiguity check → approved identity proof → Scan screen fresh observation/publication/variant barcode verification → review → explicit Add → existing backend repeat validation and Retail Floor checks. Ordinary product barcode scans do not currently consult an ESL assignment backend. SKUs are not barcode aliases.

## Assignment source and synchronization

Shelva's UI showed 12 products / 15 paired and published labels, and Hardware 108 total / 15 paired / 15 published. Prizm, Phoenix Mega and Prizm Mega already demonstrate multiple labels per variant. Auto-Sync was enabled in Instant mode. The settings explain Shopify product updates flowing into labels; this is not evidence of an outbound assignment feed. Multi-product label mode was disabled for this shop, although Shelva supports that feature generally.

Public documentation supports looking up a printed label barcode in Shelva POS Quick Actions and inspecting/replacing a pairing. Shelva's [release notes](https://shelva.app/release-notes) also describe multiple labels, multi-product labels, reassignment and broken-label handling. None of the inspected public documentation establishes a supported customer-app API schema, authentication, freshness or assignment-event contract. See also [POS help](https://shelva.app/help/shopify-pos/) and [pairing help](https://shelva.app/help/pair-and-publish/).

Repository `ns.store_assignments` maps variants to physical store locations, not ESL devices. `ns.store_qr` maps Northside opaque URL tokens, not factory hardware codes. Neither should be repurposed. No Shelva client, assignment worker/webhook, credentials contract, authoritative current resolver or cache existed.

## Supported integration required before activation

These are Northside requirements for the vendor contract; **the field names/endpoints are not claimed to exist**:

1. Exact printed-barcode field, documented relationship to device identity, encoding/format rules and preservation of leading zeros; shop and Shelva-location scope.
2. Server-only authenticated current lookup, or a vendor-maintained read model automatically updated by Shelva. Return recognized/unknown, active/unassigned/retired/broken state, exact Shopify variant reference(s), current assignment revision and verification time. Include completeness/pagination and rate-limit guarantees.
3. Documented events or reliable point reads for pair, reassign, unpair, retire/break, move and multi-product membership. Webhook authentication, ordering/versioning and replay semantics must be specified.
4. Initial implementation: no positive or negative assignment cache. Read the source for every scan and revalidate again before Add. A failed/stale/incomplete read returns Retry, never the last product. Reassignment replaces the prior target; unassignment/retirement clears it. Multiple physical labels can reference one variant; multiple variants on one housing code remain ambiguous.
5. Evaluate product-barcode and housing-identity paths without prefix/length guesses. Different variant claims produce ambiguity. Never silently use a product result when an unresolved housing claim could conflict. Keep original raw housing input and separate provenance; do not change Shopify barcodes.
6. Resolve the assigned variant against current approved Shopify publication, availability, price and Retail Floor evidence. Reject a reviewed A if the label now points to B or is unassigned. Preserve explicit Add and all cart checks. A trusted backend assignment result needs a versioned mobile contract; the current client correctly rejects a housing value that is not a product barcode.
7. If a synchronized read model becomes necessary, use authenticated versioned events and tombstones, reject duplicate/out-of-order rollback, reconcile a complete snapshot, invalidate both old/new assignment caches and disable resolution until currentness is verified. A timed cache cannot manufacture currentness.

If Shelva has no API, request a **Shelva-maintained** mapping projection: pairing in Shelva writes the exact housing code and variant reference to the documented integration record; reassignment replaces it atomically; unpair/broken/retire clears it; every change carries a monotonically ordered revision and shop/location scope. Northside verifies this projection on scan and Add. An occasional CSV export or manual copy of this table is insufficient. Keep housing scanning disabled if out-of-band Shelva changes cannot be synchronized reliably.

## Implemented QA preview

Build 9 uses `MOBILE_SCAN_DIAGNOSTICS=true` only in the internal iOS preview profile. Configuration rejects production activation; runtime also requires preview/development. Open **Internal QA diagnostics** near the secondary Scan controls, or hold the Scan subtab. No extra controls were inserted above the camera.

The last attempt shows bounded raw value, exact format, unmodified lookup value/candidates, actual public/backend path, stage, visible index/match counts when known, selected public product/variant/barcode, eligibility and failure reason. It explicitly says `assignment_feed_not_connected`; ESL identifier/assignment stay null rather than inventing recognition. Backend match counts remain unknown if the backend does not provide them. No forwarded event is distinct from lookup not-found, unavailable, ambiguous, invalid input/checksum, verification and network failure.

Reports stay in memory, clear on leaving the tab/background/identity change/Scan next, redact URLs/QR/control bytes, and copy only through explicit Copy. No diagnostic analytics, storage, console logging or automatic transmission was added. Observer errors do not affect lookup. Stale callbacks are fenced before diagnostic writes. Copy uses the installed React Native clipboard API; no new dependency, permission or camera API was introduced. Physical clipboard acceptance remains unverified.

Files: `apps/mobile/config/app.ts`, `apps/mobile/eas.json`, `apps/mobile/src/api/{client,public-catalog,scan-trace}.ts`, `apps/mobile/src/app/(tabs)/scan.tsx`, `apps/mobile/src/shopping/scan-diagnostics.ts`, and diagnostics/public-catalog/MVP tests. Backend, POS, ESL layout, consignment and grading sources were not changed.

## Status and validation

| Feature | Status | Evidence / remaining work |
|---|---|---|
| Existing product UPC paths and safe variant proof | PASS | Fresh public read for all six; existing regressions; no barcode source changes |
| Build 8 camera improvements preserved | PASS | Four camera files and shared matcher byte comparison to `ccb2139` |
| Internal copyable diagnostic flow | PASS automated / NOT TESTED physical | Mobile tests, TypeScript, scoped lint; test on actual iPhone |
| Housing barcode identity | PARTIAL | Two printed values supplied by user overlap UI Barcode fields; exact decoder formats not yet captured |
| Authoritative live housing → variant resolution | NOT TESTED / NOT VERIFIED | Vendor feed/API and authentication contract required; not implemented or activated |
| Housing reassignment/unassignment/retirement safety | NOT TESTED | No supported live resolver; no live assignment mutations performed |
| Cross-namespace collisions and stale feed handling | NOT TESTED | Requirements specified; no fake provider tests claimed as integration acceptance |
| All six original-box physical scans | PARTIAL | User reports 4/6; remaining two need raw QA reports |
| All six permanent-housing physical scans | NOT TESTED | Mapping feed absent; two reported physical associations conflict with UI |
| Shopify POS ordinary product scans | PARTIAL | User reports all six; not independently tested here |
| Shopify POS housing barcode cart resolution | NOT TESTED | Shelva Find Label is a management workflow, not proof of standard POS cart aliasing |
| Generated ESL barcode removal | NOT TESTED / deferred | Explicitly unchanged until end-to-end housing acceptance |

Mobile automated checks passed **341/341 tests across 22 suites**, TypeScript and scoped ESLint. The unchanged native plugin passed 10 tests and four Swift parse checks. Independent source review passed after one lifecycle fix. Signed build provenance is recorded in the companion delivery report. No physical iPhone was available to this agent.

## Physical checklist

1. Install internal build 9 on the registered iPhone; retain build 8's 1× baseline, 1.5×/2× and torch options. Test each original box UPC and the existing generated screen barcode separately for all six products. Aim at only one barcode at a time.
2. After each success or failure, open Internal QA diagnostics and Copy before switching apps (background clears memory). Record product, label size, 8/12/16-inch distance, zoom and copied report. Check complete barcode, sharpness, correct variant/price and no automatic Add. Repeat Prizm and Select first.
3. Scan each housing separately to capture its raw value/format. Housing lookup is expected to remain unresolved in this preview. Record printed housing number + displayed product + current Shelva Find Label pairing together. Resolve the Select/Prizm disagreement before enabling resolution; do not infer the correct pairing from this report.
4. Once a vendor-backed resolver exists in a test environment: verify all six housing and box paths, two labels to one variant, A→B while A is open for review, unpair, retired/broken, provider outage, stale/out-of-order events and namespace collisions. Old A/unassigned/retired must never Add; ambiguous mappings must never select the first result.
5. Separately test Shelva POS Quick Actions Find Label and the standard POS cart scanner. Native customer support does not install POS behavior. Any additional POS resolver/extension is separate work; no POS source was changed.

## Evidence locations

- Shopify read snapshots: current chat `work/barcode-matching/{admin-before,storefront-before,baseline-live}.json`; duplicate query verified six results with complete pagination. Additional read: `work/esl-scan/metafield-evidence.json`.
- Shelva authenticated browser views: Products `/app/products`, Prizm Configure `/app/products/configure/variant/64521944891761`, Hardware `/app/hardware`, Settings `/app/settings`, scoped to the current Northside store. Browser observations contain no reusable API contract. No browser auth query strings were retained in this report.
- Root/reviewer test logs and frozen-file hashes: current chat `work/esl-scan/`. Signed IPA and sanitized build records: companion `outputs/iphone-preview-9/`.
- Existing safeguards: `packages/customer-contracts/src/native-scan.ts`, `apps/customer/lib/server/mobile/{approved-native-catalog,shopping,storefront-cart}.ts`, `apps/customer/supabase/migrations/202609120008_store.sql`.
