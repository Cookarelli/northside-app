# Customer barcode scanner repair — November 13, 2026

Implemented locally on `codex/barcode-scanner-20261113`, based on
`b7e678c7435427d65ba8fbeaf8c9cd6cc3adbee3`. The delivered handoff records the final
commit hash. Repository: `Cookarelli/northside-app`, checkout
`/Users/northside/Documents/Codex/2026-10-30/northside-app-website-design-parity-phase/work/northside-home`.

**Software verification: PASS. Physical iPhone acceptance: NOT TESTED.** No remote
push, deployment, cloud build, app submission, product/stock write or live cart
mutation was performed. Independent QR matching, download links, label generation,
POS, consignment and grading were preserved.

## Root cause and evidence

1. Commit `77e135a9d7616e77c0f78107a0a71094dd2c8b6c` (November 12) introduced
   `scanMode = "shelf"`. It configured the native decoder for **QR only** on entry
   and also rejected ordinary barcode events in JavaScript. A customer opening
   Scan therefore could not scan a product barcode without choosing another mode.
2. Both Scan/Cart and mode controls used `storefrontUi.row`, which supplies a gap
   without `flexDirection: "row"`. Four vertically stacked controls consumed the
   visible space above the camera. The old preview height used overall window
   height without subtracting the actual header, safe area, tab bar and content.
3. The AppState listener stopped the camera when inactive but never resumed it.
   The focus effect did not rerun on foreground transitions. Backgrounding during
   scanning, an inactive launch, or a native permission dialog could leave the
   focused Scan tab paused after permission was granted.
4. A separate lookup defect indexed both Shopify variant `barcode` and `sku` as
   scan identities. It could accept an unrelated SKU or report false ambiguity
   when a SKU equaled another variant's barcode. This was not evidence of a native
   decoder failure; it was an unsafe lookup fallback corrected within this fix.

Before changing implementation, two new regression tests failed against the
original source: barcode scanning immediately on entry and camera restart after
background/foreground. Their baseline output is retained in the delivered
`scanner-evidence/baseline.log`. The final suite passes both tests. Review also
found and resolved a readiness-timeout race and a short-viewport sizing edge case.

## Final behavior

| Feature | Status | Implementation / limit |
|---|---|---|
| Barcode-only customer Scan tab | PASS | No Barcode/QR selector; QR and Code 39 camera events are ignored. |
| Camera as primary content | PASS automated; NOT TESTED device | Compact heading, horizontal Scan/Cart controls, measured viewport and camera offset; preview capped to available space, maximum 420 points. Layout model covers portrait iPhone sizes and short windows. Actual native layout still requires QA. |
| Automatic camera initialization | PASS automated | Focus and foreground start the camera after a fresh permission check. Native camera unmounts on blur/background. |
| Intent preservation | PASS | Foreground return resumes an active scanner, while explicit pause, manual entry, cart and product review stay paused. Tab focus or explicit Scan/Next intentionally rearms it. |
| Permissions and lifecycle races | PASS automated | Undetermined request, denial/settings recovery, pending grants, inactive launch, stale callbacks and identity/API changes are covered. |
| Retail formats | PASS automated | UPC-A, UPC-E, EAN-13, EAN-8 and Code 128 only on this camera. Autofocus enabled. Device decoding/close focus is NOT TESTED. |
| Exact variant barcode matching | PASS automated + live reads | Shared matching indexes barcode only. Client independently requires exactly one returned variant barcode matching the decoded candidates, and agrees with any declared selection. |
| UPC/EAN normalization | PASS | Checksummed, decoder-proven UPC-A/EAN-13 equivalents and UPC-E expansion; Code 128 leading zeroes stay literal. No inferred SKU mapping. |
| Duplicate scans and Add confirmation | PASS automated | Synchronous busy/readiness/intent/generation fences permit one lookup, pause scanning during lookup/review and reject stale events. Existing explicit Add action and cart mutation fence remain in place. Scan/Retry never adds automatically. |
| User states and recovery | PASS automated | Opening camera, ready, permission denial, camera failure/10-second readiness timeout, barcode detected, product found, not found and temporary network error. Accessible Retry camera / Retry barcode lookup actions. |
| Manual entry | PASS | Secondary control below the camera; accepts product barcode text and rejects QR URLs before a request. |
| Cart, availability and checkout | PASS regression tests | Existing cart code and checkout gates unchanged. Existing server availability/price checks still govern explicit Add. No live cart or payment acceptance claimed. |
| Independent QR workflows | PASS regression + live read | Shared QR matcher remains supported and tested; existing approved product QR resolves through the data adapter. Customer camera intentionally ignores QR. No POS/label code changed. |
| Physical reliability on labels/boxes | NOT TESTED | New binary, real iPhone and actual printed barcodes required. The reported 1.5/2.9/3.7-inch POS/ESL results do not prove this camera fix. |

