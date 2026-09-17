# Northside status — September 17, 2026

## Grading repository checkpoint — September 17, 2026

Steve authorized committing and pushing the completed grading work to `Cookarelli/northside-app` on `main`. This checkpoint includes private card photography, signed Northside Exam revisions/reports, the customer grading portal and approvals, staff custody/dispatch/returns/pickup, four additive migrations, recovery/concurrency tests and operating documentation. Earlier statements that these extensions were uncommitted describe their September 16 handoffs. Connected GitHub write access was verified again; no password reset is needed for this publication.

Before publication, type checking, lint and all **210 automated tests** passed again. The source credential scan found only a deliberately invalid credential-bearing URL in a rejection test; no live credential was found. Saved databases/photos, local evidence/logs, dependencies, build outputs and Supabase CLI temporary files remain excluded. The framework-generated development-only change to `next-env.d.ts` is not part of this checkpoint.

The fresh production build attempt was blocked by this session's local build-worker environment: the package runner could not bind its worker port, and direct Node retries failed to spawn the pooled worker. No application source or dependency was changed to bypass this. The most recent successful production build, 25 client artifact checks, twelve production HTTP suites, six real local PostgreSQL concurrency checks and browser/restart acceptance remain the September 16 evidence below; they are not claimed as fresh September 17 results. Publication logs are ignored under `work/grading-publication/`.

This is source publication, not a deployment or live integration activation. Hosted configuration/device acceptance and the dedicated design pass remain outstanding; the live Square website entry remains deferred.

## Digital grading final acceptance — September 16, 2026

