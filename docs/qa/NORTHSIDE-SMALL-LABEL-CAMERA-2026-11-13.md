# Small-label iPhone camera changes — November 13, 2026

Implementation commit: `ccb21395d59177b582fc5e775e28325d066e82dd`.
Repository: `Cookarelli/northside-app`, branch `codex/barcode-scanner-20261113`.
Software checks PASS; physical focus, readability and scan latency remain **NOT TESTED**.
The supplied iPhone screenshot is observation evidence, not a measured focus/lens test.

[Install Northside Preview 0.1.0 (8)](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/e44cb84e-0e93-4a94-b8fa-b254e159ff8c).
The internal native build FINISHED at 2026-11-13 17:11:34 UTC. Independent signed-IPA
verification passed, including the actual native bridge in the ARM64 executable,
same approved signing/profile/registered iPhone, compiled 1/1.5/2 controls and
seven catalog identities. SHA256:
`3b5e4fd9d582541d2e312f55d712e20bd337775835917b96912ccd347bcc7660`.
This establishes compilation and artifact contents, not physical camera performance.

**Confirmed root cause and limits.** The prior repair set `autofocus="on"`.
In installed `expo-camera 58.0.14`, that means single autofocus followed by a lock;
`"off"` maps to continuous autofocus. Changing the label distance could therefore
leave focus locked at the previous distance. This was a mistake in the previous
implementation. It is corrected to continuous autofocus, with native preparation
also applying continuous focus and exposure when the active device supports them.

The screenshot/report does not prove a defective label, an ultrawide lens in use,
the device's minimum focus distance, or decoder failure. At a distance a small
barcode may occupy too few capture pixels; closer placement may be outside the
lens's usable focus range. Physical comparisons are required to establish those
remaining causes. The previous Photo preset was not evidence of low resolution.

**Installed stack.** Expo `58.0.24`, Expo Camera `58.0.14`, React Native `0.88.1`.
No camera library or dependency version was upgraded. The existing CameraView,
permission flow, barcode-only selection, lookup, duplicate guards and explicit
cart confirmation remain in use.

| Capability | Implementation / honest limit |
|---|---|
| Rear camera / lens | Runtime `getAvailableLensesAsync()` must actually offer the physical wide/main rear lens before it is selected. Otherwise Expo's automatic rear selection remains. A lens change remounts capture and fences old events. |
| Autofocus / exposure | SDK `autofocus="off"` means continuous AF. The explicit native preparation uses AVFoundation continuous AF/AE under the active view's session queue and device lock, only when supported. Session readiness does not prove sharp focus. |
| Capture preset | Supported `pictureSize="1920x1080"` requests a bounded HD capture session on iOS. Expo can fall back to High. Native capabilities return actual active-format dimensions; these are not a claim about the metadata decoder's internal resolution. This is a conservative latency/detail baseline requiring physical evaluation. `videoQuality` is not used as a picture-mode fix. |
| Zoom | Controls show 1×, 1.5× and 2×. They use the actual active camera's baseline, format maximum and currently permitted maximum. Unsupported choices are disabled. Default is conservative 1×; no physically optimal default is claimed. |
| Zoom units | Expo's iOS formula is `factor = min × (formatMax/min)^zoom`. The app uses `zoom = ln(relativeFactor) / ln(formatMax/min)`, with actual range checks. Fixed normalized values are not mislabeled as magnification. |
| Optical versus digital | The UI explicitly labels these controls Digital zoom. No optical 1.5×/2× claim is made. The physical main lens is preferred for the comfortable-distance trial; this sacrifices automatic macro/telephoto switching when that lens exists. A phone without that lens retains Expo's available automatic behavior. Digital zoom and a larger CSS preview do not manufacture optical detail. |
| Torch | Supported `enableTorch` is offered only when native hardware reports availability, starts off and resets when capture unmounts. Guidance warns about ESL glare. |
| Tap focus | Not added: the installed inline camera exposes no iOS focus-point/tap-focus prop. No web-only or invented focus property is passed. |
| Decoder region | The old small blue rectangle was decorative. The new border follows the whole visible preview. Native `metadataOutputRectConverted(fromLayerRect:)` accounts for aspect-fill/orientation; its whole-visible-frame rectangle is applied to metadata output, including output created later. There is no arbitrary tiny center crop. |
| Bounds / automatic zoom | Expo bounds arrive only after successful decoding and may be empty. They cannot locate a still-undecoded barcode. Automatic zoom and misleading pre-detection boxes are not added. |
| Decoding and commerce | UPC-A, UPC-E, EAN-13, EAN-8 and Code128 retained. Leading zeroes, checksum aliases, exact Shopify variant-barcode proof, duplicate fences, Scan Next and explicit Add remain. SKU and ESL hardware identifiers are not inferred as product barcodes. |
| Other workflows | Independent QR, POS, label generation, consignment, grading, inventory and checkout are unchanged. No live commerce write was performed. |

