# Northside Collectibles — master development status audit

Audit date: **November 11, 2026, America/Chicago**. Website target: **November 13**. Grand opening: **November 20**.

## Release assessment

**NO-GO today for the new public commerce website, public native-store release, or an unqualified checkout/POS launch claim.** The existing iOS interface preview is built and signed correctly. The owner explicitly confirmed during this audit that it has **not been installed yet**. Google Play organization registration exists, but account verification is incomplete. Shopify has six approved active basketball products; this is a limited catalog, not evidence of accepted checkout or physical fulfillment.

The public domain still serves the existing Square/Weebly website. Its permanent `/app` destination returns **404**. The intended Shopify draft is unpublished. Vercel's newest customer pilot is a protected preview; its production alias serves an older October 3 deployment. Local checks are strong but not fully green: **919 tests pass, one regression fails, one case is deliberately skipped**. A disposable customer production Webpack build passes.

This was a **read-only investigation**, except for this requested report and audit evidence. No code fixes, commits, pushes, builds on EAS, app records, signing changes, inventory changes, checkout/cart creation, payments, DNS changes, migrations, access changes or deployments were performed. The owner accepted App Store Connect terms independently during the audit; subsequent inspection confirmed access and **No Apps**.

## Status definitions and estimates

- **VERIFIED COMPLETE:** the narrowly described item has direct evidence; this does not certify neighboring flows.
- **IN PROGRESS:** implementation or setup exists but required acceptance remains.
- **BLOCKED:** a specific prerequisite prevents the next release step.
- **NOT VERIFIED:** sufficient evidence was unavailable or the test was not performed.

P0 means a gate for the intended public commerce launch or safe operational cutover. P1 means a required feature/release gate for its stated scope. P2 means follow-up work. Estimates below are planning estimates of hands-on effort after prerequisites are available, not delivery commitments. Provider review and DNS timing are separate external waits.

## Status matrix

