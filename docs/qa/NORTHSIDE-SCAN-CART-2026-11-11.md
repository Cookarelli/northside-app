# Northside Scan and Cart — November 11, 2026

## Release status

Latest: **Northside Preview 0.1.0 (4), FINISHED**. [Install build 4](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/d0737a8b-6d52-4f57-8977-ede2b340b8fc).
The downloaded IPA passed signing, registered-iPhone eligibility and compiled scanner checks.
During the build4 test, the owner confirms a successful app QR scan from a 2.9-inch ESL.
The 1.5-inch QR becomes blurry close up and remains unsuitable in this test.
Owner confirms cart quantity 1 → 2 → 1 and that the same item remains quantity1 after closing/reopening.
Owner also confirms a connection error offline and restoration to quantity1 after reconnecting.
Removal, multi-product cart, box-barcode and all-six physical acceptance remain pending.

**LARGER-TAG QR, CART QUANTITY, CLOSE/REOPEN AND OFFLINE RECOVERY CONFIRMED; MULTI-ITEM/REMOVAL PENDING.**

The existing Expo app resolves approved real box barcodes/SKUs and product QR
labels. Scan/Cart switching sits inside the existing Scan screen; the five bottom
navigation items, branding and colors are preserved. The existing cart UI now
supports a server-owned Shopify Storefront Cart, secure opaque-handle persistence,
canonical totals, refresh, quantity edits and unavailable-item removal.
Checkout and POS handoff are disabled for Shopify carts.

The authorized API-only Preview is deployed and verified through both protected
operator access and anonymous native access. The connected iOS preview
**0.1.0 (3)** FINISHED as `f5d9757d-2d7c-4a62-a24c-e40ae5fec0cf` at
22:50 UTC (4:50 PM Central). Its downloaded IPA passed configuration/signing/device
verification. The owner confirms installation on iPhone 14 and successful manual Prizm Hanger and Monopoly lookups on November 12. Physical QR, product-box barcode, cart quantity and restart tests remain pending. The earlier build
`64c2ed80-1590-482a-a571-1d5281ceceae` is catalog-only.

## Source

- Repository: `Cookarelli/northside-app`.
- Native directory: `/Users/northside/Documents/Codex/2026-10-30/northside-app-website-design-parity-phase/work/northside-home/apps/mobile`.
- Existing backend: same repository, `apps/customer`.
- Branch: `codex/ios-preview-prerequisites-20261111`.
- Native/shared source checkpoint: `ef946a735cc8f022279a410d3b050494d91017d7`.
  Only the reviewed native/shared changes were committed. Unrelated edits and
  untracked backend foundation files were preserved; no push or merge.
- Backend deployed snapshot: 614 regular files, aggregate SHA-256
  `041f3812d82a5aa8de60e3b074387583faaeef4a997987b71143c060df43028c`.
  It preserves the existing backend working tree rather than claiming all older
  untracked foundation work is in the native checkpoint.
- Expo: `@northside-collectibles/northside-customer`, project
  `ecfde92e-a01e-4158-b0ce-13908afa39ab`.
- Existing iOS identity: team `NF42JBZCBW`, bundle
  `com.northsidecollectibles.customer.preview`. Signing was not changed.

## Status matrix

| Area | Status | Evidence / remaining action |
|---|---|---|
| Camera lifecycle, permissions, manual fallback | VERIFIED AUTOMATED | Existing denial/background/blur/result and duplicate-frame regressions pass. Physical camera tests pending. |
| Six real barcodes and SKUs | VERIFIED LIVE READS | Actual native adapter resolves all six to exact Shopify variant IDs; images present. |
| iOS UPC-A as EAN-13 | VERIFIED LIVE + AUTOMATED | Checksum-proved leading-zero alias; arbitrary stripping refused. |
| UPC-E, EAN-8, Code 128, Code 39 | VERIFIED AUTOMATED | UPC-E expansion, GTIN checksums, exact SKU matching and ambiguity rejection. Device decoder performance pending. |
| Approved product QR labels | VERIFIED LIVE + AUTOMATED; PARTIAL DEVICE PASS | Owner confirms app QR scanning works from a 2.9-inch ESL. 1.5-inch ESL remains blocked by close-focus/readability. Full six-product device coverage pending; no arbitrary URL fetch/navigation. |
| Opaque `/q/{token}` labels | NOT VERIFIED HOSTED | Fixed-backend fallback preserves existing registry/origin/approved-retail checks. Five approved ESL links are product URLs; Monopoly uses exact `/m`. No opaque mappings invented. |
| Shopify Cart create/add/update/remove | VERIFIED LIVE + AUTOMATED; PARTIAL DEVICE PASS | Owner confirms one item added and quantity1→2→1. Physical removal/multi-item checks pending; service add/update/remove previously passed. |
| Retail Floor limits | VERIFIED LIVE SERVER PATH + TESTS | Actual server Admin inventory checks authorized before Add/quantity changes; exact Floor `121087263089`, no backstock aggregation. |
| Persistence | VERIFIED OWNER CLOSE/REOPEN + AUTOMATED/LIVE | Owner confirms the same item remains quantity1 after closing/reopening on iPhone. Exact termination method and product not restated. Owner also confirms offline connection error and quantity1 restoration after reconnecting. Longer-session and hosted-restart coverage remain pending. |
| Prices, totals, unavailable items | VERIFIED AUTOMATED | Canonical discounted line/subtotal/estimated total preserved; unavailable and withdrawn items removable. |
| Duplicate/uncertain writes | VERIFIED AUTOMATED | Busy latch, revision checks, durable pending fence and canonical reconciliation; no automatic Add replay. |
| Checkout/POS | DISABLED | No checkout URL, order/payment operation or counter handoff in Shopify cart mode. |
| Native API ingress | VERIFIED PUBLIC | Only the dedicated API alias is exempted; exact Scan/Cart POSTs succeed, non-API routes404. Project SSO remains enabled for all deployments. |
| Updated signed build / iPhone acceptance | BUILD4; PARTIAL DEVICE PASS | Build4 signature, registered iPhone coverage and compiled modes verified. Owner confirms 2.9-inch ESL QR read, cart1→2→1 and close/reopen quantity1. Owner confirms offline/reconnect quantity1 recovery. Multi-product/removal, product-box UPC and all-six scan acceptance pending. |

