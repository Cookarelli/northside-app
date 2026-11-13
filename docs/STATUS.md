# November 13, 2026 — helmet exclusion diagnosed; source-only fix

Helmet16135959970161 is absent from signed10's seven-product test selection and
the deployed API selection. Direct Shopify barcode793397728021, exactvariant
68224353927537, ACTIVE/publication/availability, trackedactiveRetailFloor99 and
unique barcode were verified independently of its equalSKU. Reproduced apprequest
omitshelmetID, receivesHTTP200sevennodes, then0matches→not_found→Scanmessage.
Backendscanhelmet404, sixPanini controls200. No cache/tag/location defect found.
User reports noQAcontrol; actualphone raw/type/native identity remainUNVERIFIED.

Source appends only the verifiedhelmet as8thidentity, retainingalloriginal7and
normalization/visibility/price/variant/Floor gates; diagnosticscount isderived.
Freshsource7products/42representations andshadowbackend42casesPASS; mobile376,
shared46,backend39tests, mobile/customerTSandlint pass independently. Fourcamera
files,dependenciesandappconfig/version10 unchanged. No build/deploy/Shopify/cart
mutationperformed. Installed10 andlivebackend remain7; backend-only cannotfix
client-embeddedIDs, andclient-only leavesAddexcluded. Bothlaterupdatesrequired.
See docs/qa/NORTHSIDE-HELMET-SCAN-2026-11-13.md before another build decision.

# November 13, 2026 — product-barcode repair for internal preview10

User confirmed only product barcodes on ESL screens and boxes; permanent housing
lookup is out of scope and no resolver was implemented. Signed8/9 have identical
camera/matcher/API/store behavior. Supplied9diagnostics contained no retained
decode/request, so broad physical failure causality remains unverified.
Reproduced all-six Code128/manual checksum-valid padded13 GTIN not_found; repaired
the narrowly valid UPC/EAN equivalence while preserving raw strings/ambiguity.
Explicit Add now sends the freshly verified canonical Shopify barcode with a
compatible literal format; current backend accepts that representation and keeps
all identity/price/availability/RetailFloor checks. No backend deployment needed.
QA now shows native versus configured build, embedded EAS source/job identity,
actual lookup endpoint/HTTP/stage, and retained timestamped reports via visibleQA.
Housing fields removed. Mobile374/374,shared44/44,localbackend35/35,TypeScript,
lintzero-warnings,nativeplugin10+4Swift checks pass independently. Four camera
files remain byte-identicalccb2139. InternalEAS e3dbdda8-8461-47d9-88f9-bb1efc9f2664
finished19:57:37UTC. Signed10 source808eaa45/native/config/source/job identity,
camera and compiledmatcher/Add/HTTP/QA verification allpass. IPA SHA256
d67345866c74012612e0596d55c89f9f0a439cd93452b5bf23087abf18bc3607.
Artifact verifier14/14 regressionspass. Physical six-ESL
three-in-a-row/box/Scan-reentry/unknown/offline acceptance still required.
See docs/qa/NORTHSIDE-SCANNER-REGRESSION-2026-11-13.md for evidence and capture steps.

# November 13, 2026 — scanner diagnostics and Shelva assignment investigation

Prepared internal iPhone preview9 with an explicit nonproduction-only scan QA
panel and Copy action. Last-attempt raw/format/candidates, actual lookup stage and
match counts, verified public variant and eligibility are observable without
changing barcode matching, Add or backend behavior. Diagnostics are bounded,
redacted, memory-only and cleared on lifecycle/identity/next-scan boundaries.
Independent review found and fixed stale callbacks repopulating cleared reports.
Mobile341/341 tests across22 suites, TypeScript and scoped lint pass; the unchanged
native camera plugin10 tests and4 Swift syntax checks pass. Four camera sources
and the shared matcher remain byte-identical to ccb2139. EAS internal build
a481dbba-8499-4e00-a1a7-743a5f2a3af9 finished18:27:15UTC; downloaded0.1.0(9)
passed signing/profile/registered-iPhone/native-camera/compiled-diagnostics checks.
App source9fdaab65; IPA SHA256e439842849dfced574ab8914596b593a0e4f586e7e6a9fdc873a5a6725a9fcf2.
Physical acceptance remains untested; no backend was deployed.

