# Staff grading operations

Implemented locally September 16, 2026. Open **Grading desk → Staff grading operations** at `/staff/grading/operations`. This extends the existing intake, signed exam, Shopify customer approval and examination payment records. It does not connect a grading-company feed or create a payment, shipment or Shopify fulfillment.

## Scan, verify and dispatch

1. Receive the intake, confirm original front/back photos, publish the signed exam and configure a complete per-card submission quote using the existing desks. PSA is the confirmed provider. BGP remains unconfirmed/internal; it is not BGS. Unknown external grading, shipping, insurance and other fees remain unset, never free.
2. The authenticated collector approves the selected card IDs against their current published exam and quote revisions. Staff cannot supply that approval on the collector's behalf.
3. Create a submission batch with the confirmed provider, exact approved service and submission reference. Add carrier and tracking before dispatch. Older, unshipped batches may configure missing service; an already dispatched service or membership cannot be rewritten.
4. Print/download the individual card label under **Returns & milestones**, then attach it to a protective holder. Scan that Northside label with a phone/tablet camera, a label image, or a USB/Bluetooth scanner. A separately identified manual full-ID check is available. Product barcodes and arbitrary URLs are rejected. The label identifies the physical record; it grants neither ownership nor release authority.
5. Scan each approved physical card into the batch. Multiple collectors are allowed; each card retains its owner and approval evidence. The server checks current approval, matching provider/service, Ready to submit, physical custody at Northside, and no other active outbound assignment. Holds and exceptions cannot pass the dispatch check.
6. Review the exact complete batch list and carrier handoff evidence, then explicitly confirm dispatch. In one transaction the server locks the cards, revalidates current approval and scans, and preserves each owner, description, card version, approval request, published exam and quote revision with the dispatch reference/carrier/tracking, actor, source, time and reason. A single invalid card rejects the entire dispatch.
7. Download the staff-only preserved manifest. Later tracking corrections are audited and do not rewrite the dispatch snapshot. Response-loss retry uses the original request and exact payload; it cannot dispatch twice or replace a manifest.

Unshipped cards can be removed from a draft batch with a reason. A pre-dispatch customer return request, staff cancellation or return without grading also removes the staged outbound assignment. A batch cancelled before dispatch retains its audit history. It does not cancel the cards themselves or release them to anyone.

This implementation tracks one external submission cycle per intake-card record. A completed/dispatched manifest is never recycled into a second batch. A future re-submission workflow would require explicit new custody/approval design; changing a status or holding a card does not erase its outbound history.

## Physical milestones and exceptions

The standard sequence is **Received → Examination in progress → Awaiting customer decision → Ready to submit → Sent to grader → Grader received → Grading in progress → Returned to Northside → Ready for pickup → Completed**.

Record only observed milestones, using a reason and actual evidence. A receipt can establish that a sent card returned even when intermediate grader updates were unavailable; the app does not fabricate missing milestones. Holds and exceptions retain the last physical milestone and custody. Staff updates, customer decisions and reviewed imports have explicit sources in audit records. Historical records without known sources remain unknown.

Shipment, physical return and release use dedicated operations. A generic status edit or CSV cannot bypass their evidence. Pre-dispatch cancellation/return without grading stays physically at Northside until verified pickup. After dispatch the collector can request staff review of a withdrawal from their own portal. Review resolution and private staff reason are saved; accepting a request does not pretend the grader has returned the card. The next physical event still requires evidence.

New quotes are blocked after dispatch. A later exam correction preserves the already dispatched approval/exam snapshot; it does not demand retroactive permission for a physical event that already occurred. Current approval is required immediately before outbound dispatch, not fabricated again for subsequent evidenced grader/return milestones.

## Partial returns and actual results

Scan/select only a card physically back at Northside. Record **Graded** with the actual external grade, or **No grade issued** with the external reason; enter the certificate number when available. Confirm physical receipt and provide a reason. That card's custody changes; remaining batch cards stay with the grader.

Actual outcomes have immutable revisions, actor/time/source/reason and may be corrected while the card remains at Northside. Northside's original signed estimate remains in its exam and is never overwritten or averaged into the external grade.

Upload returned front and back photographs, plus optional returned closeups, using the existing private camera/file workflow. Returned photos are distinct from original exam snapshots. Storage confirmation/readback is required; a browser preview is insufficient. **Ready for pickup** and release recheck confirmed returned sides and their actual stored bytes. Legacy dispatched returns without structured outcome/photo evidence cannot be released through a status shortcut. The customer can see their own confirmed returned photos and current final result; internal outcome reasons and shared manifests remain private.

## Verified, partial pickup

1. Open **Pickup** and scan each physical card being handed over. Leave other cards for later. Every selected card must be Ready for pickup, physically at Northside and owned by the same collector/approved claimant.
2. Independently verify the recipient. Choose collector or authorized representative, enter their full name and record how identity was checked against the collector record. For a representative, also record independently verified collector authorization. Do not store identity-document numbers or images.
3. Have the recipient review the exact selected list and enter their acknowledgment. Confirm independent authority and acknowledgment separately, then record the release reason.
4. Save once. The server rechecks versions, ownership, custody, readiness and required photos and preserves the exact scanned list/methods, recipient evidence, acknowledgment, authenticated staff identity and timestamp. Only those cards become Completed. A unique release per card and stable request retries prevent double release.