## Implementation and boundaries

Six approved product/variant/UPC/handle identities now share one portable scope
in `packages/customer-contracts/src/native-scan.ts`. Display data and availability
still come from fresh published Storefront reads. Exact observed SKU/barcode Maps
reject collisions instead of choosing a product. Privileged Admin lookup is not
needed for this bounded public selection; future larger selections can use the
existing server registry. Unknown/unapproved products are not silently added.

Camera formats: QR, UPC-A/UPC-E, EAN-13/EAN-8, Code 128 and Code 39. Aliases require
decoder/checksum proof. Foreign URLs, credentials, fragments, extra QR parameters
and wrong variants fail safely. The seventh Donruss Optic remains out of stock
per the owner and excluded; similarly named drafts are not substitutes.

The phone persists only a random Northside handle in SecureStore, scoped to
preview variant, commerce origin and principal, using
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`. No Shopify cart key, raw line ID, cart contents,
old prices or customer/provider secret is stored there. Restart restores the
handle, then fetches the canonical cart; offline restoration hides old values.

The backend encrypts the full Shopify Cart ID in the existing durable `commerce`
aggregate. It checks tenant/owner on every operation, binds guests before provider
work, expires handles after seven days and bounds capacity. There is no new SQL
migration or role widening; hosted storage refuses a filesystem fallback.

Add validates the exact scanned variant and reviewed price, current publication,
Retail Floor stock and Shopify online stock. Quantity increases revalidate stock;
removal remains possible when an approved item is unavailable or withdrawn.
Floor proof uses only `121087263089`, never breaker/excess totals. Raw location
levels are not exposed to the phone.

A pending-operation fence commits before remote work and is rechecked immediately
before each actual provider mutation. Stale/duplicate revisions cannot write.
Warnings/timeouts can mean a write applied: the durable fence survives restart,
blocks another write and permits canonical read reconciliation after 90 seconds.
The client never retries Add automatically. One-minute observation expiry hides
stale prices without releasing the busy guard during a pending write.

Shopify's line amounts, subtotal and estimated total remain authoritative,
including discounts. They are not forced to equal unit price times quantity.
Public projections contain no full cart key, raw line ID, buyer details, internal
stock levels or checkout URL. `commerceApiOrigin` is separate from `apiOrigin`,
so enabling guest cart transport does not activate Account, wallet or tracking.

Sources: [Shopify Cart management](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage),
[Cart warnings](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/cart-warnings),
[pinned Storefront API](https://shopify.dev/docs/api/storefront/2026-07).

## Files changed

| Files | Purpose |
|---|---|
| Shared `native-scan.ts`, `shopping.ts` | Approved identities, indexed matching, canonical Shopify cost/freshness DTOs; legacy private fields remain rejected. |
| Mobile public catalog adapter | Real scans and fixed-backend fallback for registry QR. |
| Mobile shopping native/controller/Provider | Device-only opaque handle, restoration, freshness and failure handling. |
| Scan, ScanProduct, CartView, messages | Scan/Cart switching, SKU/barcode, quantities/removal/totals and disabled checkout. |
| Mobile config and MvpProvider | Explicit separate commerce origin; no customer-auth activation. |
| Server mobile approved-native-catalog/storefront-cart/gate | Fresh selection, server Floor proof, encrypted Cart persistence and durable mutation fencing. |
| Existing mobile HTTP/shopping handlers | Native-only staging mode; original web/list/public gates retained. |
| Customer proxy and native-api-ingress | Reserved API preview host accepts only two POST paths; all website/checkout/staff/auth/assets blocked. Activated only for the authorized API alias. |
| New native/shared/server tests and check-native-scan script | Reproducible matching, quantities, duplicates, persistence, API errors, ownership, scope and routing checks. |

## Tests and reproduction

Use Node **24.x** and existing pinned dependencies. In `apps/mobile`:

```sh
pnpm typecheck
pnpm test
pnpm check:scan:live
```

The live check performs public reads only: six barcodes, six SKUs, an iOS EAN
alias and an approved product QR. It never creates a cart or changes stock.

From the repository root:

```sh
pnpm exec vitest run packages/customer-contracts/src/native-scan.test.ts packages/customer-contracts/src/shopping.test.ts packages/customer-contracts/src/catalog.test.ts packages/customer-contracts/src/catalog-query.test.ts
```

In `apps/customer`:

```sh
node --conditions=react-server --import tsx --test tests/native-storefront-cart.test.ts tests/native-retail-stock.test.ts tests/native-api-ingress.test.ts tests/mobile-shopping.test.ts tests/scan-cart.test.ts tests/shopping-cart.test.ts
pnpm typecheck
```

Results:

- Independent native Jest: **257 passed, 19 suites**, no failures/skips.
- Independent shared contracts: **152 passed, four files**.
- Independent focused server run: **121 passed, one pre-existing failure**.
  `checkout-test.test.ts:260` expects blanket `purchases_disabled`; the approved
  six-product exception reaches missing fixture configuration
  `shopify_shop_not_configured`. This same failure predates this task. It was not
  hidden or changed to make the run green.
- Additional API-host ingress suite: **4 passed**.
- Root/customer/native TypeScript and changed-file ESLint pass.
- New Storefront and Admin queries validate against `2026-07`; actual installed
  runtime inventory scopes still need verification.
- Isolated customer production Webpack build passes without provider secrets.
- Local production HTTP: API-host website/shop/staff/checkout/auth/assets **404**;
  only exact scan/shopping POSTs reach bounded JSON validation (**400** for
  deliberately malformed JSON). No provider or cart request was made by that check.
- Production iOS JS/Hermes export passes: **1,517 modules**, approximately **4.2 MB**.
- Live public barcode/SKU/QR reads pass. Actual server scan and anonymous Cart
  add/change/read/remove checks also pass. The strict hosted Postgres adapter
  accepted persistence; no filesystem fallback is allowed on Vercel.
- Actual native `MobileApi` and `ShoppingController` also passed against the live
  public backend: scan, Add, quantity change, controller restart/restoration and
  removal. This used an in-memory handle adapter; it does not prove device SecureStore.
- Final connected config rerun: **257/257 native tests** and native TypeScript pass.
- Cloud build: **FINISHED**, Expo Doctor **20/20**, Xcode archive/export succeeded.
  IPA verified team `NF42JBZCBW`, bundle `com.northsidecollectibles.customer.preview`,
  build3, minimum iOS16.4, registered iPhone inclusion, and reused approved signing.
  Live catalog/Scan/Cart and the correct commerce origin are bundled. Unrelated
  customer services and OTA updates remain disabled. No new credentials/profile.
- Physical camera, SecureStore restart and phone behavior remain **NOT VERIFIED**.

Independent review found and fixed Add preflight revision invalidation, stale
lease dispatch and post-mutation scope validation. Regression tests cover each.
Unit/local provider responses are explicitly synthetic; live API checks are
separately recorded. No order, reservation API,
inventory deduction, charge, price/publication/theme/production/signing change
was performed. Only the authorized new Vercel preview alias and its exception
were added; existing website/domain DNS was not changed.

## Authorized staging activation

The user explicitly authorized the API-only staging setup after reviewing the
proposal. Repository deployment-policy approval is satisfied for this hostname.

- Project: `northside-customer-pilot` / `prj_ew70zOV4frVoFmU5nfljsNDoxHbZ`.
- Team: `team_iPL9ti94DMgRhfyzvbgjzZdG`.
- New READY **Preview**: `dpl_4bCXDmiAqkGQtUnspuu5WebX3vNp`.
- Immutable protected Preview:
  `https://northside-customer-pilot-40trv6uj2-steves-projects-e37a4ef4.vercel.app`.