All six Panini product UPCs resolve through fresh read-only Storefront tests;
Admin confirms exact published variants, clean primary barcodes and positive
Retail Floor quantities. Original failed-device raw values remain unverified.
Shelva currently owns label pairings, but no supported assignment API/event feed
or readable assignment metafield was available. Housing resolution is NOT
CONNECTED. User-reported Select8003148023/Prizm8003147389 conflicts with inspected
Shelva UI Prizm8003148023/Select8003147389. No pairing repair is justified yet.
A vendor request was drafted, not sent. Keep generated ESL barcodes intact.
See docs/qa/NORTHSIDE-ESL-HOUSING-SCAN-2026-11-13.md for exact six-variant evidence,
missing integration contract, synchronization requirements and physical checklist.
No production deployment, App Store submission, POS/layout change or Shopify
product/inventory/pairing mutation was performed.

# November 10, 2026 — Prompt 3 backend

The designated nonproduction Supabase project `nrsuosydvjqovrevmych` now has the
two native session/privacy migrations and the service-request recovery/privacy
leaf applied individually. Both ledgers contain20 matching entries; the six
empty native tables have RLS and auth-only access. Current business terms remain
absent, the105% total-hammer proposal remains pending, and Shopify is unchanged.

Saved request retries recover before current terms/service-level checks; rejected
claims cannot falsely report pending; read-only staff cannot read private notes.
Web/native recovery preserves uncertain submissions and distinguishes an
acknowledged save from a failed history refresh. Customer sign-in preserves both
request entry and request-history return paths. Staging readiness can select the
preview variant explicitly without requiring development configuration.

Focused validation passed:84 native tests,65 customer server/privacy/tracking
tests and2 readiness tests, customer/native TypeScript and lint. An isolated
customer production build passed; the protected Vercel Preview rebuilt and its
uploaded source was checked by hash. One clearly marked hosted SAMPLE inquiry
recovered exactly once across management SQL transactions; its event/outbox are
single and unsent. This is SQL durability evidence, not HTTP/native acceptance.

Protected Preview remains SSO-only. Public guest origins/connected native API,
versioned service terms, provider/callback setup, real independent-account
isolation, staff test-sink acceptance and signed-device tests remain gated.
No production promotion, theme/catalog change, real email, payment or publication
occurred. See the November9 output folder's PROMPT_3_BACKEND.txt for evidence,
current Preview and remaining operator/business/device actions.

# October 29, 2026 — launch implementation

The audited `9f74e7c` baseline now has a separate implementation branch with
patched dependencies, an owner/admin-only development-store checkout path,
delivery-integrity and reconciliation hardening, and read-only inventory
diagnostics. All activation defaults remain disabled. Local checks pass: 412
tests, lint/typecheck, all three production builds, all twelve production
rejection suites, client configuration scan and zero dependency advisories.

Fresh Headless access returned zero products. Development-store credentials,
confirmed Admin access and exact location mappings are missing from the
inspected private configuration. No hosted migration, live processor, coding
worker, deployment or catalog/inventory change occurred. End-to-end physical
commerce testing remains blocked. See the [implementation report and operator
handoff](launch-implementation-20261029.md) for exact evidence and limits.

# Northside App integration status — October 3, 2026

> Historical baseline: the [current supervised pilot report](PILOT-REPORT.md) supersedes deployment, credential and migration counts below. Original evidence is retained.

The working branch `integration/supervised-store` continues `Cookarelli/northside-app` from `ef7d01b`. The existing customer application and directives live in `apps/customer`; the supplied logo, grading/exam/customer portal, privacy boundaries, original tests and migration history were preserved. Northside HQ was not modified. Changes are committed locally; no push, merge or hosted deployment is claimed.