| Area / narrowly scoped item | Status | Evidence / latest known result | Blocker or remaining gap | Priority | Estimated work | Specific next action |
| --- | --- | --- | --- | --- | --- | --- |
| Actual native source identified | VERIFIED COMPLETE | `Cookarelli/northside-app`, `apps/mobile`; Expo/React Native dependencies and native configuration; HEAD `c994cff` | Web/backend changes remain outside these native commits | P1 | Verified | Preserve this directory; checkpoint the web release separately when implementation work is authorized |
| iOS standalone internal artifact | VERIFIED COMPLETE | EAS `300ec0a6-4893-4f0e-93d6-f4f6683839d4`, FINISHED, 0.1.0 (1), internal/ad hoc, bundled JS | Interface-only build; no connected customer services | P1 | Verified | Install the existing artifact on the registered iPhone; do not create another build merely to install it |
| Apple team / preview signing | VERIFIED COMPLETE | Northside Collectibles Inc., `NF42JBZCBW`; exact preview bundle; active ad hoc profile and one enabled iPhone; certificate trust/revocation check passes | Eligibility is limited to the profile's registered device | P1 | Verified | Retain the existing credentials; review device coverage before any future additional-device build |
| Physical iPhone acceptance | NOT VERIFIED | Owner response: **Not installed yet** | No installation, launch, camera, offline or background evidence | P1 | 30–60 min owner testing | Follow installation instructions below; record actual outcomes and iOS version |
| App Store Connect / TestFlight | BLOCKED | Terms acceptance cleared; correct organization accessible; Apps page shows **No Apps** | No app record, store-signed build or TestFlight upload; production identifiers/configuration not approved | P1, independent of website-only launch | 0.5–1 day preparation, plus Apple processing/review | Approve production identity and reviewer/policy metadata; create the correct app record in separately authorized release work |
| Android app identity and signing | BLOCKED | `versionCode: 1`; APK/AAB profiles exist; Android package remains an environment-driven proposal; no EAS Android credential record or keystore | Approved package, suitable Android environment/API configuration and signing setup are absent | P1 | 0.5–1 day after configuration decisions | Approve Android variant/package and backend or explicitly documented preview scope before credentials/build work |
| Android installable preview | BLOCKED | `eas build:list --platform android --limit 5` returns `[]`; no local `.apk` or `.aab` found under Codex workspaces | No artifact or company-device acceptance | P1 | First build plus 0.5 day testing after prerequisites | Build an internal APK only after configuration/signing prerequisites are verified; test on a physical Android device |
| Google Play organization account | IN PROGRESS | Authenticated `steve@northsidecollectibles.com`; Organization account `7256791405485002980`, Northside Collectibles | Identity documents, trader status, website and phone verification show Action required; Create app disabled | P1 | 30–90 min owner input + Google's review wait | Finish the existing organization verification; preserve the account and D-U-N-S identity |
| Google Play app/testing release | BLOCKED | No app can be created in current onboarding state; no AAB or EAS submission setup | App record, package verification, signing, store declarations and tester release missing | P1 | 1–2 days after account/build prerequisites + review | After account verification, prepare the existing app's AAB and an appropriate Play test track; do not treat an APK as a Play submission |
| Shopify approved product records | VERIFIED COMPLETE | Six active variants match local allowlist IDs, UPCs and prices; published to Online Store, Headless and POS; 94 available units at Retail Floor | This verifies provider records, not physical stock count or checkout | P0 | Verified; 30–60 min physical reconciliation | Reconcile the six actual shelf items/labels and confirm limited launch catalog scope |
| Shopify application API integration | IN PROGRESS | Connected Admin reads succeed; Headless publication verified; preview environment has Shopify variable names configured | Application-specific grant validity, native ingress and end-to-end customer API acceptance not established | P0 | 0.5–1 day with approved access | Verify the deployed application's own read-only catalog/identity endpoints and approved HTTPS API origin |
| Shopify storefront release | IN PROGRESS | Draft `209248715121`, updated Nov 10, remains UNPUBLISHED; live theme is `197668962673` | Exact draft shopping acceptance, source/release checkpoint and publication decision pending | P0 | 0.5–1 day QA and cutover preparation | Validate the exact intended draft, navigation, product/cart states and policy/support links before publication work |
| Vercel current customer preview | VERIFIED COMPLETE | `dpl_4uhAnLgKm9Bs7tLqrbyJxhqgwk39`, READY, Nov 10; all uploaded web/backend file hashes match current local snapshot | SSO is enabled for all deployments; no Git SHA attached to CLI upload | P1 | Verified; release provenance still needed | Preserve this tested snapshot in a reviewed release commit and establish the intended production candidate |
| Vercel production readiness | BLOCKED | Production `dpl_GeU8U7LfUy5t8jx2SynG5WkgjyZQ`, Oct 3; stable pilot aliases point there | Old candidate, protected access, no current production acceptance/environment proof | P0 if this app is part of public launch | 0.5–1 day after source/environment decision | Explicitly choose production vs protected staging roles; validate the intended candidate without disabling protection as an audit shortcut |
| Domain / Square-to-Shopify migration | BLOCKED | Apex redirects to www; www serves Square/Weebly; Shopify primary domain remains `9i3hnb-jw.myshopify.com` | Domain cutover and redirect/email/rollback acceptance not completed | P0 | 2–4 h preparation + external DNS/cache wait | Approve a precise Shopify/domain cutover plan, preserving Workspace mail, existing URLs and rollback |
| Permanent `/app` QR destination | BLOCKED | `https://www.northsidecollectibles.com/app` returns 404 | No accepted permanent landing page or physical scan proof | P0 before printing/promoting QR | 1–3 h implementation + 30 min device QA | Create/route the approved stable landing destination in the selected public platform; test the actual printed QR on both platforms |
| Checkout / payment / tax acceptance | BLOCKED | Six variants taxable, inventory policy DENY; checkout API supported; tax-included and tax-shipping flags false | Payment activation query denied by scope; no accepted paid/declined/refund/tax receipt and stock reconciliation | P0 | 0.5–1 day controlled acceptance after authorization | Confirm merchant payment settings and run an explicitly authorized test plan with expected tax, receipts, webhook reconciliation and exactly one stock effect |
| Retail pickup | BLOCKED | All three locations return `localPickupSettingsV2: null`; app public pickup flag remains false | Physical pickup promise/routing and handoff procedure not accepted | P0 if offered at launch | 2–4 h configuration planning + 0.5 day rehearsal | Decide launch fulfillment scope; verify Shopify configuration and staff handoff before showing pickup availability |
| POS operations | NOT VERIFIED | Six products published to POS; Retail/Breaker/Excess locations remain separate | Device/reader, staff role, barcode-to-variant, payment, tax, receipt, return and inventory acceptance absent | P0 for opening/cutover | 0.5–1 day on actual equipment | Run a supervised six-SKU counter rehearsal and reconcile physical stock, Shopify order and inventory evidence |
| Hosted backend / database acceptance | NOT VERIFIED | Nov 10 source documentation records 20 migrations and restricted nonproduction setup | Current staging project unavailable to connected Supabase accounts; no fresh hosted isolation/recovery proof | P0 for connected accounts/operations | 0.5–1 day once correct read access is available | Verify the designated staging project/roles/migration ledger through the correct account, then execute sanctioned acceptance |
| Automated release gate | IN PROGRESS | TS/lint and disposable customer production build pass; tests 919 pass / 1 fail / 1 skip | Stale checkout expectation and smoke assertion; full hosted/device gate incomplete | P1, resolve before release sign-off | 1–3 h focused test alignment + rerun | Align tests with the approved six-variant policy while preserving rejection of all other variants |

