# Customer grading portal and revision-bound approvals

Implemented locally September 16, 2026, following the photography and digital Northside Exam extension. The live Square website link is deferred at the user's request (“later”). This feature uses the existing Next.js portal, grading records and Shopify customer identity; it adds no second customer account system.

## Collector workflow

Open **My Cards → Grading**, or the new **Grading / Track My Cards** entry at `/grading`. The responsive portal is the same in the browser and installed app. In production, private requests use the verified, refreshed Shopify session. Sign-in from the grading list, a card detail or an exam retains that exact approved destination through the existing encrypted OAuth attempt/callback. External hosts, protocol-relative URLs, arbitrary query strings and malformed card paths are rejected as return destinations.

The collector sees their received cards and confirmed front/back/condition photographs, intake receipt, published Northside Exams and printable exam reports, itemized submission quotes, current status, dated timeline, last updated time and external final result/certificate when recorded. Dates display in America/Chicago. The latest update includes status changes, confirmed photos, published exams and quotes. Northside's manually entered estimate is separate from the external result; staff-entered events/results are not advertised as a provider feed.

Confirmed current card photographs are now available at drop-off, before exam publication. This deliberately extends the earlier exam-only photo visibility. Draft assessment fields, internal notes, staff reasons and paper exam images remain hidden. Older published report revisions keep their exact image snapshots.

1. Open each card to review its receipt, published exam and current quote. The receipt lists the physical cards in that customer's intake, the received date and the snapshotted examination subtotal. It is not proof of payment. **Print intake receipt** creates an authenticated printable view; **Read exam & printable report** opens the preserved published examination.
2. Select only the cards to act on. **Review submission approval** is available when every selected card has a published exam, a configured confirmed provider/service, all quoted charges, and an Awaiting customer decision or Ready to submit status.
3. Review the exact card IDs, exam revisions, quote revisions, provider/service and itemized amounts. Check the explicit confirmation and submit. The server records the verified customer actor and timestamp, with immutable references to every selected card, exam and quote. Other cards are untouched.
4. Alternatively, **Review return request** is available while Northside still holds the card before dispatch. Return requests can be made before an exam or quote exists; the recorded snapshot explicitly preserves those absent values. A return request cancels that card's submission approval and asks Northside to arrange its return. It neither completes a physical return nor authorizes an unknown return fee.
5. After an uncertain response, **Retry same decision** reuses the same request and exact selection. If choosing **Review latest records**, inspect the saved status/history before making another decision. A saved decision survives refresh and process restart; it is never stored only in browser memory.

An empty portal supports the existing receipt claim workflow. A claim code alone never grants access: staff independently verifies the receipt/identity and approves case-specific access. No email matching or account merging was added.

## Quotes and approval rules

Quotes are immutable, per-card revisions. Staff use **Grading desk → Cards → Submission quote & approval → Configure a new quote revision**. Choose a confirmed provider (currently PSA), enter the actual service name and known amounts, and save with a private reason. Saving a quote makes that revision customer visible, including an incomplete quote; no unpublished quote-draft feature is implied.

| Line | Source and unset behavior |
| --- | --- |
| Northside examination | Existing intake rate snapshot; shown once as part of the card's total. |
| External grading | Initially unset; staff must explicitly configure it. |
| Shipping | Initially unset; enter this card's allocated share, not the whole batch charge on every card. |
| Insurance | Initially unset; staff must explicitly configure it. |
| Other charges | Initially unset; a positive amount requires a description. |

Blank charges display **Not yet quoted**, and the combined total stays **Total pending**. Blank is never converted to zero. An explicit `0.00` is a configured zero amount, distinct from unset. Staff entry uses USD with at most two decimal places; the server accepts only integer cents in the supported range. Quotes describe costs, not an outstanding balance or proof that payment was taken. Existing payment-source separation is preserved.

No external service or fee schedule is seeded by migrations. The saved browser rehearsal contains visibly fictional SAMPLE services and charges solely to demonstrate approvals. These are not adopted Northside rates or current PSA prices. PSA remains the confirmed provider. The historical “BGP” record stays unconfirmed/internal; it is not renamed BGS or offered in customer quotes.

Every new quote revision—including fee, service or terms changes—or new published exam revision invalidates the previous submission approval for that card. The old approval remains available with its original evidence. The collector must review and approve the current revisions before dispatch. An edit to an unpublished exam draft does not change the already published evidence. Version checks also reject stale card state and concurrent stale quote saves.

After a card has already left, later exam corrections retain the earlier approved evidence. The portal directs the collector to contact Northside about such changes; it does not pretend to obtain retroactive approval for a completed dispatch.

## Dispatch and staff operations

Only an authorized collector can approve submission; staff cannot synthesize customer approval by editing status. The old single-card `decision` API and legacy SQL consent function reject new decisions with instructions to use the revision-aware flow. Historical decisions are retained but cannot authorize new dispatch.

The staff operations extension now requires scanned membership and an immutable dispatch manifest, with current approval revalidated immediately before dispatch. Generic status edits cannot dispatch a card. Ready to submit still requires current approval. Later evidenced grader/return milestones use preserved dispatched evidence and physical custody; they do not demand retroactive reapproval after shipment. One invalid member rejects the entire dispatch transaction. See [staff operations](STAFF-GRADING-OPERATIONS.md) for partial returns, post-dispatch withdrawal review and verified pickup.