A QR code, email address or typed name alone is insufficient. These are staff-attested identity/authorization checks, not an automated government-ID verification service. A mistaken release is not silently reopened; preserve evidence and escalate it for an explicit correction workflow. The earlier future retail order-pickup feature remains disabled and separate.

## Reviewed spreadsheets

**Spreadsheet updates** updates existing physical records; **Intake → Imports** retains its original received-card import/reversal workflow. Download the labeled SAMPLE status template. Files are bounded to 256 KiB and use the existing bounded parser. Select a stable source and map external row ID, exact card ID, milestone, outcome kind/result/certificate and reason. Required fields are validated on the server, including quoted CSV headers.

Save a review, inspect every row and explicitly confirm with a reason. The review retains mapping, proposed values, original card versions and validation outcomes. Commit revalidates the current records atomically. A card changed since review requires a new review. Exact source/row/payload repeats skip already applied updates; a reused external row ID with changed values is a conflict, not an overwrite. Preserve external row IDs across repeated exports. Use a new reviewed row ID for a later evidenced event.

CSV cannot create customer approval, dispatch a batch or complete pickup. Return rows require the actual graded/no-grade outcome; readiness still requires confirmed returned photos. Actor, import source, row fingerprints and commit audit remain durable. Receipt/source files are private staff records, not customer downloads.

## Payments and notifications

Examination payment tracking remains in **Intake, exams, quotes & payment references**: verified Shopify order linkage must match the correct verified collector/approved claim, or staff records the real external source/reference/date/amount. A reference is clearly staff recorded; it creates no charge, order, refund or Shopify sale. Quotes, approval and pickup are not proof of payment.

Decision-required, decision-recorded, withdrawal-review and pickup updates use the existing in-app inbox and notification preferences. Notification/outbox rows are created in the same successful database transaction as the underlying save; rollback creates no message. Stable event keys and operation retries prevent duplicate jobs. Emails contain generic information rather than private card or batch contents.

**Review & activity** exposes delivery state, attempts and errors, with the existing Engagement workspace for worker review. The existing configured email adapter is reused. Currently email/push delivery is disabled and local jobs remain **UNSENT**. Google Workspace remains the user's preference if email setup is resumed; no Google Workspace setup, SMTP credentials, real test message or new mail integration was performed. Provider acceptance would not prove inbox delivery. Never run a delivery test against a real recipient without explicit authorization.

## Persistence, migration and security

Migration `20260916195007_grading_staff_custody_and_dispatch.sql` was generated with Supabase CLI 2.117.0 and applied only to the saved local preview and isolated tests. It adds custody, immutable dispatch/manifests, staged scans, outcome revisions, verified pickups, operation retry records, status-import identities, withdrawal/review records and notification topics. Legacy sent batches are labeled `legacy_dispatched`; no historic manifest, source, outcome evidence or pickup signature is invented.

All new staff tables enforce tenant RLS and role checks. Customers receive explicit owner-scoped portal projections, never mixed manifests, staff reasons, pickup verification evidence or private imports. Private image reads retain owner/tenant checks. Label/manifest/import endpoints are staff-only and all private responses are no-store. Runtime writes are authorized server-side. Mutation locks serialize custody changes before batch/card locks; quote/exam changes lock the same cards to keep dispatch approval consistent. Hosted concurrency still requires a real multi-connection test.

No dependency or environment variable was added. The existing pinned local scanner reader/writer assets are reused; the server QR writer is included in the production route trace. Preserve the entire database and paired private image storage together, including retired photographs referenced by exams/pickups. Never edit an applied migration or delete audit evidence to resolve an exception.

## Verification and remaining acceptance

Automated tests cover mixed ownership, scan/provider/service/current approval checks, duplicate outbound protection, stale/atomic dispatch, immutable manifests, response-loss retries, custody/hold/cancellation guards, reviewed withdrawals, partial graded/no-grade returns, storage verification, independent representative authorization, partial/duplicate pickup, CSV mapping/replay/stale review, notifications/privacy and close/reopen persistence. Existing examination-payment tests continue to pass.

The isolated Chrome rehearsal uses only clearly labeled SAMPLE intakes, charges, shipping references, synthetic photographs and actual-result text. It scanned a generated card-label image, dispatched a three-card/two-collector batch with a deliberately lost success response and retry, reviewed a post-dispatch withdrawal, returned/photographed/released one card to a verified SAMPLE representative, and left two with the grader. The 16 prior saved cards were preserved. Current counts and final build/browser evidence are in [STATUS.md](STATUS.md), with ignored artifacts in `work/staff-grading-verification/`.

Start the local preview from this project with `./scripts/preview.sh`; open http://127.0.0.1:3000/staff/grading/operations. No real card is represented by the SAMPLE walkthrough.

Before real use, verify actual Shopify identity/receipt claims, invited staff roles, hosted PostgreSQL RLS/concurrency/restore, Supabase private Storage and actual phone/tablet camera/scanner behavior on configured HTTPS staging. The Square website link remains deferred at the user's request. No live grading-company API, Shopify product change, real shipment, payment, message or hosted deployment is claimed. The dedicated design pass remains due.