## Source control and source locations

### Customer monorepo and actual native app

Repository: `https://github.com/Cookarelli/northside-app`.

```text
Working tree:
/Users/northside/Documents/Codex/2026-10-30/northside-app-website-design-parity-phase/work/northside-home

Native app:
/Users/northside/Documents/Codex/2026-10-30/northside-app-website-design-parity-phase/work/northside-home/apps/mobile

Branch: codex/ios-preview-prerequisites-20261111
HEAD:   c994cff78eeb883fe0a5d4a70e4032b3888fab2f
```

`apps/mobile` is Expo 58.0.24 / React Native 0.88.1, not Next.js. `apps/customer` is the Next.js customer/backend application; Control, Webhooks and Worker are separate workspaces. The native app has its own pnpm workspace and lockfile and shares `packages/customer-contracts`.

The pre-audit baseline has **74 tracked modified entries and 99 untracked entries, 173 total**. There are 156 entries under `apps/customer`, three under Control, two under Webhooks, and changes in root dependencies, domain contracts, scripts and docs. Some untracked entries are local dependency symlinks, not application source. Full paths/statuses are retained in the evidence inventory. Native source and shared-contract paths are clean and tracked.

Recent completed native commits:

| Commit | Work |
| --- | --- |
| `4440410b02b489fe2c36e7fa7a6d56cd2ce79bba` | Checkpointed the existing native source/shared contracts and verified preview identity |
| `bde29152d54706af017f518fc4b3ef984e47eacb` | Aligned ten precise Expo patch dependencies |
| `c994cff78eeb883fe0a5d4a70e4032b3888fab2f` | Allowed the two exact locked dependency install scripts required by clean EAS workers |

Unfinished/uncommitted web work includes the six-product sales exception, shopping/cart and scan handoff, mobile API/session/privacy routes, service requests/card tracking, staff navigation, homepage/design changes, migrations and regression documentation. Existing status files include older blanket-disabled/Draft-only claims which are superseded for the six specifically approved basketball variants. They must not be used as current release acceptance.

Read-only remote heads returned `main = ef7d01bd81ad6c431bb638df0662f7543e1cac8c` and `integration/supervised-store = 9f74e7c725fc9a0d85482afb91c73e6627979521`. No remote head was returned for the native audit branch. The native commits remain local; no push was performed.

### Theme and HQ are separate

- Shopify theme working tree: `/Users/northside/Documents/Codex/2026-10-29/northside-horizon-theme`, theme in `theme/`; branch `codex/prompt3-singles-20261105`, HEAD `ff0ba50b959ccf3c02cd2541c24e53959ba05444`. It has **77 tracked modified and 13 untracked entries**. It is a local preservation/theme workspace with no Git remote configured. Current local bytes were not proven identical to the current remote draft.
- HQ: `Cookarelli/northside-hq`, inspected checkout `/Users/northside/Documents/Codex/2026-10-19/audit-the-existing-northside-hq-repository/work/northside-hq`, clean branch `codex/daily-social-production-20261020`, HEAD `55224b71bb977c0772ca60d73916ef30e39dba89`. Its package is the Next.js marketing hub. It is not the native source. This audit did not change HQ or certify its independent operational/deployment readiness.

### Differences from deployment

Vercel exposes 746 uploaded source files for the latest CLI preview. Its content-hash convention was verified against the downloaded, nontruncated policy file. Comparison against local regular files found **736 matches, ten differences, no missing files**. All ten differences are `.easignore` or native `apps/mobile` configuration, documentation, dependencies, lock/workspace files and the iOS-preview test. Uploaded web/backend files match the current local snapshot, including the uncommitted basketball policy. This is strong file-parity evidence, but the upload has no Git commit SHA and does not establish production parity, environment validity or runtime acceptance.