- Dedicated API origin:
  `https://northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app`.
- The alias was confirmed unassigned, then assigned to this reviewed candidate.
  Only its alias-protection override was created. Project Vercel Authentication
  still reads `enabled: true`, `deploymentType: all`.
- Original production still resolves to `dpl_GeU8U7LfUy5t8jx2SynG5WkgjyZQ`;
  it was not promoted, rebuilt or reassigned.

Preview branch `integration/supervised-store` now has
`NORTHSIDE_MOBILE_ENVIRONMENT=staging`,
`NORTHSIDE_MOBILE_SCAN_CART_APPROVED=true`, and
`NORTHSIDE_NATIVE_API_HOST` equal to the dedicated hostname. Existing server
credentials were reused without displaying values or granting new scopes.
The live Cart path succeeded through actual server-only inventory authorization
and the strict hosted persistent-store role checks.

Protected-candidate checks preceded the exception. They verified actual Host
routing and 404s for website/shop/staff/checkout/auth/static paths. All six scans
and one real anonymous Cart add/change/read/remove passed, leaving it empty.
After the exception, the same guest workflow passed without any Vercel token or
cookie. A second test cart was also left empty. No checkout, order, payment or
inventory-write operation was invoked.

The iOS preview profile now sets `MOBILE_NATIVE_SCAN_CART=true` and its separate
`MOBILE_PREVIEW_COMMERCE_API_ORIGIN` to this verified origin. `apiOrigin` remains
absent; unrelated customer services remain disconnected. Internal build 0.1.0(3)
uses the existing Expo project, Apple team, bundle and signing. It completed
successfully; the registered iPhone is eligible through its existing ad hoc
profile, which expires November 11, 2027.

Vercel exceptions affect future deployments assigned to that domain. Never
reassign this alias to an unreviewed build lacking the guard. The reserved host
fails closed if its host setting is absent. Rollback removes the alias exception
or detaches the API alias before restoring older code/configuration.
[Vercel exception behavior](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions).

Sanitized evidence is mirrored beside this report in `scan-cart-evidence/`:
live scanner reads, independent checks, production build/HTTP results, source
manifest, protected operator checks, anonymous live Cart checks, actual native
client/controller checks, final build result, IPA verification and client bundle
checks. The compiled bundle contains the shopping transport and no server
credential-header references.

## Installation

- Build: **FINISHED**, internal standalone iOS **0.1.0 (3)**.
- Build ID: `f5d9757d-2d7c-4a62-a24c-e40ae5fec0cf`.
- Source: `ef946a735cc8f022279a410d3b050494d91017d7`.
- [Expo installation page](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/f5d9757d-2d7c-4a62-a24c-e40ae5fec0cf).
- [IPA download](https://expo.dev/artifacts/eas/xybQXxF0wi-63rpncLnCAhNUZ-YYCdgn53yBM8dr6dI.ipa).

Open the Expo installation page in **Safari on the registered iPhone 14**.
Select **Install** for **0.1.0 (3)** and confirm the iOS prompt, then open
Northside Preview. This updates the existing preview bundle. No development
server is needed; OTA updates are disabled, so the old app does not update itself.

## iPhone 14 checklist — all pending

Use the updated signed standalone build after staging verification, without Metro
or a development server. Record build/iOS version and actual results. Do not alter
inventory to manufacture test states.

1. Allow camera and scan all six boxes. Verify image/title/SKU/exact variant,
   current retail price and availability against Shopify.
2. Scan each approved product QR; confirm the same variant as its barcode. Any
   opaque `/q/` label needs its approved server mapping verified separately.
3. Hold one code in view: one review, no automatic Add. Rapid double Add produces
   one change; deliberate “Add one more” increases quantity once.
4. Switch Scan/Cart. Verify quantities, canonical line amounts, subtotal/estimated
   total and unpaid status. Increase, decrease and remove items.
5. Request more than available Floor stock: safe error, no backstock substitution.
6. Force-quit/reopen: restore the same saved cart and re-read current prices/stock;
   empty restoration must not create duplicate carts.
7. Airplane mode before scan/refresh: connectivity error, hidden stale values,
   no samples and no queued automatic mutation replay.
8. Lost Add response: wait for reconciliation, refresh and confirm actual saved
   quantity before another explicit Add.
9. Deny/revoke camera permission; use manual barcode/SKU entry and Settings recovery.
   Background/foreground and rotate; camera stops/resumes safely.
10. Try unknown/Optic barcode, foreign URL and wrong-variant QR. No guessed match or
    cart change. Sold-out/withdrawn behavior is automated-tested; test physically
    only when a legitimate approved item has that state.
11. Return after more than a minute: expire/reload observations. Checkout remains
    unavailable; no order, POS handoff or charge.

## November 12 physical acceptance update

Owner confirms build3 installed on the iPhone14. The camera recognizes a barcode
or product QR, pauses, and displays the lookup error “We couldn’t find an approved
item for this code. Try again or ask an associate.” The pause is intentional;
the observed unresolved issue is the product-code match, not a proven camera fault.
The owner subsequently identified Monopoly and confirmed successful manual lookups of
UPC 746134150968 (Prizm Hanger, SKU P661462) and UPC 195166245478 (Monopoly,
SKU 6301946). Both failed camera attempts targeted the electronic shelf label;
the striped barcode was on that label rather than on the product box.

A read-only check of the actual scanner adapter from the Mac resolved EAN13
0746134150968 to the correct Prizm Hanger variant in507ms. This is service evidence,
not a physical-phone lookup pass. No cart or inventory writes were performed.
Physical product match, quantities and SecureStore restart acceptance remain pending.


## November 12 Monopoly shelf QR repair

**Repaired in the existing API-only Preview; no reinstall or new iOS build.**

The saved approved ESL manifest and physical QR review from November 10 identify
Monopoly's QR as `https://9i3hnb-jw.myshopify.com/m`. Build 3 accepted full product
URLs but rejected this short path, then its server fallback also failed to resolve
it. The shelf label's separate Code 128 is a hardware identifier (the saved label
was `8003147344`), not a merchandise barcode. The owner confirms the failed striped
scan was on the electronic shelf label. Actual product-box UPC camera acceptance
has not been claimed.