**Native extension, explicitly distinguished from the stock SDK.** The public
Expo API does not expose the active device's zoom-factor range or inline iOS ROI.
A small, version-pinned config plugin adds the explicit
`ExpoCamera.northsidePrepareBarcodeCameraAsync(viewTag)` method. It looks up the
actual mounted camera, configures supported continuous AF/AE, sets the full visible
ROI and returns real capabilities. It does not add fictitious CameraView props.

The plugin validates exact original/patched hashes for four Expo Camera Swift
files, is idempotent, and patches only an isolated EAS worker or explicitly marked
scratch dependency copy. It rejects the shared frozen dependency installation used
by this checkout. Atomic replacement preserves package-store hard links.
`expo.autolinking.ios.buildFromSource: ["expo-camera"]` ensures a precompiled
framework cannot omit the extension. Any camera-library update requires this
narrow native extension to be reviewed again. A native binary is required; Expo Go
and build 7 do not contain this method. Manual entry remains available if preparation
fails; native failure details are not exposed to customers.

**UI and lifecycle.** Controls, exact requested guidance and status appear before
the measured camera frame, so their actual height is included when fitting the
preview above the tab bar. Controls wrap for accessibility text. The guide covers
the complete visible preview. No CSS zoom or crop is presented as capture detail.
Layout/orientation preparation immediately blocks frame acceptance; only the latest
setup can restore it. Lens changes, blur/background, manual entry, Cart, errors and
Scan Next retain stale-event and permission protections. Torch returns off and zoom
returns to baseline on a fresh capture mount.

**Files changed.**

| File | Purpose |
|---|---|
| `apps/mobile/src/shopping/BarcodeCamera.tsx` | Capture UI, continuous autofocus prop, runtime main-lens choice, readiness/setup fencing, calibrated zoom, torch and full-preview guide. |
| `apps/mobile/src/shopping/camera-capabilities.ts` | Explicit native bridge, validated active-camera data, logarithmic zoom conversion and range checks. |
| `apps/mobile/src/app/(tabs)/scan.tsx` | Integrate camera component; preserve parent permission/lifecycle/lookup/cart fences and manual fallback. |
| `apps/mobile/plugins/withNorthsideBarcodeCamera.cjs` | Exact-version native capability/continuous AF+AE/visible-ROI extension with isolated-source guards. |
| `apps/mobile/package.json` | ExpoCamera-only source-build opt-in and native-plugin test command; no dependency change. |
| `apps/mobile/config/app.ts` | Register plugin and prepare internal build 8. |
| `apps/mobile/tests/camera-capabilities.test.tsx` | Actual/virtual range math, unsupported targets, malformed data and missing native bridge/view. |
| `apps/mobile/tests/mvp.test.tsx` | Focus/preset/zoom/torch props, runtime lens switch, stale callbacks, unsupported controls, preparation failure/retry and overlapping layout tests; existing commerce cases retained. |
| `apps/mobile/tests/barcode-scanner.test.tsx` | Available-space arithmetic including controls/guidance. Native Yoga/device layout still needs physical inspection. |
| `apps/mobile/scripts/camera-native-plugin.test.cjs` | Exact-source, idempotence, isolation, drift and Swift syntax checks. |

**Checks performed.** Independent full mobile Jest: **319/319, 21 suites**.
Mobile TypeScript and scoped ESLint: **PASS**, no warnings. Native-plugin tests:
**10/10**, including syntax parsing of the four patched Swift files. Source upload:
**121 files**, independently byte-for-byte matched to the commit; no private env,
credentials, caches or unrelated local changes. Swift syntax parsing is not an iOS
SDK compile or a physical-device test. The internal build receipt and signed-IPA
checks are recorded in the delivered build evidence after completion.
Actual iOS compilation/linking and signed-artifact checks subsequently **PASSED**.
A local Android Hermes export also passed; signed Android/native zoom acceptance
is outside this iPhone release.

