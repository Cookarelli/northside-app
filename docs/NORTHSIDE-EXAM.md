# Card photography and the digital Northside Exam

Implemented and verified locally September 16, 2026, as a user-authorized extension after Prompts 1–10. This document supersedes the earlier sample-illustration workflow in Prompt 4. Hosted Auth/Storage and physical phone/tablet camera acceptance remain pending. Use only fictional information and labeled sample photographs in the local preview.

## Staff workflow

1. **Grading desk → New intake:** save the received cards first. Each physical card gets a permanent ID. The saved receipt has an exam link for each card. Open the existing card if photography is interrupted; do not submit a second intake to retry a photograph. Cards without confirmed front and back images show **Photos missing** in the staff card list.
2. Open **Photos & Northside Exam**. Take a front and back picture with the separate camera controls, or choose files. On supported phones/tablets, the camera control requests the rear camera through the native file picker. Browser/device support determines the picker behavior; file upload remains available. Add up to six condition closeups and one existing paper exam image if useful. Paper exam images are staff-only evidence.
3. Inspect the local preview, retake/reselect if needed, then press **Upload this photo**. “Preview only — not yet saved” is not a completed upload. Transfer progress is followed by private-storage confirmation. Only a confirmed stored image counts toward completion. Saved images have zoom controls; zoom is also available beside the assessment.
4. On failure, keep the card record and use **Retry upload**. If the page was refreshed, reselect the same file on that same card to resume its pending attempt. The server matches the file hash and stable upload identity; it does not create a card. Discard an unwanted pending attempt from the saved workspace. A retake replaces the current selection only after its new image is confirmed; published revisions retain their original images.
5. Enter the examination fields below and **Save draft**. Drafts are not customer visible. Save any assessment changes before changing photographs. Refresh restores saved fields, notes and completed photographs. Unsaved form edits/file selections are not durable; the page warns before leaving a changed draft. Concurrent changes return a conflict and require reloading rather than overwriting another examiner's work.
6. Review the saved assessment and photographs. Enter a staff-only publication reason and explicitly check the authenticated examiner signoff. **Publish assessment** is a separate action. Publication revalidates the saved version, required fields and the actual image bytes in storage. It never follows automatically from saving a draft or completing an upload.
7. To correct a published exam, edit/save the draft, provide a correction reason, sign off again and **Publish new revision**. Prior revisions, signatures and photo selections remain immutable. Choose a revision to inspect its assessment, actor/time, reason and printable report. Customers see published revisions only.

## Exact paper fields

| Field | Behavior |
| --- | --- |
| Centering | Integer 1–10; blank until entered. |
| Surface | Integer 1–10; blank until entered. |
| Edges | Integer 1–10; blank until entered. |
| Corners | Integer 1–10; blank until entered. |
| Notes | Customer-visible findings, included only on publication. May be blank. |
| Projected grade | Examiner-entered text, or the explicit **Unable to estimate** choice. |
| Signature | Authenticated staff identity and server timestamp on publication. No typed signature or browser-supplied actor/time is accepted. |

There is no photo grading model and no average of the four scores. The Northside estimate is separate from the external grader's staff-recorded final result. Internal staff notes are a separate saved field, excluded from customer responses and reports. Drafts and internal revision notes/reasons are available only to owner/admin/operations; read-only staff cannot edit or read those private note fields, and content editors cannot access the grading exam.

Publication requires confirmed front/back images, all four valid scores, a projected grade or unable-to-estimate choice, the current saved draft version, an explicit signoff and a reason. Incomplete drafts can be saved. Publishing the same saved version again returns the same revision rather than creating a duplicate.

## Formats and recovery

- Accept **JPEG, PNG and single-frame WebP**, at most **4 MiB per file** and **24 megapixels**. HEIC/HEIF, RAW, GIF, PDF, SVG and animated images are unsupported. Export a JPEG, use a supported file, or select the camera's Most Compatible setting where available. Export a smaller image if it exceeds either limit. The UI explains these limits before capture/upload and on errors.
- The server limits the incoming byte stream, checks the MIME type against file signatures, fully decodes the image, applies EXIF orientation and strips EXIF/location metadata. It stores a high-quality normalized JPEG; these are examination photographs, not lossless preservation of camera originals. Keep source originals under the store's separate retention policy if needed.
- Photo preparation is a separate committed record before upload. Raw-file and stored-image SHA-256 hashes have distinct purposes. The completed flag is set only after reading storage back and comparing its bytes, length and hash. Storage success followed by a lost response or rolled-back database completion can be retried with the same image identity.
- Uploads never overwrite stored objects. Local writes use an atomic create operation; hosted uploads use `upsert: false`. Required-photo replacement keeps the old confirmed selection until the replacement succeeds. No automatic deletion of published image evidence is implemented. There are at most 20 outstanding upload attempts per card; discard abandoned attempts in the workspace.
- Removing a current front or back photo returns the existing card to **Photos missing**, while old published reports keep their snapshots. A missing/corrupt stored image prevents publication or report delivery; the server does not substitute an unconfirmed preview. Import reversal is blocked after photo preparation or exam draft activity.

## Private storage and server boundaries