The shared matcher now permits only that exact short URL and resolves it against
fresh published data for product `15993234555249`, variant `64521956655473`,
handle `2023-24-prizm-monopoly-nba-blaster-box-regular` and UPC `195166245478`.
Queries, fragments, credentials, foreign origins and identity drift remain
rejected. It does not follow redirects or fetch a scanned URL. The same matcher
canonicalizes the code for server cart additions. No UI or branding changed.

- Code checkpoint: `0bcae4e3e21eb711bd7b82250fdeb96bbb67a79d` on existing branch
  `codex/ios-preview-prerequisites-20261111`; only matcher and regression test
  were committed. No push/merge or unrelated source changes.
- Shared tests: 162 passed across 4 files, including 26 scanner boundary tests.
  Native relevant catalog/scan/cart tests: 57 passed across 3 suites.
  Root and native TypeScript plus affected ESLint pass. Independent review passed.
- Latest API Preview: **READY**, `dpl_FWeo7t4wx7qSDkhCtrxUZ18oR2QM`.
  Immutable URL: `https://northside-customer-pilot-7u4ut32a2-steves-projects-e37a4ef4.vercel.app`.
- Dedicated existing API alias:
  `https://northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app`.
- Reviewed source snapshot: 614 files, SHA-256
  `82adb92f340b5eeaa6abcc55b30c2075c59395e06e69e5b61951e28ccb8ecbd1`.
  Exactly two file contents differ from the previous approved snapshot. CLI upload
  contains 611 matching files, omitting `.gitignore`, `apps/customer/.gitignore`
  and `apps/customer/.npmrc` under its existing ignore rules; no unexpected files
  or uploaded hash mismatches.
- Protected preview scan passed before final alias assignment. The original
  build 3 catalog, matcher and transport were extracted from exact commit
  `ef946a735cc8f022279a410d3b050494d91017d7` into ignored scratch files. Through
  anonymous native access, that client performs the existing unsupported-QR
  fallback, resolves `/m` to Monopoly, adds one, changes to two, reads two, then
  removes all test items. The unpaid test cart is empty. This is Mac/service
  compatibility evidence, not physical iPhone or SecureStore restart evidence.
- Guard verification: website, shop, staff, auth, checkout and static probe paths
  return 404 on the API alias. Project SSO remains enabled for all deployments.
  Production remains `dpl_GeU8U7LfUy5t8jx2SynG5WkgjyZQ`.
- No new signing material, IPA, production release, Shopify catalog/inventory
  mutation, order, charge or POS handoff was created.

Deployment issues encountered and corrected: the first CLI Preview built but
lacked branch-specific staging settings, so its API guard failed closed with 404.
The original alias was restored immediately. A connector attempt failed
`ERR_PNPM_NO_LOCKFILE` and was never assigned to the API alias. Automatic review
also rejected a retry with an omitted environment target. Official REST docs
were checked to establish the Preview default; the final working release used
CLI `--target preview` with the documented GitHub branch selector, preserving
existing branch-specific settings without printing their values. Connector
request validation also rejected literal REST target `preview`; no production
deployment was created by those rejected requests.

Next physical acceptance: force-quit/reopen build 3, aim only at the Monopoly
shelf QR, wait for its product card, verify SKU 6301946, then Add once. Verify
quantity 1 → 2 → 1, force-quit/reopen and verify the saved quantity remains 1.
Only owner confirmation can close these device tests. Scan the actual box UPC
for merchandise barcode testing; the shelf hardware barcode should stay unmatched.