## Files changed

| File | Purpose |
|---|---|
| `apps/mobile/src/app/(tabs)/scan.tsx` | Barcode-only UI, lifecycle recovery, readiness/retry states, barcode response proof and measured camera placement. |
| `apps/mobile/src/components/Screen.tsx` | Optional viewport layout callback and content-style override; existing screens retain their defaults. |
| `apps/mobile/src/shopping/barcode-scanner.ts` | Five-format policy and available-space preview sizing. |
| `apps/mobile/config/app.ts` | Barcode-only native camera permission copy; no additional permission. |
| `packages/customer-contracts/src/native-scan.ts` | Barcode-only matching and checksummed UPC/EAN equivalents; QR branches unchanged. |
| `apps/mobile/src/api/public-catalog.ts` | Update barcode-collision comment to match shared behavior. |
| `apps/customer/lib/server/mobile/approved-native-catalog.ts` | Update barcode-identity comment; server uses the shared matcher. |
| `apps/mobile/scripts/check-native-scan.ts` | Live read check validates actual variant barcodes rather than assuming SKUs are barcodes. |
| `apps/mobile/tests/mvp.test.tsx` | Entry/focus, AppState, permissions, readiness timeout race, formats, response proof, duplicates, errors and preserved explicit cart behavior. |
| `apps/mobile/tests/barcode-scanner.test.tsx` | Format policy and viewport sizing tests. |
| `apps/mobile/tests/config.test.tsx` | Permission copy expectation. |
| `apps/mobile/tests/navigation.test.tsx` | Scan heading expectation. |
| `apps/mobile/tests/public-catalog.test.tsx` | Barcode/SKU separation, quarantine behavior and retained QR checks. |
| `apps/mobile/tests/scan-cart.test.tsx` | Barcode-only lookup expectations; retained independent QR/cart coverage. |
| `packages/customer-contracts/src/native-scan.test.ts` | SKU rejection, true barcode ambiguity, UPC/EAN equivalents and literal Code 128. |
| `apps/customer/tests/approved-native-catalog.test.ts` | Server barcode-only matching and SKU-collision regression. |
| `apps/customer/docs/STATUS.md` | Current repair evidence and remaining device/release acceptance. |
| `docs/qa/NORTHSIDE-BARCODE-SCANNER-2026-11-13.md` | This handoff and QA procedure. |

## Automated verification

All checks used existing pinned dependencies and a scrubbed process environment.
No secret files were sourced. Direct local binaries were used to avoid package
installation/preflight changes.

- Full mobile Jest: **294 passed, 20 suites**, independently rerun with the same result.
- Mobile, root and customer TypeScript: **PASS**, no diagnostics.
- Mobile and customer ESLint: **PASS**, no warnings. Standard root ESLint: **PASS**,
  with one existing unused `_` warning in `packages/agent-runtime/src/control.ts:25`.
- Root Vitest: **299/300 passed** in the first full run. The only failure was
  `listen EPERM 127.0.0.1` in the simulated worker-service test; approved local
  rerun passed **8/8**, covering the failed case. All 300 cases passed across the
  runs; the first full invocation itself exited 1. Shared scan contracts: **37/37**.
- Focused customer approved-native-catalog tests: **4/4**. Full customer suite:
  **431/431**, plus **21/21** script tests. The first concurrent suite hit a native
  V8/WASM crash in consignment before assertions; a focused **12/12** rerun and
  full serial **431/431** run passed without source changes.
- Customer Next.js production build: **PASS** in a disposable snapshot containing
  zero `.env` files. The original dirty `next-env.d.ts` hash remained unchanged.
- Local Expo/Hermes export: **PASS iOS and Android**. iOS used existing preview
  configuration; Android used unconfigured development configuration. These are
  bundle checks, not signed IPA/APK builds or Android account/configuration proof.
