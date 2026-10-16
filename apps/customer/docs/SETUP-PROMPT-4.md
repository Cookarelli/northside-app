# Prompt 4 — grading operations

Current customer flow: [CUSTOMER-GRADING.md](CUSTOMER-GRADING.md) supersedes this stage's original single-card submit/return action. Collectors now review exact selected cards against published exams and itemized quote revisions. Unset fees prevent submission approval; changed exams/quotes require renewal. Dispatch requires current approval and a matching confirmed batch provider/service. The old decision endpoint rejects new decisions. Receipts, photos, reports and exports use the same owner-scoped portal. Website connection is deferred as requested; see [the inspected Square handoff](WEBSITE-GRADING-ENTRY.md).

September 16 update: [Card photography and the digital Northside Exam](NORTHSIDE-EXAM.md) supersedes the earlier sample-illustration attachment workflow below. The current preview supports actual SAMPLE image file uploads into private local storage, saved drafts, signed published revisions and customer print reports; hosted/device verification is still pending.

Stage-specific implementation record. For the current combined handoff, see [RELEASE-REPORT.md](RELEASE-REPORT.md).

Implemented locally. No hosted migration, real customer/staff login, private image upload to Supabase, provider API, Shopify payment or deployment has been verified. Do not enter real customer information in the local sample workspace. All public purchase, loyalty and future in-store gates remain off.

## Demonstration paths

Start with `./scripts/preview.sh` from the project root. The preview is http://127.0.0.1:3000. Account passwords are unnecessary for the explicitly labeled sample workspace.

Staff: http://127.0.0.1:3000/staff/grading

1. New intake → choose Sample collector A → enter a **SAMPLE** description and quantity 3. At the default 500-cent rate, the examination subtotal is $15. Save with a staff reason. Each physical card has a different permanent UUID.
2. Cards → select a saved card → Photos & Northside Exam. Upload labeled SAMPLE front/back files, save the assessment draft, then sign and publish explicitly. See NORTHSIDE-EXAM.md for formats, recovery and immutable corrections. Earlier findings remain a separate legacy field; they do not replace a published exam. Private staff verification reasons stay in the audit record.
3. Change status to Awaiting customer decision. Open the customer path below to request submission or return. Then reload staff records to see the persisted decision.
4. Batches → create a PSA batch with a sample reference/carrier/tracking. Select cards belonging to A and B and record Sent to grader. Select only one included card and record Returned to Northside. Other cards retain their previous status. Per-card results and certificate references are edited in Cards. All of these are Northside-recorded milestones, not provider-verified events.
5. Imports → download the sanitized sample CSV. The included customer UUIDs match only the local sample accounts. Upload it, map columns, use a stable source namespace, build a preview, review every row and confirm with a reason. Re-uploading identical IDs under that source skips them; changing their data produces an error. A committed import can be reversed while untouched, retaining its events and reserving its external IDs.
6. To demonstrate a receipt claim: create a receipt contact under New intake; save cards for that exact contact. Open a card, issue a private receipt code, then enter it as sample A on the customer page. Access remains pending. Staff Claims → select approve only with independently checked receipt/identity evidence. No email matching is supported.
7. Settings: owner/admin can change future examination rates and status labels/availability. Existing rates and history wording stay unchanged. Stable status keys preserve workflow semantics. PSA is configured; “BGP — identity unconfirmed” remains internal and never appears in customer responses. Provider identities are migration configuration, not a claim of API connection.

Customer: http://127.0.0.1:3000/my-cards/grading

Select Sample collector A, open a card, read the findings and the examination-only subtotal. Where staff has set Awaiting customer decision, Request submission or Request return records a sample authenticated decision. A request does not imply physical shipment, receipt, return, fee authorization or a guaranteed grade/turnaround. Switch to Sample collector B: only B's cards appear, including when A and B share a batch. If the initial sample already has a recorded decision from review, staff can add an audited correction back to Awaiting customer decision to repeat the demonstration.

## Persistence and boundaries

The sample grading database uses PGlite's Node filesystem storage at `work/grading-preview/`, ignored by Git. It survives page refresh and development-server restart. Run one preview server against this directory at a time. Do not place it on Vercel or share it as a production database. Automated tests use separately generated temporary directories and actually close/reopen the database.