Evidence: `monopoly-qr-fix-evidence/{deployment-source-manifest,
upload-input-verification,protected-preview-check,build3-live-compatibility}.json`
in the chat outputs. Configuration reference:
[Vercel create-deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment),
[Vercel CLI deploy](https://vercel.com/docs/cli/deploy).


## November 12 scanner mode and iOS UPC correction

The owner reports the same approved-item error on Monopoly and another ESL after
the short-QR backend repair. Therefore that repair did not establish physical
scan acceptance. The exact code captured in those attempts remains unobserved;
manual Prizm Hanger and Monopoly UPC lookups are confirmed on the iPhone.
The owner also confirms that manually entering the exact ESL URL
`https://9i3hnb-jw.myshopify.com/m` opens Monopoly. Thus that URL lookup is
verified on the phone; physical camera capture/selection remains unresolved.

Two source findings are verified:

1. The app previously accepted the first camera event across all supported
   formats. Installed Expo iOS emits visible objects in native metadata order;
   the viewfinder is a visual overlay. A rendered-component reproduction shows
   hardware Code128 first then valid QR causes only the hardware lookup and
   pauses; QR first succeeds. This proves code competition is possible, not
   which payload the owner's phone actually captured.
2. Installed Expo Camera 58.0.14 iOS normalizes UPC-A by stripping the EAN leading
   zero while retaining `type: ean13`. The matcher required 13 digits and rejected
   this checksum-valid 12-digit payload. Earlier service checks had exercised
   13-digit EAN, not this actual installed-SDK payload shape.

Changes preserve bottom navigation and branding. Scan now has **Shelf QR**
(default, QR only) and **Box barcode** (EAN, UPC, Code128, Code39) controls using
existing styles. A matching JS event filter protects against queued events.
Mode changes cancel old lookups, remount a fresh camera epoch and clear review
results without changing the cart. Resume is disabled during lookup. Manual
entry remains available. No hardware IDs are mapped to merchandise, and no
blanket ten-digit-SKU exclusion was added.

The shared matcher accepts checksum-valid 12-digit UPCs reported as EAN-13,
retains 13-digit EAN support, and still requires an exact fresh approved identity.
The same rule is deployed to the server so Add canonicalization agrees with
native lookup. The exact Monopoly `/m` alias remains supported.

- Source checkpoint: `77e135a9d7616e77c0f78107a0a71094dd2c8b6c`.
  Six files committed: Scan screen, app build number, two native test files,
  shared matcher and its tests. No unrelated changes, push or merge.
- Required Node 24 verification: native **259 tests / 19 suites**, shared
  **169 tests / 4 files**, root and native TypeScript and affected ESLint pass.
  Independent production review passed. An initial verifier run used the shell's
  Node 22 and was aborted after failures; the full required Node 24 run passed.
- API-only Preview: **READY**, `dpl_G8vRxh3U7fff3sN1Jjg1uBQ3iFAE`,
  `https://northside-customer-pilot-rlzau3bss-steves-projects-e37a4ef4.vercel.app`.
  The existing dedicated API alias now points to this deployment. Protected
  normalized-UPC scan passed before alias assignment.
- Snapshot SHA-256:
  `7f95b5f4f928980e9e299b2350cf18c6b907ed73f1be99694bb70cd316be3351`.
  Existing reviewed 614-file snapshot plus exactly two shared file updates;
  native source is uploaded separately to EAS under its existing allowlist.
- Actual native adapter plus server cart: normalized Monopoly UPC/ean13 lookup,
  Add1 → Set2 → Read2 → Remove0 passed. Test cart empty; checkout disabled.
  Website/staff/auth/checkout/static probes on API alias still return404.
- iOS build **0.1.0 (4)**: **FINISHED / READY TO INSTALL**,
  `d0737a8b-6d52-4f57-8977-ede2b340b8fc`, internal standalone Preview,
  same team `NF42JBZCBW`, bundle `com.northsidecollectibles.customer.preview`,
  existing remote credentials. No new certificate/profile or submission.
- Phone QR/box barcode, cart quantity, restart persistence and offline acceptance
  remain pending. Its downloaded artifact passed signature, signed entitlements,
  existing certificate/profile comparison, registered-iPhone inclusion, iOS16.4
  and iPhone-only settings, camera permission, standalone Hermes bundle, exact
  signed Expo/API configuration and compiled scanner-mode guard checks. No physical
  device pass is claimed.

Next action after artifact verification: install build4 over build3; choose
Shelf QR and scan the square ESL QR. Then choose Box barcode and scan the UPC
printed on the product box. Verify correct product/SKU before Add once, quantity
1 → 2 → 1 and force-quit/reopen persistence. Record each owner-confirmed outcome.

Evidence: `scan-mode-api-evidence/normalized-upc-live-compatibility.json`, source
manifest and signing preflight in chat outputs. Native tests and reviewer runtime
logs remain local under `work/qr-fix-verification`.


### Build 4 artifact and final handoff

- Install/QR page: [https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/d0737a8b-6d52-4f57-8977-ede2b340b8fc](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/d0737a8b-6d52-4f57-8977-ede2b340b8fc).
- IPA: [download build4](https://expo.dev/artifacts/eas/eWBTUAcmxIgee1eyN5SUzV2C9thoCbMxqcWtBOkTybc.ipa).
- Existing Apple Distribution certificate and ad hoc profile are reused;
  registered iPhone included, eligible device count1. Profile expires
  November11,2027 at16:17:52UTC. Actual code signature and entitlements verify.
- Signed bundle contains Shelf QR/Box barcode controls and compiled mode filter;
  the API origin is verified in signed Expo configuration. No server credential
  header references were found in client code. OTA remains disabled.
- Subsequent owner evidence: QR scanning works from a 2.9-inch tag in the app;
  1.5-inch tag QR is blurry close up. This is a partial physical pass, not
  cart, persistence, product-box UPC or full catalog acceptance.
- Owner identifies the second failed ESL as the $49.95 Phoenix NBA Blaster.
  Fresh Shopify and actual native adapter checks confirm its approved variant
  `64521956622705`, SKU `7067987`, normalized UPC `746134158551` and full product
  QR all resolve correctly. These reads do not prove its physical label capture.
- The artifact-download Python client initially received403; Node retrieved the
  artifact successfully. The inspection helper initially looked for the dynamic
  API origin as a raw JavaScript literal; its correct signed Expo configuration
  check already passed, and the unnecessary literal requirement was removed.
  Final IPA checks pass. No application workaround or signing change was needed.
- Latest API is `dpl_G8vRxh3U7fff3sN1Jjg1uBQ3iFAE`; project SSO still enabled for
  all deployments. Production remains `dpl_GeU8U7LfUy5t8jx2SynG5WkgjyZQ`.

Start with Monopoly: install build4 over build3 without uninstalling, open Scan,
leave Shelf QR selected and aim at the square ESL QR. Confirm SKU6301946 before
Add once. Separately select Box barcode and scan the product packaging UPC.
After both resolve, test cart1→2→1, force-quit/reopen and verify restored1.
If a lookup fails, record selected mode, exact message and product; do not count
that flow as passed. No checkout/order/payment tests are enabled.

Sanitized final artifacts are in `scan-mode-build-evidence/{build-result,
ipa-verification}.json` and `compiled-scanner-instructions.txt` within chat outputs.


## November 12 label-size decision and physical evidence

Owner statement: “I just tested with the 2.9 inch tag and the QR scanner worked
in the app.” The owner also confirms the 1.5-inch QR looks blurry/unable to focus
when the phone moves close. Together these observations support a physical
QR-size/focusing-distance limitation. They do not establish a universal minimum
QR size, a controlled same-product comparison or all-product device acceptance.
The successful tag's product/SKU was not specified.

Operator's intended rollout: retain product/price information on 1.5-inch tags
and remove their QR presentation until larger tags arrive; use QR on the larger
2.9-inch tags after verification. No live Shelva template, tag payload, Shopify,
price, inventory, domain or deployment was changed in this follow-up.

Source inspection confirms continuous autofocus was already enabled, no zoom
control existed, and the blue frame was a visual overlay. Proposed zoom/light
controls and build-number5 were not released. Their exact uncommitted patch is
retained in ignored chat work (`held-small-label-zoom.patch`); the two source
files were restored to exact checkpoint `77e135a9d7616e77c0f78107a0a71094dd2c8b6c`.
Build4 remains current; no build5 was created. A larger-QR printable test sheet
was stopped after the owner's successful large-tag result and is retained as
an unreviewed work artifact, outside deliverable outputs.

Next acceptance: on one approved larger-tag product, verify image/title/SKU and
price, Add once, change quantity1→2→1, then force-quit/reopen and confirm saved1.
Record the product and each outcome. Packaging UPC remains a separate Box barcode
acceptance test. Checkout stays disabled.


## November 12 cart quantity and saved-cart physical acceptance

Owner confirms: “The cart worked. I changed the quantity from1 to2 and back to1,
and the item was still saved with quantity1 after I closed and reopened the app.”

Recorded as **PASSED - owner-confirmed on iPhone** for the tested item's cart
quantity changes and close/reopen restoration. The product/SKU and exact app
termination method were not restated. This does not extend to every product,
removal, multi-item totals, offline recovery, reinstall, signout or checkout.
No code, inventory, signing, DNS or deployment changes were made to record this.

Next physical test is read-only loss-of-connectivity recovery using the same
saved item at quantity1. Enable Airplane Mode and turn Wi-Fi off, return to Cart
and wait for a connection/timeout message. Stale item/prices may be hidden; the
saved cart handle is retained. Reconnect, let foreground refresh complete or tap
Refresh shopping list once, then verify the same item returns at quantity1
without re-adding it. Report any other error or unexpected quantity.


## November 12 offline recovery physical acceptance

Owner confirms: “The offline test worked. I got a connection error, and the item
came back with quantity1 after I reconnected.” Recorded **PASSED - owner-confirmed
on iPhone** for connection-error presentation and the saved item's quantity1
restoration after reconnecting. No missing/duplicate item was reported. Exact
error text, product/SKU and timeout duration were not restated. This is one cart
recovery test, not every network/uncertain-write scenario.

Next physical test: keep the original item at quantity1; add a different approved
product once; verify two separate lines at quantity1 each; remove the newly added
line; verify the original remains quantity1; close/reopen and confirm the removed
line stays absent. Check displayed totals update. Use a working larger tag or
manual entry to isolate cart behavior from small-tag optics. Box-barcode optical
acceptance and empty-cart persistence remain separate pending tests.

No source, catalog, inventory, signing, DNS or deployment changes were made to
record this acceptance or prepare the next test. Checkout remains disabled.


## November 12 Invicta / Victa Shopify POS investigation

Owner reports QR product lookup works in the Northside app on Shelva 2.9 Slim
and 3.7 Spotlight tags, prefers 2.9 long term, and the handheld Products tab shows
Shopify products. This report does not infer that Northside app cart is connected
to Shopify POS: the native cart's POS handoff and checkout remain disabled.

A fresh read-only Admin query using the current 2026-10 multiple-barcode schema
confirmed the store and all six expected variant identities. Original UPCs remain
present. Five variants have only their UPC, with no stored ESL product-URL alias.
Monopoly alone has UPC195166245478 plus its full product URL and exact /m URL.
Thus a QR URL resolving through the native app's own catalog matcher does not
establish Shopify POS barcode matching. Missing aliases are a verified gap;
physical capture/model/current-payload failures are not yet excluded.

| Product | SKU | Current stored QR URL mapping |
|---|---|---|
| Prizm Hanger | P661462 | Missing; UPC only |
| Phoenix Mega | Z006543 | Missing; UPC only |
| Select Hanger | T326663 | Missing; UPC only |
| Phoenix Blaster | 7067987 | Missing; UPC only |
| Monopoly Blaster | 6301946 | /m and full product URL present |
| Prizm Mega | 746134151026 | Missing; UPC only |

Historical November10 evidence already records six successful actual-box UPC
scans on the handheld and POS11.18.0. Its 1.5-inch Monopoly ESL failed after
refresh/reopen, covering the hardware barcode and distance/lighting controls;
the same digital QR succeeded. These old controls should not be blindly repeated.
The exact hardware model and current app/version/location are not yet verified.

Questions pending: exact handheld model (no serial number needed), current
product/QR, whether the active app is Shopify POS and exact scan response.
Monopoly is the known-mapped control. Manually searching the same UPC and raw
QR URL on the handheld distinguishes an available barcode index from optics.
If UPC matches but QR URL does not, inspect alias/index/sync; if both match but
physical QR fails, investigate capture/decoded payload. No new EAS build is
needed to diagnose Shopify POS.

A repair, if the current larger-tag QR is verified to use the saved product URL,
would retain every original UPC and existing alias, check the exact URL is not
assigned elsewhere, then add only the intended missing secondary URL barcode.
No prices, stock, products, publication, payment, location or label settings have
been changed. Existing local-only support correspondence remains unsent.

Evidence: invicta-scanner-evidence/shopify-barcode-mapping-read.json in chat outputs.
Sources: [Shopify barcode search](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/searching-for-products),
[Victa selling modes](https://help.shopify.com/en/manual/sell-in-person/hardware/card-readers/verifone/selling-modes),
[multiple POS barcodes](https://changelog.shopify.com/posts/scan-and-search-variants-with-multiple-barcodes).


### Allure Golf target clarified; operator changed Draft to Active

Owner identifies the target as the $109.95 2026 Upper Deck Allure Golf Hobby Box,
not one of the six basketball test products. The 3.7-inch QR produces no response
or error on the handheld, while its scan light/view activates. Reported device
model is bengal; a definitive manufacturer marketing model was not established
from primary documentation. Do not assume a Bluetooth/HID scanner setup.

Owner explicitly reports just setting this product Active instead of Draft.
An initial product search showed Draft; subsequent direct reads show ACTIVE,
and a published_status:pos-published variant query returns its exact variant.
The observed status difference is explained by the owner's concurrent change,
not an assistant mutation. The separate $24.95 Allure Blaster remains Draft.

Exact Hobby identity: product15993268240753, variant64522039460209, SKU and
currently stored custom/null-type barcode92840090001065, price109.95. No QR URL
barcode is stored. A GTIN checksum check passes for that numeric value, but its
match to the physical product's printed barcode is not yet owner-confirmed.

Changing Draft to Active addresses one eligibility blocker; the local POS catalog
still needs to import the change. Pending controlled test: confirm Store data sync
then search the handheld's Products for92840090001065. Scanner activation proves
only that the reader starts, not that the QR was decoded. After local product
lookup is confirmed, obtain the current physical QR payload and compare exact
POS barcode lookup before applying any secondary alias repair. No broad activation,
barcode mutation, stock/price change or Northside app allowlist change was made.

Evidence: invicta-scanner-evidence/allure-hobby-status-and-barcode-read.json.
Reference: [POS catalog sync](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/troubleshooting/setup-issues),
[product status and availability](https://help.shopify.com/en/manual/products/product-status).


### Handheld Allure numeric lookup confirmed

After setting the Hobby Box Active and refreshing, the owner confirms the
handheld's Products search for92840090001065 returns the $109.95 Allure Golf
Hobby Box. Product eligibility and local numeric lookup are now verified for
this item. Scanner activation is separately owner-confirmed. The larger-tag QR
remains silent; exact physical QR payload is pending.

Requested next evidence: exact Shelva QR Code Link for this product, or the link
offered by the iPhone Camera before Safari navigation/redirect. If its URL is
missing from the intended variant and not assigned elsewhere, a narrow secondary
barcode repair can be prepared while retaining the original numeric barcode and
all current metadata. The supported barcodes update replaces the complete set,
so a fresh complete read is required immediately before a write. The Shopify
connector presents its own confirmation for mutations. No barcode write has
been executed or claimed complete.


### Shelva's actual Allure QR value identified

The supplied admin.shopify.com product link was confirmed by the owner as the
Shopify browser address bar, not the QR payload. The subsequent supplied
shopifypreview.com link matches the current Shelva Product Data QR Code Link
observed through read-only browser inspection of the exact Hobby variant. The
paired label is Spotlight3.7 with Published status; product overrides are
disabled. Its QR target uses /products_preview with a preview_key parameter.
The preview capability value is intentionally omitted from evidence and this
report. This verifies the configured Shelva value, not an independent decode
of the current physical e-ink symbol.

A fresh Admin product query returns ACTIVE but onlineStoreUrl:null, confirming
that the Hobby Box is not published to the Online Store channel. POS publication
and numeric handheld lookup remain separately verified. Thus the current shelf
QR is a product-preview destination and is not among this variant's stored POS
barcodes. Adding the staff Admin URL or a preview key as a permanent barcode
would not satisfy the original shared customer/POS label workflow.

A controlled diagnostic QR was generated from the already stored numeric
barcode92840090001065, without any merchant mutation. It is version1/M with a
21-module symbol, four-module quiet zone and 464px output. An independent JSQR
round-trip decode equals the intended value, and visual inspection passed.
It is a POS-reader test image, not a replacement live customer shelf label.
Expected next physical check: scan it once in Shopify POS; confirm the $109.95
Hobby Box is found or added once; stop before checkout. This separates a basic
QR reader/known-identity lookup test from the current dense preview URL symbol.

A permanent combined customer/POS repair would require a stable customer product
URL, exact secondary barcode mapping and a product-specific Shelva QR update,
then physical acceptance. Online Store publication of this additional SKU needs
explicit authorization under the owner's earlier publication restriction; it
will not be silently expanded as a scanner repair. Native preview's six-product
allowlist is also unchanged. No stock, price, domain, signing, deployment, app
code, product publication, barcode set or label configuration was modified.

Artifacts: NORTHSIDE-ALLURE-POS-READER-TEST.png and
invicta-scanner-evidence/allure-numeric-qr-control.json in chat outputs.


### Numeric QR control passed on handheld; app payload rejection explained

Owner confirms the large numeric QR92840090001065 works with the handheld
scanner, then reports the Northside app displays “Use the product barcode or a
Northside product QR code.” The control was explicitly POS-only and did not
replace a live label. The app camera decoded the QR; its format:qr path parses
the payload as a URL, so a bare numeric string throws invalid_request before
product matching. A source-level reproduction returns that exact code. This
is a payload-contract rejection, not a new camera/optical failure.

Allure is also absent from the exact six-product native/server selection.
Simply admitting numeric QR strings would not make this unpublished customer
product eligible. Current direct Shopify reads remain ACTIVE, price109.95,
one variant64522039460209, stored barcode92840090001065, onlineStoreUrl:null.
No caller supplied QR preview key is copied into evidence.

The existing shared customer/POS requirement is best retained with a stable
public product URL as the shelf QR value and the identical string associated
with the correct POS variant as a secondary barcode. The staff Admin URL and
Shopify preview URL are not the permanent label target. Allure requires explicit
pilot expansion/customer publication authorization under the owner's earlier
restriction against publishing additional test SKUs. Approval is requested for
this one Hobby Box, verified native/server inclusion and the matching secondary
POS identity, with price/inventory preserved. No mutation, publication, label
change, native source change or new build was made while that decision is pending.

The exact scope of the current physical pass is QR decoding and POS lookup for
the large numeric control. It does not yet prove physical e-ink QR acceptance
or the shared customer app/website/POS path.


### Approved Allure seventh-product expansion — November 12

The owner explicitly approved this one Hobby Box as the seventh native pilot
product. This supersedes the preceding pending-approval notes only for Allure;
the original six basketball identities and excluded out-of-stock Optic remain
unchanged. The separate web purchasing allowlist is unchanged.

Verified product15993268240753 / variant64522039460209 / SKU92840090001065
remains ACTIVE and $109.95 USD. Retail Floor121087263089 was independently
read before and after as available3 / on-hand3 / committed0. The product has
exactly one variant and no image; the existing honest image-unavailable
placeholder remains. No price or inventory mutation was sent.

Changes completed:

- Published only Allure to Online Store365846987121. Named Northside Headless
  370678989169 and POS were already published and were retained.
- Verified anonymous public product page returns200 with the correct title:
  https://9i3hnb-jw.myshopify.com/products/2026-upper-deck-allure-golf-hobby-box-regular
- Verified no exact secondary-barcode collision, freshly read the entire barcode
  set, and appended that URL while preserving numeric92840090001065 first and
  its null/custom type. POS-published exact URL lookup now returns only the
  intended variant. Storefront legacy barcode remains92840090001065.
- Shelva automatically reflected the new stable public URL after publication.
  Save & Publish was sent for this Allure configuration only; the existing paired
  Spotlight3.7 label returned to Published. Product overrides remain disabled and
  the existing template is retained. This proves reported publication/configured
  payload, not an independent decode of the physical e-ink label. No2.9 pairing
  or global template change was made.
- Appended the exact Allure identity to the existing shared native selection,
  which controls public catalog, secure scan, Retail Floor proof and cart scope.
  Updated seven-product assumptions and tests. The14digit identifier is exact
  manual/Code128 lookup data; it is not coerced toUPC/EAN13. Numeric QR rejection
  remains intentional; temporary preview/admin QR URLs are not permanent labels.
- Checkpoint3543f1e31297e9de22749b0f5e4d78cdeebc38f9 contains only the nine
  scoped native/shared/test/documentation files. Approved branding/navigation
  and build4 camera UI are retained. The held small-label zoom patch is excluded.
- Reviewed API-only Preview dpl_2K494ucBP19H15caJ8LK1oKehFAK is READY and
  assigned to the existing native API alias. Its614file snapshot differs from
  the saved approved baseline only in the two shared scan files. No deployment
  protection, credential, domain/DNS or production target change was made.

Independent checks: native259tests/19suites; shared170tests/4files; focused
server47tests/5files; root and native TypeScript; affected lint all pass. One
synthetic six-slot catalog test was corrected to selection-driven slots and the
full native suite reran successfully. Live public catalog and scan checks verify
all seven exact products/variants; no sample fallback.

Actual current native adapters passed the Allure public QR lookup, unpaid cart
add1 → set2 → read2, mixed-cart add of Monopoly, removal of Allure preserving
Monopoly, then cleanup to empty. Checkout stayed false. Guarded website/staff/
auth/checkout/assets paths remain404. No orders, payments, inventory writes or
checkout were performed. This is automated network evidence, not phone evidence.

Build5 a025da77-37f9-4d19-8c7d-3b1a2458d37a was created as an internal iOS
preview from the checkpoint using existing approved signing. Final build and
artifact verification will be recorded below.

Next physical acceptance, after build5 is installed over build4:

1. Refresh Shopify POS product/inventory sync on the Bengal handheld.
2. Scan the updated Allure shelf QR on the paired3.7 label in Shopify POS.
   Confirm exactly the $109.95 Hobby Box appears/adds once; stop before checkout
   and remove the test item. This is the first same-physical-QR POS acceptance.
3. In Northside Preview build5, Scan → Shelf QR, scan that exact same label.
   Expect the same Hobby Box, SKU92840090001065 and $109.95, with the honest
   image-unavailable placeholder. Add1, set2, return1, close/reopen and confirm1.
4. Remove Allure and confirm no unrelated saved item is removed. Do not charge.

The owner previously passed larger-label scanning, cart1→2→1/reopen and offline
recovery for the earlier pilot. These passes do not prove new Allure/build5
acceptance. The1.5inch label optical limitation remains;2.9Slim is the owner's
preferred future size, not a new hardware pairing performed by this change.

Evidence in chat outputs: allure7-api-evidence/approved-allure7-change.json,
allure7-api-evidence/deployment-source-manifest.json,
allure7-api-evidence/allure-live-compatibility.json and
allure7-shelva-published.jpg. Earlier baseline evidence remains historical.


### Build5 complete and signed-artifact verified

Status **FINISHED**,0.1.0(5), build
`a025da77-37f9-4d19-8c7d-3b1a2458d37a`, checkpoint
`3543f1e31297e9de22749b0f5e4d78cdeebc38f9`, branch
`codex/ios-preview-prerequisites-20261111`. Expo remains
`@northside-collectibles/northside-customer`, project
`ecfde92e-a01e-4158-b0ce-13908afa39ab`.

Install on the registered iPhone14 using Safari, over the existing preview:
https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/a025da77-37f9-4d19-8c7d-3b1a2458d37a

IPA download:
https://expo.dev/artifacts/eas/fgdcRZBaBaBm4RVvdxG4AUhLeMxeceg_ZH5zGt3T8ik.ipa

Downloaded IPA SHA256:
`53d9d998b940a68be8ccf023f4eb4b7d06b8b81a08dbe39db27bcad225c6f2e9`.
Signature, signed entitlements, teamNF42JBZCBW and bundle
`com.northsidecollectibles.customer.preview` verified. Existing previously
approved distribution certificate/profile reused, not recreated; registered
iPhone included (one eligible device), profile expires2027-11-11T16:17:52Z.
Standalone bundled JavaScript verified; iOS16.4minimum/iPhone-only/camera
permission/no microphone permission; OTA disabled; correct fixed commerce API;
no private-preview/interface fixture mode or private credential-header
references in the client.

An independent verifier decoded the downloaded Hermes bundle's actual catalog
initializer and matched all seven complete product/variant/barcode/handle
tuples, preserving the original six and excluding Optic. Scanner mode guards
were also checked in compiled instructions. This checks the delivered artifact,
not only the source checkout.

Independent deployment readback confirms the dedicated API alias points to the
READY Allure Preview, SSO remains enabled for all deployments, and both
production aliases remain on dpl_GeU8U7LfUy5t8jx2SynG5WkgjyZQ. A direct
anonymous API scan returns the correct Allure variant/price.

Readiness: **ready for registered-iPhone installation**, physical build5 and
same-shelf-QR POS acceptance **NOT VERIFIED** until owner testing. No current
build errors. Allure's missing product image remains an honest placeholder;
no image/price/inventory substitution was made. Do not uninstall the existing
app as part of the normal update, because that can clear local persistence.

Evidence: allure7-build-evidence/{build-result,ipa-verification,
compiled-catalog-selection}.json and compiled instruction files;
allure7-api-evidence/{validation-summary,independent-deployment-readback,
independent-scan-readback}.json.