New batches specify the grading service. Older saved batches with an unset service can configure it through **Save batch tracking** before their first dispatch, including when cards are already assigned. Provider/service and card-to-batch association become immutable after dispatch history exists. Changing a later status to On hold does not erase that history or permit the service to be rewritten. A batch/service mismatch remains blocked until the quote, customer approval and batch agree. Batch manifests, tracking references and pooled contents remain staff-only.

Import reversal is blocked after quote or approval activity, in addition to the existing exam/photo/payment/claim checks. Corrections keep immutable history; no received card is recreated by an approval or return retry.

## Server and database boundaries

New routes:

- `/grading`: public entry containing no private records.
- `/my-cards/grading`: authenticated collector list and selected-card decisions.
- `/my-cards/grading/card/[id]`: exact-card detail, receipt and revision history.
- `/api/private/grading/portal`: server-authorized list, detail, receipt, CSV and decisions.
- `/api/preview/grading/portal`: explicit loopback-only fixture equivalent, disabled in production.

The existing exam image/report routes authorize every request. The portal explicitly projects customer fields, excludes batch/owner/tenant internals, and uses the same tenant/owner/approved-claim RLS. Quotes, decision selections and per-card approval evidence have RLS and append-only rules. Raw customer writes to those tables are unavailable. The private consent function requires a verified customer context, checks every selected owner/card/version/revision, locks cards in sorted order, records the authenticated actor, and changes only the selected statuses atomically. It has a fixed search path, restricted execution grant and no public/browser schema exposure.

The quote and exam writers lock the same card records as approval/dispatch. Current approval is derived from immutable latest decisions and current published exam/quote identities, not a client boolean. Replaying the same request with changed selections or intent is rejected. Replaying the original acknowledged request returns that same historical decision; it does not silently renew a stale approval.

All private records, images, receipts, CSV and reports return no-store responses. They are excluded from PWA caching. Printable receipts escape all variable text and use the existing logout/history privacy behavior. Exported paper/PDF copies are intentional customer exports and cannot be revoked after saving. CSV excludes internal fields and escapes spreadsheet formulas.

Migrations generated through Supabase CLI 2.117.0:

1. `20260916185139_customer_grading_quotes_and_approvals.sql`: immutable quotes/approval requests/selected-card evidence, drop-off photo visibility, current-approval and dispatch guards.
2. `20260916192111_grading_batch_service_setup.sql`: configure an older batch before dispatch, while preserving service and membership after any dispatch history.

They follow the existing photo/exam migration; earlier migration files remain unchanged. No dependency, payment provider or environment variable was added. The preview applies these locally without resetting saved data. Use the existing migration runner for a reviewed hosted target after its private configuration is available; no hosted migration was executed here.

## Verification and reproducible preview

Start from the app directory:

```sh
./scripts/preview.sh
```

Open http://127.0.0.1:3000/my-cards/grading. Sample A's new walkthrough contains three cards: one has a renewed quote approval, a SAMPLE dispatch and final result; one has a selected return request; the third remains awaiting a decision with an incomplete quote. All older saved cards are preserved. The reviewed detail is [SAMPLE customer grading](http://127.0.0.1:3000/my-cards/grading/card/653553d4-f23c-4afd-ba3d-7094ee64125a?actor=a). That ID exists only in this Mac's ignored local preview data.

Fresh evidence is in ignored `work/portal-verification/`: typecheck/lint, the complete automated test run, final production build, client secret scan, HTTP checks, browser logs/screenshots and the test receipt PDF. Use `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`; the Codex-local direct builder workaround remains `node node_modules/next/dist/bin/next build` with approved worker-port access. See NORTHSIDE-EXAM.md for runtime/production server commands. `node scripts/release-smoke.mjs` now includes `grading-portal-smoke.mjs`.

**183 automated tests pass**, including 17 focused customer portal tests. They cover partial approval, explicit consent, independent unset charges, configured zero, authenticated actor, duplicate/lost-response recovery, altered selections, stale card/exam/quote versions, service changes, return cancellation, owner/tenant/RLS boundaries, claimed receipts, export privacy, dispatch/provider/service matching, older batch setup/history, and close/reopen persistence. All eleven production HTTP suites pass, with eleven focused portal checks for private receipts/exports, fixture denial, same-origin decisions and exact login return destinations. Typecheck, lint, production build and 23 client artifact checks pass.

An isolated Chrome rehearsal exercised the staff quote form, website entry, two-of-three approval, lost success acknowledgment and retry, selected return, material quote change, blocked dispatch, renewed approval, approved SAMPLE dispatch and a separate final result. It inspected 390px/1280px layouts, image zoom, receipts, customer switching and denied other-owner/cross-origin requests. No page errors or horizontal overflow were observed. The one-page Letter receipt was rendered and visually inspected. The same saved cards and decisions were rechecked after restarting the preview.

## Remaining external work

The user deferred the live Square navigation change. [WEBSITE-GRADING-ENTRY.md](WEBSITE-GRADING-ENTRY.md) records the inspected architecture and exact link handoff. No public domain is assumed, no live website editor was changed and no deployment was made.

Real Shopify sign-in/callback/session refresh and approved receipt identity checks, hosted PostgreSQL concurrency/RLS, Supabase private Storage, device logout, physical phone/tablet capture and coordinated database/object restore still require private HTTPS staging verification. Local PGlite and synthetic production rejection tests do not establish those external results. Public purchasing, loyalty economics and future in-store gates retain their existing settings. The separate design pass remains due.