The local route requires non-production `NORTHSIDE_FIXTURES=1`, a loopback `127.0.0.1` Host, a same-origin mutation, and one of three fixed fictional actors. The Next server may internally normalize its URL hostname, so origin validation uses the validated incoming Host. No session token or SQL role is chosen by a real production browser. Fictional sessions/identities exist only inside this isolated local database. The route returns 404 in production even with fixture opt-in. Existing Prompt 1 cart/account demonstrations still reset in memory; only the new grading workspace persists locally.

Live `/api/private/grading` uses the existing verified, refreshed server session, transaction-local identity and least-privileged `northside_runtime` role. Customer IDs supplied on intake are accepted only from authorized staff and must already exist in the tenant. A staff-created receipt contact has no online identity. Claim codes expire in seven days, are stored as hashes, are handed out on the receipt, and grant no access until staff independently approves a verified Shopify account. Approval grants only that grading case; it does not merge customers, loyalty balances, orders or consignment records. Original physical card IDs and private file paths remain stable.

Customer projections include their own findings, notes, per-card result, event source/time and examination references. Batch references/tracking, other owners, pooled totals, claim tokens and private audit reasons are excluded. Claimed-case downloads recheck case ownership before issuing a 60-second Supabase signed URL. Live uploads validate type/magic bytes and a 5 MiB bound, lock grading cards against concurrent reversal and audit completed uploads. Image storage delivery is still externally unverified.

All amounts use integer USD cents. Every intake snapshots its rate and settings version. The detail subtotal counts the complete intake in SQL, even if a dashboard limit is reached. External grading, shipping, insurance, tax and other charges are unquoted. An existing reconciled Shopify order can be linked only when its verified owner owns or has an approved claim to the intake. The link creates no payment or revenue and copies no order total into examination fees. External staff payments record source, exact reference, date and examination amount separately; unique source/reference keys prevent duplicate recording. No code here writes the Shopify order ledger, sends payment requests, awards points or creates charges. Existing references/history are immutable; operational corrections append events with actor, source, time and private reason.

## Import contract

CSV inputs: UTF-8/BOM, quoted CSV supported, unique headers, 1–100 rows, at most 30 columns and 256 KiB. Each row represents a new intake; quantity 1–50 creates distinct physical cards, with at most 500 new cards per import. Required mapped fields: external_id, customer_id (exact UUID), description, quantity. Optional sport/year/manufacturer/card_set/card_number/parallel. No email lookup or automatic customer reparenting.

The server saves the normalized preview, source, rate/version, fingerprint and row outcome. Commit requires reviewer confirmation and a reason, rechecks the rate and customer/duplicate state, and uses a transaction/advisory lock. Identical repeated external IDs are no-ops; differing contents require staff correction outside import, not silent replacement. A reversal is atomic and permitted only before later card changes, files, payments, receipt claim codes/requests or batch membership. It cancels the created cards and voids intakes without deleting history or freeing IDs. Later activity requires an audited per-card correction. This release imports new intakes; it does not infer external-provider status or payment feeds. CSV exports escape spreadsheet formula prefixes.

Operational lists are bounded: 500 recent cards/customers, 100 batches/claims, 50 imports. Intake detail totals cover the full intake. Larger operational reporting/pagination is not provided by this release.

## Hosted setup when account access returns

Follow SETUP-PROMPT-2.md and SETUP-PROMPT-3.md first. Keep fixtures off in the hosted runtime. Run the versioned migration command with private migration-owner credentials to apply **004** after 001–003. Do not manually grant the runtime role migration-owner, service-role, superuser or bypass-RLS privileges. No sample customers, sessions, cards, orders or payment references are seeded by production migrations.

Verify on a private staging environment:

- Invited owner/operations can create intake; read-only/content-editor/customer roles cannot write it. Owner/admin alone can change settings.
- Two real verified test accounts with one shared batch see only their own cards, exports and files. Cross-tenant, forged IDs and unapproved receipt claims are denied.
- A receipt contact can claim only after independent staff review; an approved claimant can make a decision and download only its case files.
- Real private Storage image upload, signed download expiry, token refresh/logout and no-store behavior work over HTTPS. Confirm these on an actual phone.
- Reconciled test Shopify order ownership is verified before linkage; unrelated orders fail and no duplicate examination revenue appears. Recording a reference alone never establishes a paid Shopify order.
- Reviewed sample imports/reversal, stale-version conflicts, shared batches and partial returns survive hosted process restart and database backup/restore.

Provider APIs are optional and absent. Do not label staff milestones as provider verified or publish the unconfirmed provider. Automatic source integrations, consignment, loyalty earning and future in-store tools are later stages.