- iOS preview configuration preflight: **PASS**; no EAS build started.
- Fresh public Shopify read validation at **2026-11-13 15:47:40 UTC**: all **7 approved
  product/variant barcodes**, one iOS EAN alias and one independent product QR
  resolved correctly. **Zero cart or inventory mutations.** Golf still has no
  image in that public projection; listing content is outside this repair.
- `git diff --check`: **PASS**.

Reproduce with Node 24 and the pinned installed dependencies:

```sh
# apps/mobile
pnpm typecheck
pnpm test
pnpm exec tsx scripts/check-build.ts preview ios
pnpm check:scan:live  # Public reads only; requires network access.
pnpm bundle:ios
pnpm bundle:android

# Repository root
pnpm exec eslint apps/mobile/src apps/mobile/config apps/mobile/scripts apps/mobile/tests
pnpm exec vitest run packages/customer-contracts/src/native-scan.test.ts

# apps/customer
pnpm typecheck
pnpm lint
node --conditions=react-server --import tsx --test tests/approved-native-catalog.test.ts
```

The local exports used `EXPO_NO_DOTENV=1`, `EXPO_OFFLINE=1` and
`EXPO_NO_TELEMETRY=1`. Do not treat unconfigured default exports as a connected
release. Full root/customer checks and their precise outcomes are included in
the delivered log bundle.

## Required build / deployment steps

1. Review this commit and allocate a fresh internal preview build number. Source
   still specifies existing preview build **6**; it was not silently turned into
   a release. Keep the approved preview identity, signing and API origin.
2. After build authorization, produce a new iOS internal preview artifact using
   the existing `preview` EAS profile and install it on the registered iPhone.
   `updates.enabled` is false, so the currently installed build cannot receive
   this change via OTA. The permission-copy change also belongs in the new native
   binary. No dependency upgrade, SQL migration or new environment variable is
   required.
3. Run the physical checklist below against that artifact. Do not mark build 6
   or an older installed app as verification of this source.
4. The existing barcode flow remains compatible with the current backend. A
   separately authorized backend release is needed to apply the shared matcher’s
   SKU rejection on the server too. Prepare/test that release without changing
   public gates, checkout or production routing.
5. Android bundle compilation passed, but a configured signed Android build and
   physical Android test remain separate. Joey’s Play verification documents are
   still an external store-publication hold; this work did not submit either app.