Migration `20260916174953_grading_photos_and_northside_exam.sql` adds five tenant-scoped tables for drafts, photos, immutable public revisions, revision-photo snapshots and private revision notes/reasons. Composite foreign keys bind tenant, card and staff identity. Runtime RLS restricts writes to authorized grading staff and customer assessments to owned/approved-claim published evidence. The subsequent [customer portal extension](CUSTOMER-GRADING.md) also allows collectors to see their confirmed current front/back/closeup photos at drop-off, before publication. Draft assessments, paper exam images and internal notes remain private. Existing migrations are unchanged; no customer/browser gets direct access to the operational schema.

`/api/private/grading/exam` uses the existing verified/refreshed server session and least-privileged database role. POST/PUT require same-origin requests. Upload authorization verifies the exact tenant/card/photo before reading the body. Downloads and printable reports recheck current authorization every time and return `private, no-store`; they are excluded from PWA caches and the Next image optimizer. No public object URL or browser Storage credential is returned. Server-only Storage privileges never replace runtime SQL authorization.

Hosted images use the existing **northside-private** Supabase bucket, under `{tenant}/grading/{card}/{photo}.jpg`. Its existing 5 MiB maximum accommodates this route's tighter 4 MiB limit. Each provider request has a bounded timeout. The Node API route permits up to 60 seconds for processing. Reports reference separately authenticated image routes rather than embedding a large base64 payload.

Local fixtures use the same service rules with private bytes in ignored `work/grading-photos/` and database records in ignored `work/grading-preview/`. Start only one preview process against that database. Both directories survive refresh and server restart; back them up together while the server is stopped. Neither belongs in source control or a deployment. The preview exam API rejects production, non-loopback access and cross-origin writes before loading the local database. All Shopify and future store activation gates retain their existing settings.

## Customer report

The customer My Cards detail links to published examinations. Customers can select a preserved revision and open its printable report. It contains Northside branding, card/revision identifiers, front/back and published condition photographs, the four scores, public findings, the manual estimate/Unable to estimate, and examiner identity/time. Paper exam photographs, internal notes and correction reasons are excluded. Preview reports are visibly labeled SAMPLE.

Use **Print / Save PDF** in the report. The button waits for every photograph to load before printing and reports a loading failure instead of silently printing missing evidence. The HTML supports Letter printing and multi-page content. Report tabs use the application's sign-out/privacy lock behavior. A saved PDF or paper copy is an intentional exported customer report and cannot be revoked by signing out.

## Run and verify

From the project root, `./scripts/preview.sh` starts http://127.0.0.1:3000. Open `/staff/grading`, select a saved sample card, then its exam. The reviewed SAMPLE card on this Mac is [photography and exam review](http://127.0.0.1:3000/staff/grading/exam/1502c31a-0fa4-4872-94da-593ac6f77ba0); this identifier exists only in this machine's ignored preview data and is not seeded into a fresh checkout.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/check-client-secrets.mjs
```

The Codex sandbox denied the package runner's temporary Turbopack worker port on this Mac. The same production build passed using the direct builder with approved local execution: `node node_modules/next/dist/bin/next build`. No bundler or framework switch was made. For the full local production rejection suite, start the built server in one terminal:

```sh
APP_ORIGIN=https://local-test.invalid SHOPIFY_SHOP=9i3hnb-jw.myshopify.com NORTHSIDE_FIXTURES=1 node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

Then run `node scripts/release-smoke.mjs` in another terminal. This deliberately opts into fixtures in production to verify their rejection. These are synthetic local configuration values, not live credentials. `scripts/exam-smoke.mjs` is the focused exam subset.

Original exam-extension evidence: 166 automated tests (10 policy/CLI/PWA and 156 application tests), including 16 exam tests, typecheck, lint, production build, 23 client artifact secret checks and all ten production HTTP suites passed. The subsequent customer portal run passes 183 tests and eleven HTTP suites; see [current status](STATUS.md). Exam tests cover real decoding/orientation, failed/readback-mismatched uploads, lost acknowledgments, same-file retries, strict publication rules, role/customer/tenant boundaries, immutable corrections, report escaping/private omissions, and close/reopen of database plus stored image bytes. A mocked Supabase SDK adapter verifies its private upload/download contract; it is not a hosted Storage test.

An isolated Chrome session exercised receipt-first intake, front/back recovery including a lost success acknowledgment, refresh, draft save, zoom, publication, correction, old revision selection and customer privacy. Desktop 1280px and mobile 390px layouts had no overflow or page errors. A two-page Letter PDF was rendered and both pages inspected. Ignored evidence is under `work/exam-verification/`.

## Hosted and device acceptance still required

Use the existing private migration command `pnpm db:migrate` after configuring the reviewed target; it includes the new timestamped migration after 001–009. This delivery applies it only to the local fixture database and isolated tests. No new environment variable or dependency is required.

On a private HTTPS staging environment, verify invited staff sign-in, session refresh/logout, customer ownership/approved claims, direct Storage denial, real private upload/readback and denied other-tenant/other-card requests. Test phone/tablet native camera capture, portrait/landscape orientation, HEIC/large-image guidance, weak-network retries and process restart against actual Supabase. Verify simultaneous staff edits with hosted PostgreSQL connections and restore both database and object bytes. Do not interpret local PGlite or mocked provider checks as this hosted evidence.

Technical references reviewed for this implementation: [native capture attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture), [Sharp orientation](https://sharp.pixelplumbing.com/api-operation/), [private Supabase buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage upload options](https://supabase.com/docs/reference/javascript/file-buckets-upload), and [Vercel function request limits](https://vercel.com/docs/functions/limitations#request-body-size).