The newest preview is **November 10, 11:30:35 a.m. CST**, source `cli`, metadata branch `integration/supervised-store`, target preview (`target: null`). Production is **October 3, 12:33:59 p.m. CDT**. Its aliases include `northside-customer-pilot.vercel.app` and `northside-customer-pilot-steves-projects-e37a4ef4.vercel.app`. They are not proof that the Nov 10 preview was released.

## iOS evidence and installation

Authenticated commands were run from the actual native directory using its existing preview environment and pinned EAS CLI 27.4.1 / Node 24.22.1:

```text
eas whoami
eas project:info --json
eas build:list --platform ios --limit 5 --json --non-interactive
eas build:list --platform android --limit 5 --json --non-interactive
eas build:view 300ec0a6-4893-4f0e-93d6-f4f6683839d4 --json
eas device:list --apple-team-id NF42JBZCBW --json --non-interactive
```

All exit successfully. `project:info` printed the expected text identity despite `--json`; this was an output-format quirk, not an ownership failure. Expo user `cookarell` has Owner access to `northside-collectibles`. Project: **@northside-collectibles/northside-customer**, UUID **ecfde92e-a01e-4158-b0ce-13908afa39ab**.

| iOS build, newest first | Result | Version / commit | Exact known issue |
| --- | --- | --- | --- |
| `300ec0a6-4893-4f0e-93d6-f4f6683839d4` | FINISHED Nov 11, 11:06:16 a.m. CST | 0.1.0 (1), `c994cff` | None reported by EAS; physical installation still pending |
| `7aac281c-37f1-4db8-9520-26863f3cfcbb` | ERRORED | 0.1.0 (1), `c994cff` | macOS PKCS#12 MAC/import-format failure in Prepare credentials; same certificate/key was repackaged compatibly, not reissued |
| `73dfbd43-813b-481b-8755-7df42bfbd443` | ERRORED | 0.1.0 (1), `bde2915` | `ERR_PNPM_IGNORED_BUILDS`, `@parcel/watcher@2.6.0` and `esbuild@0.28.2`; exact script approvals fixed the clean install |

Only three iOS builds were returned by the requested limit-five query. No new build or retry was started during this audit.

Bundle: **com.northsidecollectibles.customer.preview**. Team: **NF42JBZCBW — Northside Collectibles Inc.** Apple Developer organization membership was verified earlier today as active, renewal November 9, 2027; the current authenticated portal still shows the correct team/profile. Fresh EAS metadata shows Distribution certificate **A54S3B5X5U**, ad hoc profile **J8DXA46V8R**, active, one included device, both expiring **November 11, 2027, 16:17:52 UTC**. Fresh certificate chain/positive OCSP verification passes. Hardware identifiers and private signing material are omitted.

The earlier same-day artifact inspection verified its code signature, exact certificate, exact embedded profile bytes, registered iPhone coverage, team/bundle entitlements, no debugger entitlement, 4,186,540 bytes of bundled JavaScript, iPhone-only support, iOS 16.4 minimum, camera purpose text and no microphone permission. IPA SHA-256:

```text
e76f4b3926640fd12da15baf6e063aeecd1c9fe87a0eda31bcc8cc38a5619ed1
```