| Capability | Evidence-based status |
| --- | --- |
| Existing customer shell and modules | Working locally; original test suite retained |
| New `/in-store` QR → basket → counter → preparation → collection | Fixture-only; actual phone/iPad browser journey passed |
| Shared-device reset and isolation | Working locally; reload, start-over and accelerated inactivity browser checks passed |
| Sample printed-label images | Working locally; four PNGs decoded; physical scanning unverified |
| Shopify Cart API / authenticated order / webhook boundaries | Mock contract tested; real integration blocked |
| Shopify POS bridge | Executable prototype with mocked API verification; packaging/install/device proof blocked |
| Membership/ledger foundation | Working locally; no earning rates, tiers or rewards activated |
| Mission Control authentication/commands/queue | Working locally; actual browser and HTTP worker verification passed |
| Atomic leases, fencing, restart recovery, cancellation and approval binding | Working locally; executed contract tests |
| Deterministic worker | Fixture-only; separate process completed actual local HTTP workflow, clearly SIMULATED |
| Codex adapter | Implemented; installed CLI smoke and sandbox isolation probes passed; full real verification blocked by sandbox/toolchain compatibility |
| launchd service tooling | Implemented and unit checked; not installed, not continuously running |
| New Supabase schema | Integration verified through management connector; 15 migrations applied, 111 customer tables with RLS, private bucket, clean security advisor |
| Hosted application database access | Blocked on privately provisioned restricted role logins and connection verification |
| Remote dashboard | Built and locally verified; hosted deployment pending approval/configuration |

## Next work in order

1. Privately provision the new Supabase runtime role passwords/connection strings, invited owner/staff and Storage configuration. Test the exact least-privilege roles over verified TLS, cross-role denial and hosted restart/concurrency. The authenticated management connector is already working; it does not supply these runtime credentials.
2. Resolve isolated dependency snapshot compatibility with normal pnpm verification, test-directory cleanup and Turbopack CSS port binding without exposing credentials or allowing source writes. Preserve failing evidence. Provision a dedicated non-administrator macOS account, authenticate Codex privately, and prove a complete real build/review/verify run before installing its LaunchAgent.
3. Prepare Vercel preview projects for customer and control using the separate roots and credentials in HOSTING.md. Review a preview before authorizing production. No public endpoint has been published.
4. Confirm the actual Shopify shop/public domain, test environment, plan/scopes, retail inventory location, pickup/fulfillment, taxes and discounts. Reuse the established app's authentication and durable commerce processing. Prove a test web order and POS order/correlation before enabling any sale or staff queue outside local fixtures.
5. Package the POS prototype using verified extension APIs; validate duplicate-import and payment reconciliation behavior on staff hardware. Print labels only after the HTTPS app domain and phone/iPad scan tests are verified.

These are explicit activation boundaries, not evidence of a live store or unattended crew. Merge, production deploy, real charges, live inventory changes and store integration installation remain disabled.


## October 29, 2026 — commerce continuation

Committed cart ownership now precedes buyer-bearing Shopify calls, including
lost-response cases; verified Customer Account IDs establish ownership before
cart mutation. Checkout consistency checks and canonical financial-state
validation were strengthened. Joined SQL/provider-fixture coverage brings the
suite to 416 passing tests. Lint/typecheck, zero-advisory dependency audits and
all three webpack production builds pass. Default Turbopack is blocked by
port-binding EPERM. Current production smoke execution was blocked before
server start by automatic approval-review capacity; prior smoke results are
not reused as current success. No real Shopify payment or hosted delivery passed.

The staff development-store guest checkout still needs an isolated test customer
identity/cart/order realm before authenticated end-to-end test purchasing can
be claimed. Live purchases, the metadata-only public receiver and disabled
workers remain unchanged. See [the continuation report](commerce-continuation-20261029.md) for exact changes, evidence and blockers.


## October 29, 2026 — local scan-to-cart continuation

Receipt status and deployed Customer/Mission Control Vercel authentication are
**UNVERIFIED**, neither passed nor failed. External polling is stopped at the
user's request. Existing observations above are historical.

Implemented a strictly parsed scan-add contract using the existing encrypted
cart and registry architecture: fresh registered-variant/publication/approved
retail checks, reviewed-price comparison at both provider reads, aggregate stock
validation and unchanged break-cart policy. Nine new local acceptance tests pass.
Purchase/scanner gates and every disabled processor/worker remain off. No external
requests, deployment, actual payment or inventory writes occurred.