The release tree does not enable React StrictMode. An early-ready effect-replay
edge under development-only StrictMode was not reproduced or claimed verified.
Actual iPhone lens choice, bridge execution, magnification, focus/exposure, torch,
ROI alignment, decoding latency and ESL readability remain **NOT TESTED** here.

**Install and rebuild.** Use the newly completed internal preview 8 install link
in the delivered handoff. Install over the existing Northside Preview on the
registered iPhone. No App Store submission or production/backend deployment is
part of this change. OTA remains disabled; build 7 cannot receive the extension.
For a future authorized rebuild, keep this source, `preview` profile and existing
company identity/API/signing, run `pnpm build:check preview ios`, then use pinned
EAS CLI `27.4.1` with `build --platform ios --profile preview --non-interactive
--freeze-credentials`. Do not use automatic submission. Allocate a fresh build
number for a subsequent artifact. Native patching requires worker-local dependencies;
do not run prebuild against this checkout's shared dependency links.

**Exact physical iPhone acceptance steps.**

1. Install preview **8** and record model/iOS/build. Open Scan. Confirm camera opens
   automatically, controls are above the tab bar without scrolling, 1× is selected,
   torch is off and the complete barcode can fit inside the visible guide. Check
   portrait, larger text and rotation. A blocked capability/permission state must
   offer retry/manual recovery rather than a false Ready state.
2. Use the **same small ESL label** for every comparison. Also test the larger ESL
   sizes (including the reported 2.9-inch and 3.7-inch labels) and a product-box UPC.
   Verify the label's intended encoded value against the actual Shopify variant
   **barcode** field first. An ESL hardware identifier or independent QR target is
   not an approved barcode mapping. Do not create or change a product for this test.
3. Measure approximately **8, 12 and 16 inches** from the lens to the label. At each
   distance, test **1×, 1.5× and 2×**, keeping all bars and quiet zones visible.
   Hold steady for up to five seconds. Record preview sharpness, detection time,
   decoded/not-detected, product found/not-found and expected versus actual variant.
   Reuse this grid separately for each label/box:

   | Distance | 1× | 1.5× | 2× |
   |---|---|---|---|
   | 8 inches | sharpness / time / match | sharpness / time / match | sharpness / time / match |
   | 12 inches | sharpness / time / match | sharpness / time / match | sharpness / time / match |
   | 16 inches | sharpness / time / match | sharpness / time / match | sharpness / time / match |

4. Move near → far → near while scanning. Confirm it refocuses instead of remaining
   locked. If close placement is blurry, move back and try 2×. Compare the actual
   barcode lines, not enlarged UI size. No optical-resolution improvement is assumed.
5. Repeat troublesome ESL cases with torch on and off, and reduce direct glare by
   changing the angle slightly. Confirm torch turns off when leaving Scan, choosing
   manual entry, opening Cart, backgrounding/locking or encountering camera failure.
   Return: baseline 1× and torch off, automatic startup preserved.
6. Confirm a known box barcode resolves correctly, for example Prizm Hanger
   `746134150968` or Golf `053334437622`. A sharp decoded ESL showing Product not
   found is a separate mapping/approval result, not proof of focus failure. Preserve
   leading zeroes. Do not substitute a SKU or shelf hardware code.
7. Hold the same barcode steady and rapidly alternate two boxes. Expect one lookup
   and review, zero automatic cart additions. Use Scan Next to rearm; repeat lens/
   layout transitions, tab switches and offline/retry. Only an explicit Add in the
   approved preview test session may modify its cart; existing stock/price/checkout
   gates remain authoritative.

Acceptance requires sharp, complete barcodes and correct matching at a comfortable
distance on the actual iPhone. A successful build alone does not establish it.

**Primary evidence:** installed `CameraEnums.swift` maps focus modes;
`CameraSessionManager.swift` implements zoom and presets; `CameraRecordingOptions.swift`
lists supported picture presets; `Common/DeviceDiscovery.swift` selects default rear
lenses; `Camera.types.ts` defines available props and post-decode bounds. Published
references: [Expo Camera SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/camera/),
[config-plugin native escape hatch](https://docs.expo.dev/config-plugins/dangerous-mods/),
[source-built Expo modules](https://docs.expo.dev/guides/prebuilt-expo-modules/).