**Implemented and verified locally; not deployed by this work and awaiting live configuration.** The consolidated [grading intake guide](grading-intake.md) now contains the staff procedure, customer flow, configuration, recovery steps and all fourteen requested acceptance checks with evidence and limits. The existing [staff operations preview](http://127.0.0.1:3000/staff/grading/operations) remains available. No live Supabase/Shopify identity or Storage, native device camera, external mail or public Square navigation result is implied.

**Defect fixed:** actual overlapping PostgreSQL transactions exposed a stale joined-row read. When dispatch changed a card's status while a quote operation waited on `FOR UPDATE`, PostgreSQL could reject the old joined status row and make an existing card appear missing. `gradingCard` now locks the scoped card identity first and loads its joined projection in a fresh statement. Approval/dispatch protection already rejected unsafe changes; the corrected read returns the accurate current state/conflict. No schema migration was needed and no applied migration was edited.

**Fresh automated evidence:** `pnpm typecheck`, `pnpm lint` (zero warnings), **210 tests** (10 policy/CLI/PWA + 200 application), `pnpm build`, and **25 client artifact checks** passed. The full run includes **88 focused grading/exam/portal/operations/privacy tests**. Added explicit same-copy identity/subtotal checks, email/intake-number claim denial, unchanged fees after photo recovery, and a notification failure/retry regression that preserves all operational and inbox counts. All **twelve production HTTP suites** passed on a temporary loopback production server; additional browser requests confirmed signed-out/malformed-cookie/forged-actor denial for private records/reports/manifests. Fixture development deliberately rejects live-auth paths with 503; production signed-out checks return 401. The combined `pnpm release:check` command was not invoked; its constituent checks passed individually, including the normal `pnpm build` with approved local worker-port access.

**Six actual concurrency checks passed** on a temporary PostgreSQL 18.4 server, using separate connections, seeded test sessions and real row/advisory lock waits: quote-before-dispatch, return-before-dispatch, exam-before-dispatch, dispatch-before-quote, dispatch-before-return, and duplicate dispatch. Changed/withdrawn evidence blocks a waiting dispatch; a completed dispatch rejects later pre-dispatch changes; identical concurrent dispatch retries preserve one manifest. `scripts/grading-concurrency.ts` retains this reproducible test and refuses non-loopback/incorrect database names or an existing app schema. Temporary pinned test tooling did not change application dependencies or the project lockfile. The test cluster stopped afterward. This improves local concurrency evidence; it does not verify hosted Supabase roles, pooling, Auth or Storage.

**Fresh browser evidence:** an isolated touch-enabled Chrome context created **SAMPLE — Final grading acceptance, identical copies**, with three distinct records and a **$15** receipt. It checked initially blank scores/blocked publication, HEIC guidance, the rear-camera HTML control and upload fallback, an interrupted front upload followed by refresh/reselection, and a back upload whose stored-success response was deliberately lost then retried. Exactly two confirmed photographs retained their original IDs, with three cards and unchanged fees. The saved draft was absent from the customer response; explicit keyboard signoff published one complete revision. Keyboard checks covered score-field order, zoom-modal focus/slider/Escape/focus return and signoff/publication. 390px, 820px and 1280px layouts were inspected without overflow. These are browser/device-emulation checks, not native iOS/Android capture.

The prepared `/grading` entry and app My Cards navigation showed identical customer portal links and records. Mixed-collector checks denied the other owner's record/photo/report/receipt/approval URLs and excluded pooled identifiers. A clean restart retained **all 19 earlier cards plus the three new acceptance cards**, exact photo/revision identities and the $15 receipt. It also preserved the earlier three-card mixed manifest and one completed pickup while the other two cards remained with the grader. Post-restart browser inspection found no page errors or framework overlay. Focused tests freshly exercised partial graded/no-grade returns/pickups, immutable external outcomes versus Northside estimates, import replay/stale reviews, role/tenant/count isolation, storage failure and notification retries. No real test messages were sent.

Review [the saved acceptance exam](http://127.0.0.1:3000/staff/grading/exam/89e54c65-3d7f-47ff-914f-e86410db9c3a) or [its owned customer card](http://127.0.0.1:3000/my-cards/grading/card/89e54c65-3d7f-47ff-914f-e86410db9c3a?actor=a). Only the first of the three identical copies has its two photos and exam published; the other two remain separate received cards with Photos missing. All photographs/notes/fees/results are labeled SAMPLE. Evidence is ignored under `work/grading-acceptance/`; operational fixtures remain ignored in their existing database/image directories. Earlier working-tree changes were preserved. No new commit, push, deployment, hosted migration, Shopify product edit or future retail activation was performed.

**Specific blockers before live use:** verified HTTPS deployment/origin; Supabase project configuration, migrations/restricted roles, hosted concurrency and coordinated private-object restore; real Shopify/customer/staff sign-in, session refresh/logout and receipt-claim verification; actual phone/tablet capture/picker/HEIC/orientation/weak-network and hardware scanner checks; and in-person pickup procedure acceptance. Live Square navigation is still deferred by the user. Email delivery remains disabled/unverified; retain the Google Workspace setup preference. The dedicated design pass remains due.

The temporary production test server was stopped; the saved local preview remains on port 3000. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

## Staff grading operations — September 16, 2026

**The requested staff grading extension is implemented and validated locally.** The [staff operations guide](STAFF-GRADING-OPERATIONS.md) documents the complete workflow and remaining external checks. Open [Staff grading operations](http://127.0.0.1:3000/staff/grading/operations). This extends the existing received-card, private photo, signed exam, exact customer approval and payment-reference records.

- Staff scan individual approved cards into mixed-collector batches with provider/service, current approval, physical custody and duplicate outbound checks. Phone/tablet camera, label-image, scanner and separately identified manual-ID paths reuse local pinned barcode assets. A label grants no release authority. Dispatch revalidates the exact entire scanned list transactionally and preserves immutable owner/card/approval/exam/quote and reference/carrier/tracking evidence. Tracking corrections never rewrite the manifest.
- Per-card milestones follow the requested received-through-completed sequence, with evidenced skips when intermediate grader events were unavailable. Holds/exceptions preserve physical custody. Pre-dispatch cancellation or return removes the draft outbound assignment; post-dispatch withdrawal is a customer request for staff review, never an automatic cancellation/return. No live grader feed or time-based advancement exists.
- Partial returns record the actual external grade or no-grade outcome, available certificate and immutable correction history. Separate private returned front/back photos must be confirmed before pickup readiness and release, including stored-byte readback. Northside's signed estimate remains unchanged. Other batch cards stay with the grader.
- Partial pickup requires scanning every released card, same verified owner/approved claimant, independent recipient identity and representative authority when applicable, recipient acknowledgment, authenticated staff and time. Stable exact-request retries and a unique release per card block duplicate handoff. QR/email/name alone cannot release a card. Future retail order pickup remains disabled.
- Reviewed CSV updates preserve server-parsed mapping, row validation, exact card versions, source IDs, fingerprints and commit audit. Stale/conflicting reviews fail atomically; repeated applied rows skip rather than overwrite later history. CSV cannot approve, dispatch or release. Browser testing caught and fixed blank result columns being treated as new outcome values; a dedicated regression test now covers it.
- Examination payments retain verified Shopify linkage or explicitly staff-recorded references. Generic in-app decision/review/pickup updates and durable jobs save transactionally and deduplicate on retry. Staff can inspect failures/UNSENT jobs. The existing email adapter/preferences are reused; Google Workspace remains the preference if configuration is resumed. No real test messages were sent.
- Added CLI-generated migration `20260916195007_grading_staff_custody_and_dispatch.sql`, applied only to local preview/isolated tests. Legacy sent batches are marked historical without fabricated manifests, signatures or audit sources. New staff records enforce tenant/role RLS; customer requests/photos/reports/exports remain explicitly owner scoped. No dependency or environment variable was added. The deployment trace includes the pinned QR writer.

**Final verification:** typecheck and lint passed without warnings; **209 automated tests passed** (10 policy/CLI/PWA plus 199 application tests, including 26 staff operations tests). The final direct Node production build passed with approved local worker-port access, followed by **25 client artifact checks**. All **twelve production HTTP suites passed**, including eleven new staff operations rejection checks for sessions, manifests, labels, imports, origin checks and production fixture denial. Individual checks were run successfully; a combined `pnpm release:check` invocation is not claimed. `git diff --check` is clean.

**Browser and persistence:** isolated Chrome scanned the actual generated label image, staged three cards from two collectors, deliberately lost the successful dispatch acknowledgment and retried without duplication, reviewed a post-dispatch withdrawal, physically returned/photographed one card, and completed only that card's representative pickup. It checked customer returned-photo zoom, owner denial and decision/pickup inbox updates. The saved CSV review then updated just one remaining card to Grader received. Final 390px/1280px screenshots were inspected without horizontal overflow or page errors; cramped tabs and form controls were corrected. A clean preview restart retained **all 16 earlier cards plus 3 new SAMPLE cards**, their private photos, immutable three-card manifest, partial pickup and committed import. Existing fixtures were backed up with their paired images before migration. Tests also cover graded/no-grade partial returns, stale approvals/reviews, held/cancelled cards, release prerequisites, storage mismatches, privacy and database/image restart persistence.

The new **SAMPLE mixed collectors — operations review** batch contains:

- Collector A: [one completed card](http://127.0.0.1:3000/my-cards/grading/card/10284074-f08c-48ce-8429-6b616345e6f2?actor=a), with SAMPLE external result/certificate, returned images and preserved representative acknowledgment.
- Collector A: a second card at Grader received, evidenced by the reviewed SAMPLE spreadsheet.
- Collector B: one card still Sent to grader, with staff-reviewed withdrawal requested for return when received.

Every service, quote, carrier/tracking value, outcome, recipient and photograph in this walkthrough is fictional and labeled SAMPLE. These saved records and evidence under `work/staff-grading-verification/` are ignored by Git; they are not seeded into new installations. The temporary production server was stopped; the preview remains on port 3000. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

**Remaining external acceptance:** real Shopify/customer/staff identity and receipt verification, hosted PostgreSQL RLS/concurrency, Supabase private Storage/restore, and physical phone/tablet cameras/scanners require configured HTTPS staging. No hosted migration, deployment, grading-company connection, real shipment/payment/message, Shopify product edit or future retail feature activation was performed. The live Square website navigation remains deferred by the user (“later”). The implementation preserves one external submission cycle per intake-card record; it does not recycle historical manifests for re-submission. These extensions remain local working-tree changes, with no new commit/push in this handoff. The dedicated design pass remains due.

## Customer grading portal — September 16, 2026

**The customer grading extension is implemented and validated locally.** [CUSTOMER-GRADING.md](CUSTOMER-GRADING.md) records the workflow, approval rules, privacy boundaries and remaining hosted checks. The actual website was inspected before navigation work: it uses Square Online/Weebly, separate from this Next.js portal. The user explicitly deferred the live website connection with “later.” The app's responsive `/grading` entry and footer **Grading / Track My Cards** link are ready; [WEBSITE-GRADING-ENTRY.md](WEBSITE-GRADING-ENTRY.md) contains the concrete Square handoff. No live navigation or deployment was changed, and no public portal hostname is assumed.

- **My Cards → Grading** now shows owned dropped-off cards and confirmed photos, printable intake receipts, published Northside Exams/reports, itemized quotes, current status, dated history, last update and separately recorded external final results. Current received photos are visible before exam publication; draft assessments, paper exams, internal notes and shared manifests remain private.
- Collectors review and explicitly approve selected cards or request their return. Immutable evidence binds the authenticated actor, timestamp and exact card list to the card state, published exam revision, confirmed provider/service and quote revision. Partial decisions leave other cards untouched. Lost-response retry reuses the same request; saved decisions and photos survive refresh/restart. Return requests do not imply physical return or authorize unknown fees.
- External grading, shipping, insurance and other charges default to unset. The portal says **Not yet quoted / Total pending**, never free. Staff can deliberately configure a zero amount. No live fee schedule or service was seeded. PSA is confirmed; BGP remains internal/unconfirmed and is neither renamed nor advertised.
- Any new quote or published exam revision invalidates the previous submission approval. The server and database block dispatch unless every selected card has current approval and its batch provider/service matches the approved quote. Legacy decisions cannot bypass the new rules. Older saved batches can configure missing service before first dispatch; provider/service and membership freeze after dispatch history, including later On hold states.
- Existing verified Shopify identity and refreshed sessions remain the customer authority. Safe grading/card/exam return destinations survive the sign-in form and OAuth flow. Owner/tenant checks and explicit customer projections protect requests, photos, receipts, reports and CSV. Private responses are not cached.
- New migrations `20260916185139_customer_grading_quotes_and_approvals.sql` and `20260916192111_grading_batch_service_setup.sql` follow the photo/exam migration. Both were generated using Supabase CLI 2.117.0 and applied only to local preview/tests. Earlier migration files and saved records remain intact. No new dependency or environment variable was added.

**Fresh verification:** typecheck, lint and **183 automated tests passed** (10 policy/CLI/PWA plus 173 application tests, including 17 customer portal tests). The final production build passed using the direct Node builder with approved local worker-port access; 23 client artifact checks passed. All **eleven production HTTP suites** passed, including eleven focused portal checks covering unauthorized receipts/exports, production fixture denial, cross-origin decisions and exact login return destinations. As with the prior extension, individual checks passed; a successful combined `pnpm release:check` invocation is not claimed.

**Browser and persistence:** isolated Chrome exercised the staff quote form, public entry, two-of-three approval, a lost success acknowledgment followed by the same-request retry, a selected return request, a material quote change, rejected dispatch, renewed approval, approved SAMPLE dispatch and a separate final result. Other-owner card/photo/receipt requests and cross-origin writes were denied. Collector switching cleared the previous view. Mobile 390px and desktop 1280px layouts, zoom and receipt printing were inspected without overflow or page errors. The one-page Letter receipt PDF was rendered and visually checked. A clean preview restart preserved the same decisions, cards and confirmed images; all 13 previously saved cards were retained.

Open [the reviewed SAMPLE customer card](http://127.0.0.1:3000/my-cards/grading/card/653553d4-f23c-4afd-ba3d-7094ee64125a?actor=a) or [the grading list](http://127.0.0.1:3000/my-cards/grading). The new **SAMPLE — Customer grading approvals walkthrough** intake has three cards: one with renewed approval and a recorded SAMPLE final result; one requesting return; one awaiting a decision with an incomplete quote. Services, amounts and results in that walkthrough are fictional. This Mac-only saved fixture is ignored by Git and is not seeded into fresh installs. Evidence is ignored under `work/portal-verification/`.

The preview remains on port 3000. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

**Remaining external work:** actual Shopify login/refresh/callbacks and receipt identity verification, hosted PostgreSQL concurrency/RLS, private Supabase Storage, phone/tablet capture/logout and coordinated hosted restore require configured HTTPS staging. Local PGlite, browser fixtures and production rejection tests do not prove those integrations. Square navigation waits for the user to resume it and provide the verified portal origin/editor access. Shopify products and future in-store gates remain unchanged; custom loyalty has no paid plugin. The dedicated design pass remains due. These grading extensions are local working-tree changes; no new commit, push or deployment was performed in this handoff.

## Card photography and digital Northside Exam — September 16, 2026

**The user-authorized grading extension is implemented and validated in the local preview.** Full workflow, storage/recovery contract, migration and hosted acceptance steps: [NORTHSIDE-EXAM.md](NORTHSIDE-EXAM.md). This extends the completed ten-prompt app; it is not a live deployment or a verified hosted integration.

- Received-card records are saved before photography. Each saved card links to its exam; staff lists show **Photos missing** until front/back are confirmed. Camera/file controls offer preview, retake, transfer progress, private-storage confirmation and retry. Failed or uncertain uploads keep the received card and stable attempt identity; retries do not create another card. Confirmed photographs and saved assessments survive refresh and restart.
- Private tenant/card-scoped images accept bounded JPEG/PNG/WebP, with full decoding, EXIF orientation, metadata removal and clear unsupported-format help. Server authorization protects preparation, upload, download and reports; storage readback/hash verification precedes completion and is repeated for publication. Optional closeups and staff-only paper exam photographs are supported. Old published photo snapshots remain intact after retakes/removal.
- Digital fields match the requested paper exam: initially blank integer 1–10 Centering/Surface/Edges/Corners, public Notes, manual Projected grade or Unable to estimate, and authenticated examiner signoff/time. Internal notes are separate. No generated photo grade or averaged score exists, and Northside's estimate is separate from the external result.
- Explicit draft save and publication are distinct. Publication requires the current saved draft, required confirmed photos, four scores, estimate choice, signoff and reason. Corrections append signed revisions with private reasons and immutable photos/fields. Customers see only published evidence. Printable reports include photos, scores, public notes, estimate and signoff; internal notes/reasons and paper exam photographs are excluded.
- Added timestamped migration `20260916174953_grading_photos_and_northside_exam.sql`, generated with the Supabase CLI. It adds five RLS-protected tables and immutable revision/photo snapshot rules. Existing migrations/data remain intact. Applied only to local preview and isolated tests; no hosted migration was run. No new dependency or environment variable is required.

**Fresh validation:** typecheck, lint and all **166 automated tests** passed (10 policy/CLI/PWA plus 156 application tests, including 16 exam tests). The final production build passed with direct Node execution; 23 client artifact secret checks passed. All ten production HTTP suites passed on a temporary loopback production server, including the eight new exam rejection checks. Deliberate production fixture opt-in still returns 404; unauthenticated photo/report reads and cross-origin writes fail closed with no-store responses.

The standard package-runner build initially failed when the Codex sandbox denied a temporary Turbopack worker port. Running `node node_modules/next/dist/bin/next build` with approved local execution passed. The framework, bundler and package scripts were not changed to bypass the failure; a fully successful `pnpm release:check` command is not claimed for this extension. Its typecheck/lint/test checks, the direct production build and the secret check were completed individually.

**Browser and persistence evidence:** an isolated Chrome session verified receipt-first intake; front upload interrupted before storage and retried; back upload saved with its success acknowledgment lost and retried without duplication; saved draft/photo refresh; zoom; explicit signoff/publication; correction to Unable to estimate; original revision preservation; optional closeup/paper handling; customer revision selection; denied other-customer access and cross-origin writes. Desktop 1280px and mobile 390px views had no horizontal overflow or page errors, with labeled visible controls. The printable SAMPLE report was saved as a two-page Letter PDF, rendered and both pages visually inspected without clipped content or private notes. Automated tests additionally close/reopen the database and image directory to verify persistence, exercise storage mismatches and verify private Supabase adapter behavior with mocked responses.

The saved review fixture contains one new card, four confirmed photographs and two published revisions, visibly labeled **SAMPLE — Photography & digital Northside Exam review**. Open [the staff exam](http://127.0.0.1:3000/staff/grading/exam/1502c31a-0fa4-4872-94da-593ac6f77ba0). This machine-local fixture is not included in Git or a fresh checkout. The original saved operational data was preserved. Preview remains at http://127.0.0.1:3000; start from the app folder with `./scripts/preview.sh`. Evidence is ignored under `work/exam-verification/` (final build/test/production logs, browser checks, screenshots and test PDF). Database and private image bytes remain ignored under `work/grading-preview/` and `work/grading-photos/`; preserve both together for backup.

**Unverified:** actual phone/tablet camera capture, hosted Supabase Auth/Storage/PostgreSQL concurrency, real-session/device privacy, hosted backup/restore and deployment. These require the existing private configuration and a physical-device staging pass. The production adapter is implemented, but local fixture/provider-mock success does not prove those external paths. Shopify products, custom-loyalty economics and future in-store gates were not changed. The dedicated design pass remains due.

## GitHub repository handoff — September 16, 2026

Steve selected https://github.com/Cookarelli/northside-app and explicitly requested committing the app. The repository was empty and the connected account's push/admin permissions were verified. This destination supersedes the original NorthsideCollectibles/northside-app repository; earlier upload blockers below refer to that old destination.

**Published and verified:** all 270 project files are on `main` in [Cookarelli/northside-app](https://github.com/Cookarelli/northside-app). Import commit `8ad61a8fc00cf911b71ea58bbcab22a8954b8173` has the exact same Git tree (`472aac4faafad2b8d79ebf1d2b73c27a5f268935`) as local checkpoint `0476f7b1d5b1eef298a1feb9dde3b295a6f88172`, including binary icons/WASM and executable file modes. Steve explicitly confirmed public publication of the source and infrastructure references; credentials and saved customer fixtures were excluded. The connected GitHub API performed the upload because Terminal Git has no HTTPS credentials. Local `main` now tracks `origin/main`; the original stage-by-stage development history remains on `local-stage-history` and in an ignored local Git bundle. The previous remote is retained as `legacy-origin`. Publishing source did not deploy the app or activate integrations.

The source project is `outputs/northside-app` inside this Codex task, not the enclosing task folder. The handoff includes all ten implemented stages, tests, versioned migrations, supplied logo, setup/release docs, the presentation briefs and website asset review. Local secrets, dependencies, build outputs, logs and saved sample customer databases remain ignored. No app feature, Shopify product or hosted deployment is changed by the repository handoff. Fresh build/test evidence from today's presentation smoke test remains applicable because subsequent changes are documentation only.

## Website product and image review — September 16, 2026

The user requested a review of Northside's existing website for products and imagery suitable for the app. The supplied misspelling did not resolve; the existing Northside site at https://www.northsidecollectibles.com was inspected in the browser. Its storefront uses Square Online/Weebly, distinct from the app's planned Shopify commerce authority.

Added [visual asset review](WEBSITE-ASSET-REVIEW-2026-09-16.md) and [source inventory](WEBSITE-ASSETS-2026-09-16.json): nine selected product/image candidates, three service/brand graphics, source links, loaded dimensions and dated website prices. Recommended six starter product photographs across baseball, basketball, football, UFC, Pokémon and supplies. This is a selected reference inventory, not a complete product export or live stock verification; Shopify mappings remain unknown.

Recorded content differences for the design pass: website grading form lists PSA/SGC while the earlier BGP reference remains unconfirmed; website consignment terms describe full hammer-price payout whereas preview fee amounts are fictional; the homepage still shows a May 102% promotion, which should not be reused as current. The approved clean app SVG remains unchanged despite the website's partner-mark logo variant. No application code, local operational records, website, Shopify catalog, business rules, provider connections or public feature gates were changed. No source media was installed into the app. The six image references are visible in the review document.

## Presentation smoke test — September 16, 2026

The user requested a smoke test and executive brief for a presentation in 15 minutes, after covering the Marketing Hub yesterday. **The rehearsed local presentation path passes; no presentation-blocking defect was found.** This is a local preview result, not a live-launch approval. No application code, saved operational records, Shopify products or public feature flags were changed.

- Fresh `pnpm release:check` passed: type checking, lint, 150 automated tests (10 policy/PWA/CLI + 140 TypeScript), production build and 23 client artifact secret-configuration checks.
- All nine existing production HTTP smoke suites passed against a temporary local production server on port 3001, with deliberate fixture opt-in still rejected. The read-only staging script passed 29 checks against that same local server; no remote staging verification is implied.
- 31 read-only HTTP checks against the presentation preview passed: 19 page routes, saved sample grading/consignment/loyalty/break data, calendar output, denied cross-customer grading and consignment details, and disabled scan/aisles/pickup routes. Sample A retained 10 grading cards, sample B 2, with disjoint ownership; sample A retained 3 consignment items.
- Browser rehearsal covered Home, Account, My Cards overview, saved grading/detail/account switching, consignment detail, Rewards, Breaks/detail, staff intake form, Integration health, product search, unavailable variant and cart add/quantity/remove. Two $85 sample units produced $170; cart restored to empty. No operational form was submitted or reward exchanged.
- No warning/error entries were captured in the inspected in-app browser session. Home screenshot and DOM measurement showed no overflow/error overlay at the actual 300px viewport. Requested 390px sizing was not honored by the in-app panel; Chrome automation was blocked by an open extension UI. Fresh 390px/1280px and physical-phone verification were not claimed. Earlier September 12 layout evidence below remains historical.
- The preview server was already running. An initial sandboxed connection probe failed; the authorized loopback probe and browser confirmed HTTP 200. An attempted second start correctly exited with port-in-use; the original server/data were preserved. The temporary production test server was stopped after checks; the presentation preview remains on port 3000.

Deliverables: [one-page executive cue card](EXECUTIVE-CUE-CARD-2026-09-16.md) and [full speaking brief, Q&A and restart command](EXECUTIVE-DEMO-BRIEF-2026-09-16.md). The talk track focuses on collector value, operational clarity and custom loyalty, with only a brief bridge to yesterday’s Marketing Hub discussion. The dedicated design pass is still due.

Fresh local evidence is retained in ignored `work/presentation-release-check-2026-09-16.log`, `work/presentation-production-smoke-2026-09-16.log`, `work/presentation-staging-smoke-2026-09-16.log` and `work/presentation-preview-smoke-2026-09-16.log`.

## Release status carried forward

**Prompts 1–10 are implemented and locally validated. The local functional work and release handoff are complete. Customer launch remains blocked on external configuration and verification; no deployment, Shopify change, live payment/reward, message or store activation was performed.**

## Prompt 10 handoff — locally complete

The user authorized “prompt 10 please.” The complete project documentation and prompt pack were reviewed. Working architecture and saved data were preserved. No new migration or dependency was needed.

- Fixed setup CLI error handling to withhold arbitrary provider/driver details, with synthetic-secret regression coverage.
- Fixed the rewards error screen's touching account/retry controls; keyboard retry now visibly progresses and disables repeated requests until completion.
- Expanded staff Integration health with honest provider status and named setup actions.
- Added Node 24.x/Vercel configuration, complete environment inventory, migration/rollback and database/Storage backup-restore runbook, loopback production test runner and a remote-safe anonymous GET staging smoke script.
- Added the all-ten-prompts requirements matrix, staff quickstart, launch checklist with input owners, later native/Hobby Key account-linking/install boundaries, and concise release report. Earlier stage documents now link to the current handoff.

Final checks on the final build: **typecheck PASS; lint PASS; production build PASS; 150 automated tests PASS; 105 production HTTP checks PASS; 29 read-only staging smoke checks PASS locally; 23 client artifacts passed the server-secret configuration scan; git diff --check PASS.** New tests apply all SQL migrations in order without business/demo seeds and restore an isolated backup while preserving reserved points, table counts, customer scope and immutable history. Actual hosted Supabase/Auth/Storage restore remains pending.

Browser review measured 390px mobile and 1280px desktop without horizontal overflow for an unusually long saved sample card description. Visible grading/expanded engagement inputs were labeled; Enter and ArrowRight controls worked. A temporary read-only proxy delayed built-production reads by 3.5 seconds and simulated an interrupted connection; the UI retained an honest loading/error/sign-in state with no invented balance. Corrected retry spacing and progress were inspected. This is desktop browser evidence, not real phone or integration verification. The dedicated design pass was not performed.

One new clearly labeled SAMPLE long-description grading intake was saved for release review (one physical card; $5 examination subtotal). Existing grading/consignment/loyalty/break/store/engagement records remain in ignored work/grading-preview/. No reset or production sample import occurred. Original logo, migrations, lockfile and all three Shopify inventory pools are preserved; all six public feature flags remain false.

[RELEASE-REPORT.md](RELEASE-REPORT.md) records exact results/limits; [REQUIREMENTS-MATRIX.md](REQUIREMENTS-MATRIX.md) links each prompt to evidence; [DEPLOYMENT.md](DEPLOYMENT.md), [ENVIRONMENT.md](ENVIRONMENT.md), [BACKUP-RESTORE.md](BACKUP-RESTORE.md), [STAFF-QUICKSTART.md](STAFF-QUICKSTART.md) and [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) are the handoff. [NATIVE-AND-HOBBY-KEY.md](NATIVE-AND-HOBBY-KEY.md) records deferred phases.

Local preview: **http://127.0.0.1:3000/**. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

## Next actions and design reminder

The requested design milestone has been met: **return for a dedicated design pass now**, covering hierarchy, typography, spacing, imagery, mobile navigation and brand consistency before launch. The existing northside-design-pass-reminder was paused after this handoff reminder so it does not repeat; no duplicate reminder was created.

The next external priority is Steve restoring Supabase/Vercel access and choosing a stable protected HTTPS staging origin, then verifying real customer/staff identity and private files. The September 16 GitHub handoff above supersedes the earlier repository access blocker. Actual checkout, webhook/scheduler/parallel-worker/restore tests, Joey's economics, Fanatics coverage, real streams and physical-phone/store checks remain waiting. Only earlier public Shopify discovery reads are externally verified; no credentialed provider connection is claimed. Account recovery can proceed separately from reviewing the local design.

Historical stage handoffs below preserve what was tested at each earlier checkpoint. Their counts and stage-specific limitations are historical; the current matrix/report above supersede old next-stage references.

## Prompt 9 historical handoff

The user explicitly authorized “begin prompt 9 please.” Installation/offline support, service notifications, reusable show/interest pages and consent-aware measurement are implemented locally. No email or push was sent, Shopify product changed, hosted migration/deployment performed, Marketing Hub modified, or GitHub upload attempted. Provider login can still wait for local review. Public purchase, loyalty earning/redemption, barcode, aisle and pickup flags remain false. At that checkpoint Prompt 10 had not started; see the completed release handoff above.

Implemented:

- Approved Northside logo rendered intact into 180/192/512 PNG icons, standalone manifest, public offline fallback and explicit update/reload control. A six-file public allowlist is the only service-worker cache. Private pages, APIs/RSC, customer images, account/cart secrets and checkout are never cached. Sign-out uses a prepaint screen lock, cross-tab signals, server revocation and history-restore reloads.
- Migration 009 adds customer-specific preferences, encrypted verified-email/push contacts, generic in-app notifications, transactional status/reminder triggers and durable leased jobs. Changed break times replace pending reminders; opt-out/cancellation invalidates queued work. Bounded workers support retries, deduplication, failed/manual review and explicit UNSENT logs. Resend and standards-based web-push adapters are implemented but remain unconfigured and disabled. Provider acceptance is never described as confirmed device delivery.
- Northside show landings and separately gated HobbyKey interest capture, with event/placement IDs, separate follow-up consent and unset unknown dates/locations. Staff can edit show details and remap stable printed QR URLs. Approved lowercase source/medium/campaign/content fields remain attached to their original placement; sample SVG labels are visibly marked.
- Optional browser-specific analytics stores first/latest eligible observed touches, timestamps and consent. Verified new signup, useful authenticated activation, saved reminder, owned grading view, product view, checkout initiation, install-prompt acceptance and purchase remain distinct. A signed-in browser cannot inherit analytics consent from another browser. Order-ledger changes queue an independent Shopify read/reconciliation worker; order ID deduplication and stale-snapshot protection preserve refund adjustments and unmatched orders.
- Staff metrics and CSV provide UTC dates, authorized tenant, source/campaign filters, definitions, last sync, unmatched attribution and refunds. Shopify web/POS/unknown channels remain separate from recorded legacy break-payment evidence; unknown legacy refunds are not invented. Consignment payouts are excluded from retail/marketing revenue. The Marketing Hub export contract has no private customer/service payloads and does not assume a live connection or automatic pixel coverage.

Validation on September 12, 2026:

| Check | Result |
| --- | --- |
| Type checking, lint, production build, whitespace/diff check | PASS |
| Full automated suite | PASS: 146 tests (8 policy/PWA + 138 TypeScript), zero failures |
| Existing production regression + Prompt 9 smoke checks | PASS: 105 checks, including 18 new PWA/engagement checks. Used port 3001 with fixtures disabled and the suite’s non-secret `APP_ORIGIN=https://local-test.invalid`; this test origin is not a deployment. |
| Actual local HTTP checks | PASS: stable QR retained 127.0.0.1 and approved UTMs, labeled SVG download, sample A/B inbox isolation, denied cross-account notification read, CSV labels/refunds/unmatched fields with no private identifiers |
| Browser workflows | PASS: A’s generic notice and B’s empty inbox, unsupported/unconfigured push fallback, explicit update/reload, sample worker UNSENT results, show redirect, consented `.invalid` HobbyKey interest submission, staff filters and labeled forms |
| Layout | PASS: inspected 390px mobile and desktop; no page overflow, tables scroll within their own containers, visible labels for form controls |
| Real browser offline recovery | PASS in the Codex in-app browser: stopped the local server, reloaded `/account/notifications`, saw only the public “You’re offline” page with no customer records, restarted, and recovered the account view |
| Real phones / live services | PENDING: Safari/iPhone and Android Chrome installation, physical shared-device logout/history behavior, push permissions and delivery, real email acceptance/delivery, Supabase role/migration verification, Shopify verified checkout/order evidence and hosted scheduler |

Concrete issues fixed during review: a Next route URL normalized the sample QR redirect to localhost instead of the required 127.0.0.1 host; loading initially resembled a sign-in error; consent display could stay stale on sample account change; account activity initially looked up another browser’s consent; the update worker could reload on first activation or interrupt its caller’s logout; job display initially confused retry availability with the original scheduled time. Regression coverage and browser checks now cover the relevant boundaries.

Local sample state is retained across restarts. Sample report money is fictional, two seeded paid Shopify examples include one unattributed order and a refund adjustment; legacy records are read separately from their evidence source. Local notification attempts are UNSENT and the test interest submission sent no message. Previously saved grading, consignment, loyalty, break and store fixtures remain intact.

Setup: [SETUP-PROMPT-9.md](SETUP-PROMPT-9.md). Export contract: [MARKETING-HUB-ENGAGEMENT-CONTRACT.md](MARKETING-HUB-ENGAGEMENT-CONTRACT.md). The preview is http://127.0.0.1:3000; start exactly with:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

## Prompt 8 handoff — locally complete

The user’s “next prompt please” authorized future store preparation after Prompt 7. The local stage is complete: editable eight-aisle schematic, product locators, stable server QR registry and SVG/PNG labels, staff camera/manual scanner and an audited pickup rehearsal. No login, hosted migration, deployment, real Shopify change, location transfer, notification, real payment/collection or GitHub push was performed. The account password reset can still wait for local review.

Implemented:

- Migration 008 models aisles 1–8, configurable sides/categories and locator zones, editable path/entrance/counter positions and connections. The actual floor plan remains unknown; the staff drawing is labeled schematic and not to scale, with no invented distances or walking directions.
- Northside Retail Floor, Northside Breaker Storage and Northside Excess Storage remain separate. Product family, provider product/variant, SKU/barcode and physical assignment are separate records. Provider identity, assigned variant, pool identity and printed QR token cannot be rewritten by a move. Customer-safe projections expose only approved active retail locations and never internal QR placement or storage positions.
- Staff QR mappings retain a random opaque token while product, optional variant, placement, campaign and constrained destination can be edited. Live URLs require the eventual verified app domain; no arbitrary redirect field or scanned URL fetch exists. SVG/PNG labels use pinned zxing-wasm 3.1.4 with same-origin, hash-checked WASM; Sharp 0.35.4 preserves the symbol/quiet zone and adds a visible **SAMPLE — NOT FOR STORE USE** caption. No credentials, intake details, prices or stock counts are encoded.
- Staff scanner has opt-in camera permission/error handling, local image decoding, manual entry and product/family/SKU search, duplicate suppression, variant choice and refreshed availability. Actual Shopify publication, SKU/barcode, USD prices and online sellable stock are read-only provider checks when live configuration exists; samples remain fictional. Unknown/unpublished/missing/changed mappings fail safely. The future add control uses the existing gated Shopify cart action and never mutates inventory by scanning. Opaque Shopify Shopcodes remain an optional Shopify link mechanism, not decoded cart items.
- Staff assignments and SAMPLE paid → preparing → ready → collected/canceled rehearsals use authorization, record versions and append-only reasons. Live pickup recording is rejected. Customer scanner/directions/pickup/QR pages and APIs stay disabled. A future public implementation review and physical/checkout verification are required before activation; a flag or environment variable alone does not expose the staff tools.

Validation:

| Check | Evidence |
| --- | --- |
| Build / types / lint | Final production build, TypeScript and ESLint passed. Local writer WASM is included in the production route trace. |
| Automated tests | **125 passed**: 3 policy tests + 122 TypeScript tests, including 14 new store tests. Actual PGlite migration/runtime RLS, wrong roles/tenants, customer isolation, immutable identities, optimistic edits, moved locator/printed-token persistence, malformed/foreign/duplicate/missing-variant scans, stale provider mapping, live-price mocks, pickup transitions/audit and restart persistence. |
| QR generation | Actual captioned PNG and rendered SVG decode back to the exact stable SAMPLE URL using the pinned decoder. Downloaded PNG visually inspected; the original unlabeled-image issue was fixed. No private placement or amount is in either code. |
| Production HTTP | **87 passed** across the existing suites and 18 store checks: public pages/API flags reject; GET/POST fixture routes reject even with opt-in; staff/label APIs require a session; cross-origin writes reject; production shell contains no sample records; local reader WASM is served. Store checks repeated on the final build. |
| Browser / persistence | Saved an aisle label and reloaded; moved the base sample variant to the second retail display; scanned the original QR and saw Aisle 6 with no private storage details. Manual barcode, product search, variant selection, sold-out state and safe foreign-domain explanation inspected. SAMPLE pickup created and advanced to preparing with audit. |
| Desktop / phone | Inspected at measured **1280px and 390px** viewport widths; document width matched viewport. No error overlay in inspected flows. Production showed invited-staff sign-in with no sample data; corrected its link to `/staff/login`. These checks are not physical camera tests. |
| Safety / continuity | All six public flags remain false. Shopify products (Draft), inventory and fulfillment settings unchanged; custom loyalty has no paid plugin. Existing saved grading/consignment/rewards/breaks were preserved. Only placeholder `.env.example` changed; no secret file was created. |

Saved browser samples: Aisle 1 is labeled **SAMPLE sports cards**; the base box variant’s retail assignment moved to **SAMPLE second display**, Aisle 6, while private breaker/excess assignments remain staff-only. The original QR token remains unchanged. **SAMPLE browser pickup** for collector A is at **preparing**. These are fictional preparation records, never a reservation, payment, real floor plan or handoff.

Preview: **http://127.0.0.1:3000/staff/store**. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

[SETUP-PROMPT-8.md](SETUP-PROMPT-8.md) records architecture, exact dependencies/contracts, bounds and demonstration. [STORE-ACTIVATION-CHECKLIST.md](STORE-ACTIVATION-CHECKLIST.md) records the real floor plan, domain, hosted database, barcode/publication, physical iPhone/Android cameras, printed labels, store readiness and Shopify pickup/fulfillment evidence still missing. No current opening date, shelf counts, distances or real pickup readiness is claimed.

GitHub upload still awaits write-capable authentication; no login or push was retried without changed access. The design milestone reminder remains set and was not duplicated. **At that checkpoint Prompt 9 had not started; its completed historical handoff is above.**

## Prompt 7 historical handoff

The user’s “next prompt please” authorized break operations after Prompt 6. The local stage is complete: saved schedules, calendar downloads, in-app reminders, purchased spots, exact Shopify mappings, finite allocation, source-separated legacy evidence and staff exception review. No login, hosted migration, deployment, real checkout/refund, Shopify product/stock/location/fulfillment change or notification was performed. Password reset can still wait for local review.

Implemented:

- Migration 007, persistent staff schedule editor with UTC storage/Chicago display and explicit draft/scheduled/delayed/live/complete/canceled states. Products, host, image, description, named/identical format, capacity, terms and configurable stream/replay URLs are saved with reasoned immutable audit. Version checks prevent lost edits; changing a schedule reschedules owned reminders and closes sale reconciliation. The clock never marks live.
- Home next-break module, schedule/detail screens, external watch links, valid UTF-8/CRLF calendar downloads with stable UID/version, owned saved reminders and purchased spots. Calendar downloads are not subscriptions. Participant display requires a chosen alias and opt-in; withdrawal remains possible after unpublication. No buyer email or private payment evidence enters the public projection. Email/push delivery remains Prompt 9 and no notification is claimed sent.
- Immutable Shopify variant/product/SKU mapping, one-capacity named or finite pooled slots, physical shipping/finite tracked DENY inventory proof and a per-event before-sale checklist. Dedicated and general cart routes share server break checks; neither a cart nor a checkout return establishes ownership. Real purchase gates remain false until the separately authorized Shopify concurrency test and release process.
- Current paid-line reconciliation, verified Shopify customer ownership, duplicate/stale/conflicting snapshot handling, tenant/source/order/line uniqueness and constrained active slot allocation. Unknown/missing/changed lines, conflicting owners, partial/ambiguous refunds and unsupported states enter review. A second exclusive buyer never silently receives the occupied slot. Refunded/canceled capacity stays held; reviewed before-start release is capped and cannot be replayed into a new hold. Started events cannot reopen spots through this app.
- External paid purchases require independent evidence and an exact verified customer/mapping. They occupy capacity, preserve immutable original evidence and remain outside Shopify/loyalty revenue. No refund, transfer or inventory adjustment is initiated. Staff exception resolutions/retries remain separate from provider verification and capacity release.
- Durable break jobs queued transactionally by the existing Shopify order worker, commerce-role processing, per-order/event locks, expiring leases, bounded retry/backoff and failed/review state. The shared normalized current-order reader performs no ledger mixing. The new `breaks:work` command requires configured live credentials; no scheduler or connection was installed.
- Clearly labeled loopback/same-origin local sample persistence in the existing ignored database, preserving prior grading/consignment/rewards. Hosted migration seeds no breaks or allocations. Custom Northside loyalty remains selected with no paid plugin; all six public gates stay off.

Local validation:

| Check | Result |
| --- | --- |
| Build, typecheck, lint | PASS with existing pinned dependencies; no dependency added. Next’s sandbox worker-port restriction was resolved by running the authorized local build with the required process permissions. |
| `pnpm test` | PASS: **111 total** (3 policy + 108 TypeScript), including 17 new break tests and all 94 previous-stage tests. |
| Actual SQL / service tests | Explicit Chicago DST validation, calendar escaping/folding/UID, changed schedule/reminders and optimistic writes; customer/staff/content-editor/other-tenant boundaries; exclusive/pooled capacity, duplicate/competing buyers, refund holds/caps, cancellation-before-paid, missing/unknown lines, anonymous ownership review, legacy evidence/deduplication/revenue separation, immutable identity/slot limits, worker lease/retry/crash recovery and database close/reopen persistence. |
| Production HTTP checks | PASS: **69 total** (58 previous + 11 breaks). New shells are no-store without sample records; fixture GET/POST return 404; private reads require a session; cross-origin writes fail; disconnected public schedule never substitutes samples; real spot purchases remain disabled. |
| Browser workflows | Saved reminder/alias, reloaded, created and reopened an unpublished draft, edited the original event/date/status, simulated A/B competing paid orders and refund A. A retains a refunded hold; B is in review with zero capacity. A→B switching removes A’s reminders/private records. No error overlay in inspected flows. |
| Calendar HTTP | Actual saved download has stable event UID, SAMPLE label, tentative delayed status and September 20 00:00 UTC start for September 19 7 PM Chicago. |
| Desktop / phone | Inspected schedule/staff at 1280px and staff/customer at 390px. Measured document width matches viewport; no horizontal overflow. Fixed wrapped tab spacing, saved-draft selection and reviewed-purchase wording. Production view shows a disconnected schedule without fixtures. |
| Safety / files | Shopify products and inventory pools unchanged; only placeholder `.env.example`, no server credential names in client JS, and clean whitespace check. Saved sample data remains ignored under `work/`. |

Browser samples left available: published delayed **SAMPLE Northside card break**, September 19, 2026 at 7 PM Chicago; A’s 6:45 PM saved in-app reminder and refunded-but-held North spot; B’s competing North spot purchase in review; one unpublished **SAMPLE draft — browser validation**. These are fictional records, not promises or real commerce.

Preview: **http://127.0.0.1:3000/breaks**. Staff: **http://127.0.0.1:3000/staff/breaks**. My breaks: **http://127.0.0.1:3000/account/breaks**. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

[SETUP-PROMPT-7.md](SETUP-PROMPT-7.md) records implementation, supported bounds, worker/rollout order and provider contracts. [BREAK-SALE-CHECKLIST.md](BREAK-SALE-CHECKLIST.md) records required per-event reconciliation and the real last-spot checkout matrix. PGlite serializes local transactions: local competing promises and uniqueness tests are **not proof of actual Shopify/Postgres concurrency**. Real stream URLs, inventory pools/physical fulfillment, hosted migration/RLS/workers/restore, actual calendar clients and Shopify payment/refund/concurrency tests remain unverified. Purchasing stays disabled.

GitHub upload still awaits write-capable authentication; no login or push was retried without changed access. All future in-store features remain disabled. The design reminder is set for the functional-completion milestone described above. **At that handoff, Prompt 8 had not started; see the completed Prompt 8 section above.**

## Prompt 6 historical handoff

The user’s “next prompt” authorized custom Northside loyalty after Prompt 5. The three passes are locally complete: ledger and earning; Shopify issuance/recovery; wallet, tiers and reporting. No login, hosted migration, deployment, real Shopify discount/payment/refund, inventory/product edit, message or paid loyalty plugin was performed. Account password reset is not needed for this preview.

Implemented:

- Migration 006, a separate least-privileged loyalty worker role, verified account enrollment, immutable rule/approval versions and original line eligibility allocations, signed append-only ledger with reconciled cache, cumulative line refund/edit/cancellation reversals and rolling eligible-spend tiers. Unknown ownership/monetary allocation stays in review; original launch/enrollment dates prevent automatic backfill. Debt remains negative and blocks new redemptions.
- Server-priced, owner-bound transactional reservations and durable leased jobs. Stable high-entropy codes, lookup-before-create, exact supported Admin response validation and atomic confirmed voucher/debit completion handle uncertain timeout, crash and duplicate workers. Definite initial failure can release a hold; uncertainty cannot. Actual paid usage is recorded independently from issuance.
- Fixed USD customer-eligible rewards with explicit product/collection scope, minimum eligible spend covering the full reward, one use, approved expiry and restrictive combinations. Owned cart application uses supported Storefront calls and authoritative applicability. A future configured-shop POS link helper is prepared internally; public QR/scanning stays disabled. The real cart route remains gated.
- Audited manual corrections, disputes, reward suspension, failed-job review/retry and capped reward restoration. Unused cancellation requires confirmed deactivation plus independent pending/paid checkout clearance; abandoned carts, expiry or zero asynchronous usage count do not return points. Used-reward refund restoration stays separate from earning reversal; no automatic restoration is enabled.
- Persistent customer wallet and staff rewards desk, configurable Rookie/Vet/HOF/GOAT tiers, source/period-defined analytics, separate issued/used/discount metrics, explicit assumed exposure, reconciliation and a small-cohort-suppressed aggregate Marketing Hub CSV contract. No live marketing connection or personal-record export is claimed.
- Loopback-only clearly labeled saved sample wallets and a local discount simulator in the existing ignored database. Sample A/B ownership is isolated. Fictional approval never counts as Joey’s actual approval; hosted migration seeds no economic rules or reward balances. All six public gates remain false.

Final local evidence:

| Check | Result |
| --- | --- |
| Build, typecheck, lint | PASS with existing pinned dependencies; no dependency added. Final build includes the corrected zero-point wallet label. |
| `pnpm test` | PASS: **94 total** (3 policy + 91 TypeScript; 70 prior-stage tests + 24 loyalty tests). |
| Ledger / real SQL service tests | Duplicate events, cumulative refund partitions, cancellation/stale reads, line removal/increased/malformed edits, exclusions, original snapshots, prelaunch/pre-enrollment/anonymous claims, signed zero/debt, cache mismatch, audit/immutability, actual other-tenant RLS and database restart. |
| Issuance / restoration tests | Concurrent requests through PGlite’s serialized transactions, timeout/code lookup, remote-success-before-commit crash, lease takeover/old-worker refusal, definite versus uncertain failure, wrong-owner/reused voucher, manual partial/refund restoration caps, confirmed cancellation and late paid usage review. Real multi-connection PostgreSQL concurrency is pending. |
| Shopify contract tests | Mocked 2026-07 Admin customer context/amount/minimum/scope/expiry/stack validation, deactivation expiry change, userErrors/uncertainty, paid line net/refund data and Storefront customer/applicability. These are not real checkout tests. |
| Production HTTP checks | PASS: **58 total** (previous 48 + 10 loyalty). No-store/no-sample shells, fixture GET/POST 404 despite fixture opt-in, private wallet/staff/export/reconciliation 401, cross-origin exchange 403 and real reward-cart application 503. Local fixture cross-origin writes also returned 403. |
| Browser workflow | A: 1,250 → hold 500 with 750 spendable → simulated uncertain timeout preserving hold → one recovered SAMPLE voucher/-500 debit, ending 750 points and zero hold; reload persisted it. B: isolated not-enrolled view → enrolled zero wallet with exchange disabled. Staff saved version 3 at 11 points/dollar as an inactive SAMPLE draft, leaving active sample version 2 unchanged. |
| Desktop / phone | Wallet and staff reports inspected at 1280px; wallet at 390px measured document/viewport 390/390 with no horizontal overflow. Long code wrapped; label contrast and zero-point wording corrected. Production wallet showed Program not launched / sign in required and no samples. |
| Reconciliation | Saved [fictional JSON checkpoint](loyalty-local-checkpoint.json): 2 accounts, zero consistency issues, zero negative accounts, 750 outstanding points, zero holds, one issued voucher and zero recorded uses. [Detailed evidence/recovery report](LOYALTY-RECONCILIATION.md). |
| Worker / files | With both live gates off, worker returned program_not_launched and zero attempts without configured credentials/provider calls. Only `.env.example`; server credential configuration names absent from client JavaScript; `git diff --check` clean. Sample database stays ignored under `work/`. |

Concrete fixes during review: cache updates only after actual ledger inserts; repeated reconciliation cannot bypass enrollment date; unsupported/increased lines enter review before any partial award; uncertain worker attempts no longer claim successful issuance; shortened Shopify deactivation expiry is reconciled; account switching clears previous customer data; dark-card label contrast, zero-point wording and narrow voucher wrapping verified.

Wallet: **http://127.0.0.1:3000/rewards**. Staff: **http://127.0.0.1:3000/staff/rewards**. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

See [SETUP-PROMPT-6.md](SETUP-PROMPT-6.md) for demonstrations, economic approval, roles/jobs and hosted setup; [LOYALTY-RECONCILIATION.md](LOYALTY-RECONCILIATION.md) for invariants, recovery and real-checkout matrix; [MARKETING-HUB-LOYALTY-CONTRACT.md](MARKETING-HUB-LOYALTY-CONTRACT.md) for aggregate export definitions and limitations.

Remaining external work: hosted migrations/roles/RLS/parallel-worker/restart/restore; real Shopify customer/discount scopes and supported checkout behavior (other customer, eligible minimum, combinations, refunds and cancellation races); actual Joey approval and effective date; eventual POS verification. All real economic rules remain inactive. Supported policies currently mean rolling tiers, no point expiry, manual reward restoration and no product/order stacking; other policies require implementation before approval. Tax-inclusive, test, subscription, ambiguous-refund and unsupported payment states do not earn automatically. Bounded/truncated reads retry into review. Wallet/staff history lists have documented limits. No birthday, referral or social awards, physical scanner or live Marketing Hub delivery was added.

GitHub upload remains pending write-capable authentication: prior Git credentials were absent and connected Cookarelli lacked repository push permission. No login or push was retried without changed access. Shopify Draft products, retail/breaker/excess pools and all fulfillment/location settings are unchanged. Prompt 7 was subsequently authorized and implemented; see the current handoff above.

## Prompt 5 historical handoff

The user's “next please” authorized consignment after Prompt 4. Local work continued without a password reset or dashboard login. No hosted migration, deployment, partner request, email, money transfer, Shopify change or paid plugin was performed.

Implemented:

- Persistent staff consignment intake and customer-owned item/history screens, with permanent Northside intake/card/item IDs, received date, images, channel, provider/submission/listing references, customer notes and all requested operational states. Northside updates and reviewed source timestamps are labeled separately; history and private before/after audits are immutable.
- Explicit USD integer cents, unknown versus confirmed zero, evidence-required sale amounts and estimated net only when sale and total fees are known. Sold never implies paid. Individually verified settlement references support partial/full settlement, a confirmed zero-net case and immutable compensating reversals; duplicate references, excess settlement and financial edits over active settlements are rejected. These records cannot send money or write retail/loyalty revenue.
- Saved CSV column mapping, validation, incoming/current-value preview and staff review queue. Unmatched rows require independently verified exact customer/item approval; email/title are never ownership proof. Stable source/external IDs, fingerprints, source timestamps and row versions protect against duplicates, stale data and overwriting later manual corrections. Commit rechecks ownership/version and applies the reviewed batch atomically. Sanitized sample CSV and formula-safe customer-scoped exports are included.
- Migration 005 extends existing consignment records and adds events, private audits, settlements, approved external mappings and import rows. Explicit customer filters, actual RLS and composite ownership keys protect data; content editors cannot read it and read-only staff cannot mutate it. Private images reuse the existing validated upload and short-lived authorized download path.
- `FanaticsCollectAdapter` with explicit capabilities and a disconnected implementation. Every provider capability remains unavailable; manual records and reviewed imports work independently during disconnection/outage. Actual connector identity, contract version, authentication, scopes, limits, field coverage and live test evidence remain unknown. Proposed normalized types do not claim provider support. [FANATICS-DATA-REQUEST.md](FANATICS-DATA-REQUEST.md) is drafted and **not sent**.
- The explicitly fictional local consignment workspace shares the existing ignored grading database, preserving prior grading data. Sample writes require loopback/same-origin requests and non-production fixture opt-in; production denies the fixture route even with opt-in set. Live private routes never substitute samples.

Final local validation:

| Check | Result |
| --- | --- |
| Build, typecheck, lint | PASS with existing pinned dependencies; no dependency added |
| `pnpm test` | PASS: 70 total (3 policy, 24 Prompt 2, 18 Prompt 3, 13 grading, 12 consignment) |
| Actual SQL/service consignment tests | Stable intake IDs/idempotency, unknown/zero amounts, partial/full settlement and reversal, duplicate references, forbidden role/ownership changes, customer and different-tenant RLS, exact reviewed matching, duplicate/stale/conflicting imports, concurrent manual edit protection, preserved blank optional values, outages, file isolation, formula-safe export and database close/reopen persistence |
| Production HTTP smoke checks | PASS: 48 total (14 original, 9 auth, 10 commerce, 6 grading, 9 consignment). New shells have no-store/no samples; fixture GET/POST return 404; private item/import/file/export reads require a session; cross-origin settlement writes return 403 |
| Browser workflow | Created a SAMPLE intake; pasted CSV, mapped/read columns and saved an unmatched review; approved the exact sample B ownership with evidence and committed the import. The saved row shows applied and appears only in B's customer view |
| Desktop / phone inspection | Staff/customer screens inspected at desktop 1280px and customer 390px. Unknown fees/net and $100 sale / $20 fees / $80 estimated net / $30 partial settlement displayed correctly. Switching A→B removed A's cards. Document width measured 390px with no horizontal overflow; no error overlay in inspected flows. Production customer view showed sign-in required without samples |
| Files / secrets | Only `.env.example`; no real credentials. Server credential configuration names absent from client JavaScript. `git diff --check` clean. Local database remains ignored under `work/` |

Concrete fixes from review: kept the same intake request ID through an uncertain retry, rejected duplicate settlement references under a transaction lock, protected manual corrections with import snapshots/versions, preserved known values when optional CSV cells are blank, replaced the obsolete live consignment status presentation, and wrapped long record identifiers on narrow screens.

Staff preview: **http://127.0.0.1:3000/staff/consignment**. Customer preview: **http://127.0.0.1:3000/my-cards/consignment**. Browser validation added clearly labeled SAMPLE records; the initial unknown-fee and partial-settlement examples remain available. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

See [SETUP-PROMPT-5.md](SETUP-PROMPT-5.md) for the demonstration, CSV contract and hosted checklist. Migration 005 has run locally only. Real customer/staff authentication, hosted RLS/Storage delivery and expiry, staging restart/restore and real-phone cache behavior remain unverified. Browser CSV paste/review was exercised; the native file picker was not. Lists are bounded to 300 items, 500 customers and 50 import batches; larger historical pagination/reporting is not implemented. Imports can update existing financial records, so corrections are explicit audited item/settlement operations rather than a bulk rollback. There is no live Fanatics feed or payout integration.

GitHub upload remains pending write-capable authentication; no login or push was retried without changed access. All six public gates remain false, Shopify Draft products and the three inventory pools are unchanged, and custom Northside loyalty remains selected with no paid plugin. Prompt 6 was subsequently authorized and implemented locally; see the current handoff above.

## Prompt 4 historical handoff

The user's “next prompt please” authorized grading after Prompt 3. No password reset or dashboard login was required. No cloud migration, deployment, email, live provider grading call, Shopify mutation, payment or paid plugin was performed.

Implemented:

- Saved staff intake and customer grading screens with unique physical-card IDs; default 500-cent examination rate, per-intake version/rate snapshots, full-intake subtotal from SQL, metadata, findings, customer notes, images and per-card result/certificate references. Three physical cards show $15 examination subtotal, with external charges unquoted.
- Editable owner/admin rate and status configuration; canceled/on-hold/exception paths; immutable milestone and private audit history with actor/source/time/reason; optimistic version checks. Rate changes and intake/import creation serialize so an approved import cannot mix rates. All grading milestones are Northside recorded; no provider verification or turnaround promise is invented. PSA is configured and BGP remains internal/unconfirmed.
- Authenticated submit/return requests at Awaiting customer decision, persisted once without implying physical shipment/receipt/return or charge authorization. Receipt contacts can predate online activation. Hashed, expiring receipt codes grant no access until independent staff receipt/identity review approves a verified Shopify account for that case only.
- Shared staff-only batches with references, carrier/tracking, selected-card event propagation and partial returns/exceptions. Customer SQL/service scopes exclude other owners, batch details/totals and private reasons. Live claimed-case file downloads reauthorize ownership before short-lived Storage signing; uploads use existing validation and audit successful attachments.
- Mapped and bounded CSV intake, saved row preview, exact customer IDs, permanent source/external IDs, reviewer confirmation, atomic deduplication and safe reversal before later activity. Reversal preserves events and external IDs. Sanitized template supplied; exports neutralize spreadsheet formulas.
- Separate examination reference records: verified owned/claimed Shopify order links never invent a payment or copy order revenue; staff external payment references include source/date/amount and reject duplicate references. No order ledger write, points, voucher or grading charge is generated.
- Durable, explicitly fictional local grading workspace using the same services/RLS against ignored PGlite filesystem storage. Fixture route is loopback/non-production only and denies cross-origin writes. Production cannot enable it. Original in-memory shopping demos remain separate.

Validation on this Mac:

| Check | Result |
| --- | --- |
| Build, typecheck, lint | PASS with compatible existing pinned versions |
| `pnpm test` | PASS: 58 total (3 policy, 24 Prompt 2, 18 Prompt 3, 13 grading) |
| Actual SQL/service grading tests | Intake IDs/$15 snapshot, future-rate preservation, shared privacy/partial returns, decision eligibility/idempotency, denied customer/editor/read-only writes, receipt claim review, CSV validation/deduplication/reversal, payment separation/verified claimed-order ownership, formula-safe export, file ownership and close/reopen persistence |
| Production HTTP smoke checks | PASS: 39 total (14 original, 9 auth, 10 commerce, 6 grading). Production fixture API 404, private grading 401 without session, cross-origin mutation 403, no-store shells; all future/public gates remain off |
| Local HTTP / browser | Same-origin sample intake and image attachment saved; customer return request persisted as Return requested; switching to B displayed only B's cards. Sanitized CSV preview prepared through the API, then its saved row review and confirmation exercised in the browser. Sample cross-origin POST denied with 403 |
| Desktop / phone inspection | Desktop 1280px and customer phone 390px inspected; no horizontal overflow measured at 390px. Sample labels and examination-only subtotal visible. Fixed a wrapping import-table header. No error overlay in the final inspected flows |
| Files / secrets | Local database under ignored `work/`; only `.env.example`, no real credential file. Server credential configuration names absent from client JavaScript. No Shopify product, stock or fulfillment changes |

Concrete fixes: corrected local fixture request validation for Next's internally normalized hostname while keeping a strict loopback Host/origin check; removed stale “no persistent edits” copy; used SQL for complete intake totals; separated legacy consignment presentation from current grading status; allowed verified approved claimants' owned Shopify order links; serialized rate changes with import/intake creation; fixed test typing and a narrow table header.

Staff demonstration: **http://127.0.0.1:3000/staff/grading** → New intake → save three SAMPLE cards → Cards → findings/status/image → customer decision → shared batch/selected return → Imports preview/review/commit/reverse. Customer demonstration: **http://127.0.0.1:3000/my-cards/grading** → Sample collector A → a card awaiting decision → request submit/return → switch to B to verify isolation. The original initial sample may already show a decision from validation; staff can append an audited correction to Awaiting customer decision to repeat the demo. Details, receipt claims and exact hosted checklist: [SETUP-PROMPT-4.md](SETUP-PROMPT-4.md).

Exact local start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

Remaining external checks: apply migration 004 with earlier migrations to hosted Supabase; verify real staff/customer sessions, claims, private Storage uploads/download expiry, actual owned Shopify order linkage and hosted restart/backup/restore on a private staging environment. Actual phone authentication/Storage and native CSV file-picker interaction were not verified. Operational lists are bounded; larger-list pagination/reporting and provider status/payment imports are not implemented. Live grading APIs are optional and absent. Local filesystem storage is for samples only and requires one preview process per directory.

GitHub upload is still pending write-capable authentication: the previously connected account lacks push permission. No login was retried. All six gates remain false; Shopify Draft products and the three inventory pools are unchanged. Custom Northside loyalty remains selected with no paid loyalty plugin. Prompt 5 was subsequently authorized and implemented; see the current handoff above.


## Prompt 3 historical handoff

The user said “continue” after the Prompt 2 local handoff; Prompt 3 was announced and implemented next. Account password resets were not needed for this local work. No dashboard login, provider installation, cloud migration, deployment, Shopify product publication, stock change, fulfillment change, payment, staff email or paid loyalty plugin was performed.

Implemented:

- Server-only Shopify Storefront catalog, collection browsing, escaped search/category filters, cursor pagination, product/variant details and online availability. Public products come exclusively from Storefront; missing access and empty Draft catalogs have separate honest states. Fixtures never substitute for live data.
- Typed cart services for add/update/remove, authoritative Shopify amounts/discount applicability, aggregate quantity and stock rechecks, guest and verified-customer buyer identity, and fresh Shopify-hosted checkout URLs. Browser prices, raw cart IDs, buyer tokens and customer IDs are rejected. Cart and raw line identifiers stay off the client; encrypted durable cart handles enforce bound customer ownership. Public cart/checkout routes remain disabled by the purchase gate.
- Existing preview preserved and improved: URL-backed search/category/page survives product navigation, two sample pages, an explicit sold-out sample variant, sample order history behind sample sign-in, and a detailed fixture integration-health page. All merchandise, prices, customer records and order states remain labeled examples.
- Verified Customer Account profile/order history with pagination, customer-ID binding from the authenticated provider response, and local order reads protected by both server ownership filters and actual RLS. No email matching or cart-based order claims. Logout clears cart and campaign cookies too.
- Migration 003 introduces a separate least-privileged commerce role, cart storage, customer mappings, durable jobs, current order snapshots, immutable order ledger and consented opaque campaign references. Only Northside is a production tenant; the second tenant and all test orders are test-only.
- Raw-body webhook HMAC, exact shop/topic checks, bounded input, receipt/job transaction and delivery deduplication. Bounded worker CLI uses leased jobs, crash recovery, retries and per-order locking before reading current authorized Shopify state. Refund/cancellation state survives late paid notifications. A checkout return never produces a paid order.
- Redacted staff integration status; pinned 2026-07 config; same-organization Admin credentials require verified eligibility, and installed OAuth requires an unexpired grant from a supported external installation/token-management path. No legacy permanent-token assumption. Optional campaign consent records first/latest eligible opaque references for Shopify cart attributes without personal URL data.

Final local evidence:

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS; production build includes all new routes |
| `pnpm test` | PASS: 45 total — 3 policy, 24 Prompt 2, 18 Prompt 3 |
| Storefront/customer/Admin contract tests | Mocked provider responses exercise unavailable/draft/zero/unknown stock, quantity aggregation, tampered prices/identity, expired cart, line ownership, guest/customer checkout, URL allowlist, version/config/IP checks, provider errors, order scope and Shopify financial totals |
| Actual SQL/service tests | Migrations 001+003 run on PGlite with duplicate receipts, refund-before-paid convergence, immutable ledger, stale-state refusal, retry/lease/crash recovery, old-worker rejection, customer/tenant isolation, role separation, encrypted cart ownership/expiry and consented first/latest references |
| Production HTTP smoke scripts | PASS: 33 checks — 14 original, 9 auth, 10 commerce; no fixtures, no-store, future routes absent, private records denied, all cart mutations gated and unconfigured webhooks not acknowledged |
| Browser inspection | Desktop 1280px and phone 390px; search/category→product→back retained values; sold-out sample button disabled; sample quantity 2 showed $170 example subtotal; signed-in sample order history and health screens inspected. Production catalog and order-history disconnected states inspected. No horizontal overflow on inspected screens and no error overlay during those flows |
| Client bundle / working tree | Server credential configuration names absent from `.next/static` JavaScript; only `.env.example` exists; `git diff --check` clean |
| Public Shopify discovery | Actual unauthenticated endpoint read confirmed `https://shopify.com/103967392113/account/customer/api/2026-07/graphql`; this does not prove a customer login or API grant |

Concrete fixes from review: removed raw cart and line identifiers from client projections, rejected browser price/identity fields, prevented checkout/update from creating an accidental replacement cart, bound authenticated checkout to its customer, retained refund state during stale deliveries, recovered expired worker leases, clamped invalid sample page numbers, removed inaccurate live staff/demo-cart labels, and clarified real versus sample order-history copy. Existing compatible dependency versions were preserved; no new dependency was needed.

External gaps are explicit in [SETUP-PROMPT-3.md](SETUP-PROMPT-3.md): hosted migrations/roles, real OAuth/profile/orders, actual channel access and a separately approved selected test catalog, installed Admin access/rotation, real guest/customer checkout and buyer IP, webhook delivery and scheduled worker, Shopify cart-to-order campaign preservation, and fulfillment routing across the three distinct pools. No scheduler is deployed. The installed-OAuth option intentionally relies on an external supported token-management path; that installation/rotation is not implemented or verified here. Browser emulation is not real-phone checkout evidence.

All six gates remain false: purchases, loyalty earning, loyalty redemption, scanning, aisle navigation and pickup. No points/vouchers were issued. The order ledger is financial state, not the future loyalty allocation engine. Retail, breaker and excess pools and all Draft products remain unchanged.

GitHub upload remains pending the previously identified access issue: Git lacks HTTPS credentials, and connected account Cookarelli has no push permission for NorthsideCollectibles/northside-app. No repeated login attempt or password request was made. Follow SETUP-PROMPT-2.md when account access returns. Local preview: **http://127.0.0.1:3000**. Exact start command:

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

Prompt 4 was subsequently authorized and implemented; see the current handoff above. External verification remains unfinished even though Prompt 3's local implementation is complete.

## Prompt 2 historical handoff

User authorized Prompt 2 and supplied Supabase project `zuqktfohxqzkzumtqibg` and Vercel project `northsidecollectibles/northside-app`. GitHub is connected as Cookarelli, which lacks write permission. User cannot sign in until a password reset; no reset is needed to keep using the local preview. Cloud upload/configuration are deliberately waiting. No password reset, migration, staff email, live customer login or deployment was performed.

Implemented:

- Versioned Supabase SQL migrations for all Prompt 2 entities, Northside-only production seed, compound tenant/customer/actor foreign keys, immutable ledger/rules/events/audit records, and role-based RLS.
- Separate least-privileged runtime and auth SQL roles; verified opaque sessions become transaction-local database context. Runtime cannot read provider tokens; auth role cannot read operational cards. No browser-chosen tenant/customer/role.
- Shopify confidential OIDC login/callback with openid-client, PKCE/state/nonce, issuer/audience/expiry/signature validation, one-time encrypted attempts, safe redirects and HTTPS-only real auth.
- Supabase invited staff email auth, verified getUser checks, active memberships/roles, owner bootstrap command and restricted invitation UI/API. No public staff signup or hardcoded production admin.
- AES-GCM server token encryption, Secure/HttpOnly session cookies, absolute expiry, locked token refresh, durable local logout, Origin checks and browser cache protections.
- Authenticated card/status/file/export services; audited staff status append; private Storage migration, restrictive browser-role policy, owned 60-second signed downloads, bounded staff uploads. No private notes or batch totals in customer projections.
- Existing fixture UI preserved; production account/cards/staff surfaces have honest disconnected states. All purchase/loyalty/in-store gates remain off. Form spacing fixed after browser inspection. Existing source formatting normalized for readability.

Final local validation:

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS |
| `pnpm test` | PASS: 27 total (3 policy + 24 Prompt 2) |
| PostgreSQL/service privacy tests | Actual migration and server services run on PGlite; shared batch, cross-tenant/forged IDs, independent RLS, role separation, status audit, files, CSV, session expiry/refresh/logout and immutability pass |
| OIDC contract tests | Real openid-client verifies locally signed tokens; wrong issuer/audience/nonce/expiry/subject/signature/state rejected. HTTPS provider responses are mocked |
| Storage SQL test | Real restrictive policy applied to a local minimal Storage schema; anon/authenticated direct access denied despite a broad unrelated policy |
| Production smoke scripts | PASS: 14 original checks + 9 auth checks; no private data without session, cross-origin logout denied, callback without attempt denied, login requires POST, disconnected auth UI disabled |
| Browser | Staff sign-in desktop and disconnected Account at 390px inspected; no horizontal overflow; original fixture account → grading journey still works; no browser warning/error entries observed |
| Client bundle scan | No server encryption/database/Shopify client-secret/Supabase secret configuration names in `.next/static` JS |
| Shopify public discovery | Externally read successfully; issuer `https://shopify.com/authentication/103967392113`, RS256/S256 and confidential client support confirmed. This is not a customer login test |

Dependencies added and pinned: openid-client 6.8.8, Supabase JS 2.116.0, pg 8.23.0; local test engine PGlite 0.5.8, tsx 4.23.13, Prettier 3.9.6. Hosted schema/roles/TLS/pooling, real Supabase Auth/Storage delivery, actual Shopify OAuth/refresh/logout and real-device cache behavior remain **unverified**.

Remaining external work: after account access returns, follow [SETUP-PROMPT-2.md](SETUP-PROMPT-2.md) to upload GitHub, inspect/apply Supabase migrations, privately configure roles/secrets and HTTPS callbacks, bootstrap an invited owner, and run the listed external checks. Do not claim those checks passed. Prompt 3 was subsequently authorized by the user's “continue”; see the current handoff above. [AUTH-AND-PRIVACY.md](AUTH-AND-PRIVACY.md) records the exact security path and limits.

Changed/new areas: `supabase/migrations`, `lib/server`, `app/api/auth`, `app/api/private`, staff login/confirmation pages, live account/cards/staff components, privacy guard, invitation component, tests, migration/bootstrap/smoke scripts, environment example and documentation. All code is saved locally; GitHub upload remains blocked by authentication/permissions.

## Prompt 1 historical evidence

## Running preview

URL: http://127.0.0.1:3000

Exact command on this Mac (also works when Node is absent from the normal shell PATH):

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

The supplied Desktop folder contained only the prompt document. A fresh isolated project was created in this task's outputs; no existing project was overwritten. The original prompt is copied in full. Supplied GitHub repository https://github.com/NorthsideCollectibles/northside-app returned no refs (empty) on inspection and is configured as origin. The user authorized pushing the completed Prompt 1 project to origin/main. Local implementation commit: 0e06cdb. Push attempted but blocked: Git has no HTTPS authentication on this Mac, and the connected GitHub account reports pull=true, push=false for this repository. No remote files or refs were changed. Sign Git into an account with repository write access, then run `git push -u origin main`.

## Implemented

- Responsive Home, Shop/search/category, product details/sample variant, local demo cart quantity/remove, Breaks and detail, My Cards grading/consignment tabs, Rewards, Account and server-isolated staff preview.
- Five mobile navigation items; Rewards on Home and Account. Guest and fictional signed-in Home, sample account switching, per-card timelines, scheduled break, configurable sample Rookie/Vet/HOF/GOAT thresholds and sample wallet.
- Typed commerce, identity, grading, consignment, breaks and first-party Northside loyalty boundaries; server-only fixture and disconnected implementations.
- Explicit non-production fixture opt-in, production denial, honest disconnected states, nonexistent live checkout/redemption operations and disabled public purchases/earning/redemption/scanning/aisles/pickup. Staff route is development fixture-only, not an authenticated operational portal.
- User-supplied clean blue Northside SVG used intact, at original proportions. Blue/near-black/white brand tokens and derived readable interface colors. Square app icon composes supplied artwork, not a replacement logo. All merchandise art is labeled sample illustration.
- Dynamic pages, no-store response headers, no service worker/storage of private data, responsive metadata and foundational manifest. Node deployment model; PWA install/offline/device verification deferred to Prompt 9.
- AGENTS.md, README, product specification, architecture, integration input inventory and this status. All ten stages and global requirements preserved.

## Validation evidence

Executed on this Mac with Node **24.19.0**, pnpm **11.19.0**. Pinned Next **16.3.5**, React/React DOM **19.3.0**, TypeScript **6.0.3**, Tailwind **4.3.3**, Radix tabs **1.1.21**, ESLint **9.39.5**. Exact transitive resolution: pnpm-lock.yaml.

| Check | Result |
| --- | --- |
| `pnpm build` | PASS, production build compiles/types all requested routes and manifest |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, no warnings |
| `pnpm test` | PASS, 3 policy tests: production fixture denial, explicit local opt-in, all six public gates false |
| `node scripts/production-smoke.mjs` against port 3001 | PASS, 14 checks: 7 customer pages with no fixture records and no-store; staff/sample details/scan/aisles/pickup 404; valid standalone manifest |
| Production with `NORTHSIDE_FIXTURES=1` | PASS, request did not enable fixtures |
| Desktop browser, 1440×1000 | Inspected Home, supplied logo, navigation and composition; sample Home/account flow and keyboard-operated card tabs verified |
| Mobile browser, 390×844 | Inspected Home, card timeline, rewards and controls. Measured 390px document width on Home/cart/shop/product/break detail/staff/rewards/account; no horizontal overflow |
| Shopping controls | Search narrowed to basketball; sample add-to-cart; quantity 2 produced example $170 subtotal; remove produced empty cart; checkout remained disabled |
| Account/cards | Sample sign-in → signed-in Home; grading/consignment tabs; ArrowRight selected Consignment; leaving sample account removed timeline access |
| Rewards / breaks / staff | Editing Vet draft to 1500 displayed example $1,500 threshold; redemption disabled; break detail showed example CDT date and disabled purchases; staff showed empty Draft catalog explanation and disabled flags |
| Browser console | No warning/error entries observed during tested flows |

Concrete issues fixed: TypeScript 7 rejected by TypeScript ESLint (pinned compatible 6); ESLint 10 rejected by current React plugin API (pinned compatible 9); pnpm script-time reinstall behavior fixed through project workspace setting; initial lint warning removed; Next development badge overlapping mobile Home removed; supplied logo replaced temporary slot and stale missing-logo text removed. Initial sandbox build could not bind its internal worker port; authorized local build outside that restriction passed. This is an environment limitation, not an app build failure.

## Honest limits / unchanged systems

No real customer authentication, database, persistent operational records, order history, Shopify catalog/cart/checkout, webhooks, discount issuance, Fanatics feed, grading feed, stream destination, notification delivery or marketing connection is verified. No Shopify products, inventory pools or fulfillment settings were changed. No domain/hosting deployment or paid loyalty plugin was added.

Fixture merchandise, prices, dates, customer records, balance and tier values are visibly examples. Cart/account/tier edits are in memory only. Points are not cash or consignment payout. No live earning/redemption until Joey approves rules and external checkout tests pass. Real store/show dates, break URLs, “BGP” identity, Fanatics data coverage, real photography and operational setup remain inputs. Logo was supplied and is no longer a blocker.

No blocker remains for the local Prompt 1 deliverable. The separately requested GitHub upload is blocked by missing write-capable authentication, as recorded above. Browser emulation does not establish real-phone installation, camera, push, checkout, OAuth or accessibility certification. Those integration/device checks belong to later stages.

## Stage ledger

1. **Complete locally** — project / preview / documentation.
2. **Implemented and locally tested; external verification pending** — Supabase persistence, Shopify identity, staff auth and privacy isolation.
3. **Implemented and locally tested; external verification pending** — published Shopify catalog, cart, accounts, paid-order webhooks/reconciliation; purchases remain disabled.
4. **Implemented and locally tested; external verification pending** — persistent grading intake, customer decisions, shared batches, reviewed imports and examination references.
5. **Implemented and locally tested; external verification pending** — persistent consignment operations, reviewed imports, owned settlement information, disconnected Fanatics adapter and unsent partner data request.
6. **Implemented and locally tested; real economics inactive and external verification pending** — custom loyalty ledger/earning, Shopify issuance and recovery, wallet/tiers, staff controls, analytics and reconciliation.
7. **Implemented and locally tested; live purchases disabled and external concurrency verification pending** — saved break schedule, calendars/reminders, exact paid spot allocation, legacy evidence and review.
8. **Implemented and locally tested** — future eight-aisle map, QR/scanner and sample pickup design; public activation deferred.
9. **Implemented and locally tested** — PWA/static-only offline, notifications and marketing exports; real device/delivery verification pending.
10. **Implemented and locally tested** — release checks, deployment/backup/rollback handoff, staff/launch docs and native roadmap; actual hosted release remains waiting for configuration.

## Changed-file inventory

All files are new: root package/config/lockfile, AGENTS.md, README.md, copied Northside-App-Codex-Prompts.md; app route files, layout, manifest, not-found and globals.css; components/preview.tsx; lib/contracts.ts, lib/services.ts, lib/policy.mjs and both adapters; public/northside-logo.svg and app-icon.svg; scripts/preview.sh, policy.test.mjs and production-smoke.mjs; docs/PRODUCT-SPEC.md, ARCHITECTURE.md, INTEGRATIONS.md and STATUS.md. Generated dependencies/build files are ignored. No secrets are present in .env.example.

## Prompt 6 changed areas

New loyalty shared types, server ledger/discount/order/worker/redemption/reporting/API/fixture modules, wallet/staff component and routes, migration 006, worker/smoke scripts, four test files and reusable test fixture, setup/reconciliation/Marketing Hub documents and labeled JSON checkpoint. Existing commerce reconciliation now queues loyalty jobs; Storefront can apply an owned voucher behind disabled gates. Staff links, integration health, environment inventory, responsive styles and project guidance were updated. No dependency or provider configuration was added.

## Prompt 7 changed areas

New break types, schedule/calendar/purchase/commerce/worker/API/fixture services, public/customer/staff routes, shared client workspace, sample illustration, migration 007, worker/smoke scripts and 17 SQL/service tests. Existing general cart guard, order-job fan-out, home/account/staff links, responsive forms, environment inventory and project documentation were updated. Setup and before-sale checklist added. The requested design milestone reminder was created in this task. No new dependency, paid plugin or credentialed provider connection was added.