Final checks: 292 customer tests pass; 131 other tests pass and two loopback
listener tests fail with sandbox EPERM. Lint/typecheck and all three webpack
production builds pass. Full pnpm test is not green. Authenticated development-store
order isolation, installed POS handoff and live loyalty acceptance remain incomplete.
See [local commerce report](local-commerce-20261029.md) for changed files, exact limits and remaining verification.


## October 29, 2026 — customer scan, shopping list and unpaid register handoff

Implemented the local customer journey at `/scan` and `/cart?inStore=1`, reusing
the existing scanner/registry/Storefront reader and shared cart quantity controls.
The encrypted, owner-bound list revalidates variants, price and stock, supports
quantity/removal/subtotal, and freezes an unpaid expiring QR/reference for
authenticated staff-assisted register entry. Cancellation revokes the reference.
Existing checkout ownership safeguards and 41 pre-existing changed files were
preserved on `feat/customer-scan-handoff-20261029`; no commit was created.

Independent local validation: **440/440 tests**, root/customer lint and typecheck,
Customer/Control/Webhooks production builds, and the 122-client-artifact scan pass.
One existing root lint warning remains. Loopback test restrictions were resolved
with local-only execution. Browser barcode, actual saved QR image, cart editing,
unpaid handoff, staff retrieval, cancellation, unknown/sold-out/duplicate handling
and 390px/820px layouts were checked. Physical devices and hosted use remain
unverified. No external check, provider/inventory write, deployment, role change,
production payment or worker activation occurred. Production scan gates stay off.

See `docs/customer-shopping-20261029.md` at the repository root for the exact
isolated local launcher, fixture codes, staff sign-in, validation and blockers.
# Monday November 9, 2026 — current-source test readiness

Continued the existing dirty `codex/card-tracking-20261105` worktree at
`9f74e7c725fc9a0d85482afb91c73e6627979521`; branch, index and prior changes
preserved. Friday customer Preview `dpl_BErQ9zNk3rZrrBFkDw9gQfkUHwdj`
matches all 740 uploaded source content IDs at Monday start. Staff Control
`dpl_GuhdNSSB6SV5oCDepCNNWFWJMy7W` remains the Friday pre-design workspace;
its eight differing customer files are the subsequent customer/staff-service
design lift, while the Control app source is unchanged.

Fixed platform-scoped EAS identifier validation, native Wallet deadline/resume
freshness, Shop navigation-state synchronization and native lint/type issues.
Independent review found no actionable issues. Fresh final evidence: 900 tests
(263 root, 6 pilot, 394 customer, 19 customer scripts, 218 native), all three
web builds, root/customer/native typechecks, clean customer/native lint (native
started at 39 errors/6 warnings), one existing root lint warning, and iOS/Android
Hermes plus web JavaScript exports pass. These exports are disconnected-default
compilation evidence, not signed or installed applications.

Confirmed owner-designated nonproduction Supabase target `nrsuosydvjqovrevmych`,
17 applied migration hashes, 12/12 request-table RLS and private bucket settings.
Fourteen fresh disposable Storage transport/access/expiry/cleanup checks pass;
application customer ownership/photo flows remain unverified. Hosted Mission
Control login, authenticated snapshot, origin rejection, logout and revoked-cookie
denial pass using existing secure configuration. No real message was dispatched.
The management `SET ROLE northside_runtime` probe remains denied (42501), and
native session/privacy migrations remain unapplied. Full service requests still
need approved terms and reachable guest/native transport. Current all-deployment
Vercel protection remains enabled; a browser reviewer cookie is not native API
transport. The user reconfirmed inactive Apple Developer membership, so no signed
iPhone build was started. Joey still needs his separate customer test access.

Website theme 209248715121 remains unpublished with 0 ACTIVE/2707 DRAFT products
and checkout disabled. Existing theme source reconciles after Shopify JSON
serialization normalization. No theme upload, web redeployment, production
promotion, catalog activation, DNS change or store submission was needed/made.
See the Monday task outputs/MONDAY_2026-11-09/BASELINE.txt for exact source
identities, access links, operator actions and the local/deployed/hosted/device
matrix. Earlier dated checkpoints above remain historical.