Expo documents the supported camera formats, autofocus and requirement to unmount
the camera on unfocused screens: [Expo Camera SDK documentation](https://docs.expo.dev/versions/latest/sdk/camera/).

## Exact physical iPhone QA

Use the newly authorized internal artifact from this commit, on iPhone 14 plus a
small supported iPhone if available. Record model, iOS version, build number,
permission state, barcode format/value, expected product, outcome and scan time.
Use a preview test session for explicit cart checks; scanning itself is read-only.

1. **First permission grant:** launch fresh, select Scan, grant camera access.
   Expect a barcode-only heading, one horizontal Scan/Cart row and the camera
   visible without scrolling. No mode selector. Opening camera changes to Ready;
   a system permission transition must not strand the view paused. No item added.
2. **Already granted focus:** switch Home → Scan five times. Each time the camera
   starts automatically, with no extra permission prompt. Switch away while it
   starts; no hidden camera should remain active. Return and verify recovery.
3. **Permission denial:** deny on a fresh install. Expect Allow camera / Open camera
   settings and manual entry. Grant permission in iOS Settings and return: the
   focused scanner should open. With denial retained, manual lookup still works.
4. **Viewport and accessibility:** inspect portrait before scrolling at normal and
   larger text sizes. Check the preview, hint, tabs and bottom navigation do not
   overlap. Rotate, return to portrait and check again. Confirm Retry controls can
   be reached with VoiceOver. Extremely enlarged text/short landscape windows need
   usability inspection; geometry tests alone cannot establish native acceptance.
5. **Real approved product boxes:** scan the manufacturer barcode on each item in
   the table below. Expect the named product and correct barcode, current price,
   image/placeholder and availability. No cart entry until explicit Add. iOS may
   report a UPC-A as a 13-digit EAN with a leading zero, or a normalized 12-digit
   value retaining the EAN type; both must select the same variant.

   | Product | Actual barcode | Shopify variant suffix |
   |---|---|---|
   | Prizm Hanger | `746134150968` | `64521944891761` |
   | Phoenix Mega | `746134172663` | `64521945022833` |
   | Select Hanger | `746134170294` | `64521945121137` |
   | Phoenix Blaster | `746134158551` | `64521956622705` |
   | Prizm Monopoly | `195166245478` | `64521956655473` |
   | Prizm Mega | `746134151026` | `68224325419377` |
   | Allure Golf Hobby | `053334437622` | `64522039460209` |

6. **All five physical formats:** test printed UPC-A `036000291452`, UPC-E
   `04252614`, EAN-13 `0036000291452`, EAN-8 `96385074`, and Code 128 `BOX-001`
   using valid printed symbols, good lighting and a normal camera distance.
   These are synthetic lookup fixtures, not products to create in Shopify. On the
   connected seven-item catalog, **Product not found is the expected result** for
   these values: it confirms detection reached lookup. A positive match for those
   fixtures is only expected in the existing local test harness. Record any
   failure to detect separately from a successful decode with no approved match.
7. **Duplicate/stale frames:** hold one real box barcode steady, then move rapidly
   between two codes. Expect one product review, no repeated requests/result
   flicker, no cart addition. Choose Scan next item to intentionally rearm. Switch
   tabs mid-read and confirm the old result cannot overwrite the new screen.
8. **Explicit cart behavior:** in the preview test session, scan a real approved
   item, tap Add once, verify quantity 1. Choose Add one more intentionally and
   verify quantity 2, then decrease/remove. Check unavailable stock still blocks
   Add/increase, refresh preserves server totals, close/reopen restores the cart,
   and existing checkout restrictions remain unchanged. Never infer paid stock
   movement from an unpaid preview cart.
9. **App lifecycle:** while Ready, background/foreground and lock/unlock the phone:
   camera should resume automatically. Repeat after Pause camera, while manual
   entry is open, in Cart, and on product review: it should respect that intent
   and remain paused. Hide manual entry or choose Scan/Next to resume explicitly.
10. **Network and unknown product:** go offline, scan a real approved barcode,
    expect a clear connection error and Retry barcode lookup. Reconnect and retry:
    expect one review, no Add. Scan a real unapproved product: expect Product not
    found, never a guessed SKU match. Enter Golf SKU `92840090001065` manually:
    it must not substitute for actual Golf barcode `053334437622`.
11. **Camera failure recovery:** if the OS camera cannot start, expect Camera
    unavailable with Retry camera within ten seconds. Retry after releasing the
    resource. A camera that has already reported Ready must not time out later.
12. **QR isolation:** aim this Scan tab at a product-label QR, a download QR and any
    1.5/2.9/3.7-inch ESL QR: the customer camera must ignore them. Verify download
    links with the system camera and other independent QR paths using their
    existing workflow. Do not reinterpret a label's hardware identifier as a
    product barcode or change POS/ESL configuration for this test.

Physical results, signed native build acceptance and production deployment are
**NOT TESTED / NOT PERFORMED** by this implementation session.

## Subsequent authorized internal build — November 13

The owner subsequently authorized a new internal iPhone preview. **Build 7 is
FINISHED and independently signed-artifact verified**. This completes the internal
build step above; physical iPhone acceptance remains NOT TESTED.

- [Install Northside Preview 0.1.0 (7)](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/1df57b56-f762-41ef-9f41-02b82f6af1ac).
- Build source: `a93ee610445cf725ca0043123dadc03c973fdd4d`, containing the scanner
  fix plus build-number 6 → 7 only. Configuration preflight and 51 focused tests
  passed; all 116 upload files match committed mobile/shared source exactly.
- Signed IPA SHA256:
  `103c94a4ac5d7099fe8071f69d5a7c59815631d8b2d9c2f721bfbd38dee535d0`.
- Existing approved certificate/profile and registered iPhone coverage verified.
  Actual compiled five-format scanner, barcode-only lookup, lifecycle/retry code,
  removal of the QR selector and seven catalog identities verified. Existing
  preview API and disabled OTA configuration retained.
- No production/backend deployment or App Store submission. No live commerce writes.

Open the install link on the registered iPhone, install over the current preview,
and execute the physical checklist above with manufacturer product-box barcodes.