[Expo installation page](https://expo.dev/accounts/northside-collectibles/projects/northside-customer/builds/300ec0a6-4893-4f0e-93d6-f4f6683839d4) · [IPA download](https://expo.dev/artifacts/eas/C01ryx9V_zHnoe8dNk95ajaxVs1Rwoqtl40utOuSxFw.ipa).

On the registered iPhone 14, open the Expo page in Safari, select Install in Build artifact, and confirm installation. Open Northside Preview from the Home Screen. For an internal build on iOS 16+, follow **Settings → Privacy & Security → Developer Mode**, restart, unlock and confirm Turn On when prompted. See [Expo installation](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/) and [Developer Mode](https://docs.expo.dev/guides/ios-developer-mode/). No Metro server is needed.

The owner explicitly answered **Not installed yet** during this audit. No real-device check is counted as passed. This build is the existing **disconnected interface preview**, with no API origin and `servicesConnected: false`. Shopify catalog matching, sign-in, customer wallet/orders and transactional flows cannot be certified from it.

`eas.json` preview uses internal distribution, iOS simulator false and developmentClient false. Production uses store distribution and the production variant; it is a preparation template, not a verified store release. Production bundle/team/API values and approvals are not configured by the preview's iOS-only environment. App Store Connect terms are now accepted, but the correct Northside organization shows **No Apps**. There is no app record or TestFlight build. The ad hoc IPA is not an App Store/TestFlight submission. Store metadata, privacy/SDK disclosures, reviewer access, support/deletion resources and company approval remain required.

## Android and Google Play

The source supplies `versionCode: 1`, APK for preview and app-bundle for production. Android package names are explicitly environment-driven. `com.northsidecollectibles.customer.preview` and `com.northsidecollectibles.customer` remain proposals, not approved/registered Android identities. The iOS interface-preview flag is guarded as iOS-only and must not be silently reused for Android.

Fresh authenticated EAS reads find **no Android builds, nonlegacy/legacy Android credential records, keystore or submission service-account association** for this project. No `.apk` or `.aab` was found under the available Codex workspaces. Android installation and physical-device behavior are unverified.

Authenticated Play Console inspection confirms **Northside Collectibles, Organization account, 7256791405485002980**, under **steve@northsidecollectibles.com**. It lists four unfinished tasks: identity documents, trader status, organization website verification and phone verification. The identity flow asks for an official organization registration document. **Create app is disabled until account verification is complete**; no app-specific testing tracks are currently available. No document, payment or declaration was submitted by this audit.

The confirmed D&B identity is **NORTHSIDE COLLECTIBLES INC.**, D-U-N-S **085467158**, 1722 E Riverside Blvd, Loves Park, IL 61111-4850. Preserve the leading zero and matching company identity. Google processing time remains external.

An EAS internal APK and a Google Play AAB/testing release are separate milestones. Play verification does not inherently prevent an independently approved EAS APK/device test, but this app's package/environment/signing prerequisites still prevent claiming that milestone ready. Privacy/Data Safety answers must reflect actual SDK and runtime behavior; local source review is not a completed store declaration.

## Shopify catalog, inventory and commerce

Store: **Northside Collectibles - Loves Park**, `9i3hnb-jw.myshopify.com`, Advanced, USD. Fresh counts: **2,741 total products; six Active, 478 Draft, 2,257 Archived**. A broader basketball search found 404 matches; only its first 50 were sampled, not the entire archive. All six active products were inspected directly.

| Approved product | SKU | Variant ID suffix | UPC | Price | Retail available / committed / on hand |
| --- | --- | --- | --- | --- | --- |
| Prizm Hanger | P661462 | 64521944891761 | 746134150968 | $69.95 | 30 / 0 / 30 |
| Prizm Mega | 746134151026 | 68224325419377 | 746134151026 | $219.95 | 7 / 0 / 7 |
| Phoenix Mega | Z006543 | 64521945022833 | 746134172663 | $99.95 | 20 / 0 / 20 |
| Select Hanger | T326663 | 64521945121137 | 746134170294 | $39.95 | 10 / 0 / 10 |
| Phoenix Blaster | 7067987 | 64521956622705 | 746134158551 | $49.95 | 19 / 0 / 19 |
| Prizm Monopoly Blaster | 6301946 | 64521956655473 | 195166245478 | $49.95 | 8 / 0 / 8 |

All six match `apps/customer/lib/approved-basketball-sales.ts`, are available for sale in returned provider metadata, taxable, inventory policy DENY and published to Online Store, Point of Sale and the Northside Headless channel. The active Prizm **Hanger/Mega** must not be confused with the excluded Prizm Blaster. The unapproved Optic candidate is not in the six-variant allowlist. The Monopoly variant also has two URL-valued barcode records in addition to its UPC; review intended label/scanner handling and test the actual labels rather than assuming a single numeric barcode field. No barcode record was changed.

Inventory reads place all 94 available units at **Northside Retail Floor**, location `121087263089`. Other locations are active: Breaker Storage `121202770289` does not fulfill online orders; Excess Storage `121239273841` does fulfill online orders but does not ship inventory. Retail Floor fulfills online orders and ships inventory. These are configuration facts, not a verified routing or physical-stock reconciliation. All three locations return `localPickupSettingsV2: null`.

The store reports checkout API support, `taxesIncluded: false`, `taxShipping: false` and supported digital-wallet types. These flags do not establish applicable tax calculations or a successful payment. The payment-account activation query is denied for missing `read_shopify_payments` / `read_shopify_payments_accounts` scope, so processor activation/test-mode status is **not verified**, not inferred inactive. No payment/receipt/refund, POS reader, live cart, checkout, fulfillment or inventory-decrement test was performed.

Application API acceptance is distinct from connector access. Vercel lists Shopify/Admin/customer/Storefront environment variable names on the integration preview branch, but values were not decrypted and valid grants were not established by a metadata listing. The application pins Shopify API 2026-07 by default. General purchase/loyalty/scanning/pickup flags remain false; the six-product exception deliberately enables its narrow cart path. Do not claim all checkout paths are blanket-disabled, or that narrow source permission establishes live acceptance.

## Website, Vercel, domain and QR

Vercel team: `team_iPL9ti94DMgRhfyzvbgjzZdG`; project: `prj_ew70zOV4frVoFmU5nfljsNDoxHbZ`, **northside-customer-pilot**. Latest preview: [deployment](https://northside-customer-pilot-9ras6kcra-steves-projects-e37a4ef4.vercel.app), READY. Project metadata enables SSO protection for **all** deployments. An ordinary public GET returns 302 to Vercel SSO. Environment metadata returned preview-scoped entries; this is not a verified current production setup.

The protected-fetch connector creates or reuses temporary share access; it was not used for this read-only audit. No bypass secret, access rule, share link or protection setting was created/changed. Public mobile API ingress remains a separate prerequisite. Deployment success does not prove usable customer authentication, data access or native connectivity.

Shopify theme inspection: **197668962673 / Horizon is MAIN**, updated September 3. **209248715121 / Northside Horizon Oct 27 Preview is UNPUBLISHED**, updated November 10 at 15:35:55 UTC. Its fresh local Theme Check result is recorded in the QA section below. Previous October 29 responsive/theme evidence is historical and does not certify today's dirty local source or current remote draft. The intended draft's complete product/variant/cart/checkout, service links and mobile journeys remain release acceptance work.

Public HTTP/DNS facts:

- `https://northsidecollectibles.com/` redirects to `https://www.northsidecollectibles.com/`, which returns 200 and Square/Weebly markers, not the new Shopify storefront.
- `/app` similarly redirects to www, then returns **404 — Page Not Found**.
- Shopify's primary domain is still the myshopify hostname; that storefront returns 200 without a password-page marker. This does not publish the intended custom draft or complete the custom-domain migration.
- Nameservers are `ns49.domaincontrol.com` / `ns50.domaincontrol.com`; apex A answer is `199.34.228.160`. The company domain is not attached to the Vercel pilot (404 Project Domain not found). Vercel's domain diagnostic is misconfigured **relative to Vercel**, not evidence that the existing Square website is offline.

The launch plan must decide storefront vs customer-portal routing, preserve mail/DNS records and old URL redirects, verify TLS and rollback, and provide a stable `/app` landing destination. A temporary protected preview URL, registration URL or internal IPA URL should not become the permanent public printed QR destination. No DNS, theme or website publication was performed.

## QA performed and remaining acceptance

Fresh checks used existing dependencies, Node 24.22.1, scrubbed process environments and scratch outputs. Package-manager automatic reinstalls were avoided. Tests use synthetic adapters/local PGlite/loopback fixtures, not real customer/provider data. The supported customer production build ran in a disposable source copy with existing dependency links, no private environment files and `next build --webpack`. All 697 copied source-file hashes and repository HEAD remained unchanged.

| Check | Fresh result |
| --- | --- |
| Root, customer and native TypeScript | Pass, no emit/incremental output |
| Root, customer and native/contracts lint | Pass; one existing unused-variable warning in `packages/agent-runtime/src/control.ts:25` |
| Root Vitest | 262 pass, one intentionally skipped |
| Native Jest | 222 pass, 17 suites |
| Customer application / local integration tests | 408 pass, one fail |
| Customer script tests | 21 pass |
| Pilot runner tests | Six pass |
| Disposable customer production Webpack build | Pass |
| Compiled-client secret-name scan | Pass; this is the scoped script's result, not an exhaustive secret/security audit |
| Local Shopify Theme Check | Pass: zero errors, six warnings; 530 theme files verified unchanged |

**Aggregate: 919 passed, one failed, one skipped, 921 cases.** Eleven basketball-exception regressions passed within the customer count; they are not additional cases to add again.

The failure is `apps/customer/tests/checkout-test.test.ts:260`: expected `purchases_disabled`, received `shopify_shop_not_configured`. The blanket-disabled assumption predates the approved six-variant exception: the route now proceeds into commerce configuration and fails closed under the scrubbed test environment. `apps/customer/scripts/commerce-smoke.mjs:11` contains the same stale assumption; that hosted/loopback smoke was not represented as passing. Align the fixture/assertion with the actual intended limited-sales policy, preserving negative cases for every unapproved variant. This failure alone does not prove successful live checkout or a production payment bug.

Fresh Theme Check used the already-installed CLI without authentication, uploading or auto-correction. The six warnings are one 42-vs-40 settings recommendation in `theme/sections/header.liquid:1246` and five unused documented parameters in `theme/snippets/divider.liquid:7–12`. They match the earlier warning categories and do not constitute Liquid errors. Local static validation does not establish parity with the remote draft or shopping acceptance on that draft.

One worker export test was deliberately excluded because it creates Git commits in disposable fixtures. All other core cases pass. Initial fixture-permission and scratch dependency-link issues were audit-harness problems, corrected without source changes; their superseded failures are not counted as current product defects. Fresh install, default Turbopack, dependency advisory scans, full HQ QA, full theme render acceptance and hosted transactional smoke were not certified by this audit.

Historical backend evidence: the November 10 STATUS entry records two native session/privacy migrations and service-request recovery/privacy applied to designated nonproduction project `nrsuosydvjqovrevmych`, with 20 matching ledger entries, RLS/auth-only native tables, and one marked SAMPLE inquiry recovered exactly once with outbox unsent. Fresh Supabase project/migration reads returned permission errors; the documented project is absent from currently available connector project lists. The old inactive project was not used or reconfigured. Treat those hosted facts as documented prior evidence, not a fresh hosted verification or a claim that all migrations are absent.

Missing acceptance evidence:

1. **iPhone interface:** install/launch without Metro, all five tabs, text/safe areas, camera allow/deny/manual fallback, background/relaunch and offline states. Record model, iOS version and build ID.
2. **Connected native:** approved public HTTPS API, login/return/logout/expiry, two sanctioned customer identities, owned data and cross-account rejection, product lookup and empty/error states, deletion-request lifecycle and privacy resources.
3. **Android:** approved package/variant, signed release APK, actual device permission/scan/network/background behavior and merged manifest/SDK/privacy review.
4. **Public website:** exact intended theme/candidate on phones and desktop, navigation/search/product availability, approved collection mappings, contact/service/support/policy links, accessibility and recovery states.
5. **Commerce/POS:** exact six physical labels to variant/price, tax and fulfillment display, authorized successful/declined/cancelled payment paths, exactly-once order/webhook/stock effects, receipt/refund reconciliation, staff permissions and hardware/offline/recovery behavior.
6. **QR/domain:** permanent `/app` returns the approved page anonymously; actual printed codes work on iPhone and Android before and after cutover; old URLs/email remain intact.
7. **Hosted operations:** current migration/role/RLS evidence through correct account, owner isolation, retry/recovery, backups/restore, monitored outbox/worker and approved notifications. Local concurrency fixtures and an unsent SAMPLE inquiry are insufficient.

## Prioritized TODAY list — November 11

1. **P0 — Owner/technical lead, 30 min:** freeze the November 13 release scope: Shopify website and exact six-SKU limited sales vs broader catalog, fulfillment choices, public customer portal and features deliberately deferred. Separate native-store timelines from the website target.
2. **P0 — Technical lead/reviewer, 1–3 h:** preserve the matching web/backend snapshot in a reviewed release commit when write work is authorized; resolve the stale regression/smoke expectations; rerun the relevant gates. Do not merge the dirty tree or root/native dependency graphs indiscriminately.
3. **P0 — Web/Shopify/domain owner, 2–4 h preparation:** finish exact-draft acceptance and a Square-to-Shopify DNS/redirect/mail/rollback plan. Provide and anonymously test the permanent `/app` landing page before distributing QR materials. Publish/cut over only through separately authorized release work.
4. **P0 — Merchant + QA/POS operator, 0.5–1 day:** verify payment mode/settings, required tax/fulfillment behavior and the actual six labeled items. Schedule an explicitly authorized controlled order/payment/refund/POS reconciliation; no synthetic stock or invented approval.
5. **P0/P1 — Backend owner, 0.5–1 day after access:** restore read access to the designated staging project, verify current ledgers/roles and approve mobile ingress/callback origins. Test real account isolation and recovery on sanctioned records before connected mobile claims.
6. **P1 — Steve, 30–60 min:** install the existing iPhone preview using the link above; record interface acceptance. It can be tested before live backend integration, but cannot validate connected commerce.
7. **P1 — Steve/company account holder, 30–90 min + review wait:** complete Google's existing organization verification and confirm website ownership/trader/contact facts. Avoid creating a duplicate account. App Store Connect terms are now complete; app record and production identity/review metadata are next separate release work.
8. **P1 — Native lead, 0.5–1 day after identity/environment approval:** prepare the existing Android app's package/signing and first APK, then device QA. Follow with a separate AAB/Play test release once account/app prerequisites allow it.

## November 13 / November 20 go-no-go

### November 13 website launch

**Current decision: NO-GO for the new public commerce release.** Minimum GO evidence is: reviewed release snapshot and trustworthy green regression gates; exact intended theme/candidate accepted on phones/desktop; approved public domain/routing/TLS/redirect/mail/rollback plan; `/app` anonymous 200 and physical QR acceptance; approved catalog/stock/tax/fulfillment; payment/order/stock/refund acceptance; production monitoring and an accountable release owner. Native App Store/Play publication need not hold a deliberately scoped website-only launch, but the launch must not advertise those apps or connected mobile features as ready.

There are two calendar days to target. A limited website release may be achievable if the P0 scope is explicitly narrowed and those acceptance gates pass. Existing Square availability is not completion of the new launch. No publication or DNS authorization is implied by this assessment.

### November 20 grand opening

**Current decision: NO-GO for an unqualified integrated digital/POS cutover claim.** Physical store-opening readiness beyond the inspected technical evidence is **NOT VERIFIED**. Before technical sign-off, require real POS hardware/staff/payment/receipt/tax/refund tests, physical count and location reconciliation, accepted fulfillment/pickup promises, stable web/QR routes, customer privacy/isolation and a staffed fallback/recovery plan. Choose which optional digital features remain disabled and train staff accordingly.

The nine-day window permits focused remediation, but Google verification and Apple processing/review are external dependencies and cannot be promised for opening day. Set a separate store-release decision after real device and connected customer acceptance. Do not mark a build upload, product publication or a registration account as customer acceptance.

## Evidence index

Evidence was captured during this audit unless explicitly labeled prior/same-day build evidence. Exact commands, individual outcomes and full pre-existing working-tree paths are retained in the companion `launch-audit-evidence` folder in this chat's outputs. No passwords, tokens, private signing material, customer identifiers or hardware IDs are included in the user-facing evidence.

- [eas-audit-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/eas-audit-summary.json): authenticated commands and current iOS/Android/device results; project-info text-format note.
- [signing-metadata-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/signing-metadata-summary.json): fresh redacted EAS team/profile/expiry/device-count metadata.
- [provider-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/provider-summary.json): catalog/visibility/inventory/theme/provider configuration, redacted environment metadata and authenticated console observations.
- [deployment-source-comparison.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/deployment-source-comparison.json): 746-file preview/local comparison and the ten native differences.
- [public-http-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/public-http-summary.json), [public-www-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/public-www-summary.json): public protection, domain redirects and `/app` 404.
- [source-control-baseline.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/source-control-baseline.json): all 173 pre-existing modified/untracked entries, before this report.
- [qa-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/qa-summary.json), [qa-findings.txt](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/qa-findings.txt): exact commands, unique test counts, failure/skip, disposable build and verification limits.
- [theme-check-summary.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/launch-audit-evidence/theme-check-summary.json): fresh local theme validation and source-preservation result.
- Earlier same-day iOS artifact evidence: [ios-preview-build-result.json](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/ios-preview-build-result.json) and [ios-preview-build-report.txt](/Users/northside/Documents/Codex/2026-11-11/northside-collectibles-ios-build-preparation-date/outputs/ios-preview-build-report.txt) in this chat's outputs. Physical testing remains pending.

Official references used: [Expo internal installation](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/), [iOS Developer Mode](https://docs.expo.dev/guides/ios-developer-mode/), [Shopify inventory locations](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Location), [Shopify Theme Check](https://shopify.dev/docs/themes/tools/theme-check), [Play organization requirements](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en), [Play app setup](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en). Company console, API and source observations above take precedence over older project checklists where dates or states differ.

Independent QA review: completed report checked against the independent verifier's results; no blocking contradictions were found. No fixes or further checks were performed after that review.