Monday follow-up: the user confirms Chrome Shopify sign-in and refreshed SAMPLE
request history show Review and a dated update while the private staff note stays
hidden. This is a user-reported one-account browser PASS. Chrome device type is
unconfirmed; Mac Safari still requested Vercel login. No iPhone/native, customer B
or application photo-ownership PASS is inferred. Baseline and hosted evidence updated.

Prompt 2 started November 9: fresh independent review of20 unchanged customer
files finds no actionable source issue;132 focused tests and28 scrubbed loopback
HTTP boundary checks pass. Actual in-app customer browser session loads its owned
private front photo at1800x2400 and is denied another verified customer's SAMPLE
grading card/photo,consignment detail and exact private file URL. Five fresh hosted
anonymous checks retain401/404/private-no-store boundaries. Existing SAMPLE front/
back objects match stored SHA256 and lengths in read-only operator verification.
Joey's customer reviewer QR is generated/decoded; existing staff admin is present.
Normal staff-owner sign-in and Joey's separate Shopify login are still required
for hosted upload/retry and reverse/two-account acceptance. No fake session,
role grant,real-card edit,production/catalog change or full acceptance claimed.

Prompt 2 midday execution: changed the staff homepage heading to the requested
"Northside Staff Dashboard". Customer lint/typecheck/production build passed
independent verification. Protected Preview `dpl_A3KE5wckx834cDRYkqapwW9Px1qz`
is READY; all741 uploaded source files match the reviewed dirty-source manifest.
The established customer testing alias now serves this deployment. The first
unassigned candidate lacked branch-scoped configuration and was not activated;
the corrected source-snapshot deployment uses both supported GitHub metadata
markers for existing `integration/supervised-store` Preview bindings. No actual
branch switch, environment value/policy change or production promotion occurred.
Runtime Shopify login start303, exact callback/secure cookie, staff shell200,
private401/fixture404 and authenticated staff heading were verified.

Actual staff login and Chrome customer login now work in separate contexts.
A failed old OAuth return had a missing temporary attempt cookie; a fresh normal
sign-in succeeded without changing credentials or authentication protections.
Created exactly one clearly labelled SAMPLE intake/card for the current verified
customer, without modifying the original Cooper Flagg or prior SAMPLE records.
Staff front/back uploads normalized, confirmed and persisted; customer photos
actually rendered400x560 before and after the Preview update. Repeating identical
front bytes preserved both photo IDs and full metadata; an unsupported text file
was rejected while confirmed photos remained. One additional staff-only SAMPLE
paper image and a synthetic internal-note marker were saved in the unpublished
draft. Staff readback and all three stored-byte hashes/lengths pass; no scores,
grade, signed exam, payment, service approval or dispatch was generated; no real
external notification was dispatched. Scoped readback confirms1SAMPLE in-app
notification created by the normal intake trigger,0external delivery jobs and
0delivery attempts.
Actual Chrome customer read now shows exactly the front/back photo references,
no paper reference/private marker, and exam workspace writer=false/draft=null.
The exact paper URL returns photo_not_found; the other customer's exact photo
returns grading_card_not_found. These browser bodies were observed without
capturing authenticated HTTP status/headers. Native Chrome controls resolved a
browser-automation limitation on raw JSON pages; no extension/protection changed.
Normal customer logout returned sign-in, locked the other private tab, and browser
Back showed sign-in required without cards. The previously readable exact front
URL returned sign_in_required. Chrome is intentionally left signed out at Account;
the separate in-app Store owner session still shows the new dashboard heading.

At the user's direction, prepared Joey's separate Shopify customer record using
his existing Northside email, exact lookup/readback confirmed, marketing not
subscribed. Existing staff admin was not changed. No customer app identity was
manufactured: Joey must complete normal Shopify OAuth privately when available.
Two-customer reverse acceptance and physical iPhone tests remain pending; Apple
membership is still inactive. Catalog remains0ACTIVE/2707DRAFT and theme209248715121
UNPUBLISHED with Friday's timestamp. Current detailed evidence and blockers are in
the Monday task outputs; earlier morning statements above are dated checkpoints.
