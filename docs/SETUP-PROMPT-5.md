# Prompt 5 — consignment portal

Stage-specific implementation record. For the current combined handoff, see [RELEASE-REPORT.md](RELEASE-REPORT.md).

Implemented and tested locally. Fanatics Collect remains disconnected. Real customer/staff authentication, hosted database/Storage and partner data access are externally unverified. The app does not initiate payouts, change Shopify, or award loyalty points.

## Local demonstration

Run `./scripts/preview.sh` from the project root; use **http://127.0.0.1:3000**. No password reset, cloud login or real credentials are needed for the labeled local sample workspace. Use only fictional information.

Staff: **http://127.0.0.1:3000/staff/consignment**

1. Items includes examples of an unsold listing, a sale with unknown fees and a partial settlement. Open each to see the difference between asking price, staff-verified sale, known/unknown fees, estimated net and recorded settlement.
2. New intake → choose an exact verified sample customer → record one physical card, its received date and optional channel/references. Amounts use USD integer cents. Leave unknown amounts blank. Each intake/item/card gets a permanent internal UUID. Add images and later edits through the item detail.
3. Edit item → record a supported status, customer-visible notes and a private reason. A new/changed sale amount requires an evidence reference. Missing sale evidence is rejected; Sold cannot imply Paid. Descriptions can be corrected with an audit entry. Current history wording and timestamps are preserved.
4. Record an existing settlement → enter amount, unique external reference, date and private evidence. A verified sale and known fees are required; partial amounts accumulate and full settlement is derived only when recorded total equals known net. Excess amounts are refused for review. A zero-net confirmation is allowed only for confirmed zero net. This records evidence and cannot send money.
5. Correct a recorded settlement through its reversal form. The compensating entry retains the original. Duplicate references/reversals are rejected. Financial values with active settlement entries must be reviewed/reversed before a financial correction. Negative estimated net requires staff review; no negative transfer is initiated.
6. Imports & matching → download `public/samples/consignment.csv`, upload it or paste it into the CSV text option, read/map columns and build a preview under a stable source name. One sample has an exact A customer ID; another is intentionally unmatched. The included IDs are local sample IDs only.
7. Open the saved review queue. Approve the unmatched row only after independently checking receipt/partner evidence and selecting an exact verified account or existing item. A card title/email is not a match. Inspect all incoming and current values, explicitly reject invalid/conflicting rows or correct the source file, and confirm the reviewed import with a reason/evidence reference.
8. Re-import the identical file/source: no duplicate items and no overwrite of manual corrections. Changed external data needs a later source timestamp and a fresh review. A staff change after preview blocks commit until a new preview is reviewed. Optional blank incoming fields preserve known values. Paid status from a spreadsheet is not a shortcut to recording a settlement.
9. Partner access shows every provider capability unavailable. See `FANATICS-DATA-REQUEST.md` for the drafted information request; no message has been sent.

Customer: **http://127.0.0.1:3000/my-cards/consignment**

Select sample A → open the fees-pending item: net remains Unknown. Open the partial-settlement example: its $100 fictional sale, $20 fees and $80 estimated net are distinct from its $30 recorded partial settlement. Switch to sample B: only B's own item(s), images and history appear. Customer exports are similarly scoped. Any extra browser-validation examples are explicitly labeled SAMPLE.

## Data and authorization

Migration **005** extends the existing `ns.consignment_items` table without discarding old rows. It links intake/case/card/customer IDs with composite foreign keys and adds references, received date, channel, price/verified sale/fee fields, status, notes, version and source timestamps. Separate tables store immutable public events, private audit records, immutable settlement/correction entries, stable approved external ownership mappings and staff-only import rows.

Live private routes use the existing refreshed Shopify or invited staff session, authenticated server actor, transaction-local `ns.context()` and least-privileged runtime role. Customer selection is accepted only from authorized staff and must map to an existing verified account; customer reads use both explicit ownership filters and RLS. Read-only staff cannot write; content editors cannot read private consignment records. Customers cannot access the import queue/private audit or mutate items/settlements. Payout details and evidence never enter marketing payloads or analytics logs.

Northside intake-before-account claims from grading remain case-specific and do not grant consignment access. Unmatched consignment rows stay in the staff review queue until an exact verified account is approved. No customer reparenting or email/title matching is offered.

Amounts are explicit USD cents. `null` remains unknown, while confirmed zero is numeric zero. A sale value is exposed as verified only after staff evidence is recorded. Net is an **estimate** of verified sale minus known total fees, never a promise or proof of payment. Settlement status is calculated from active recorded entries; Sold alone remains unpaid/unconfirmed. Payout records are informational and do not call any payment provider, Shopify financial write or loyalty ledger operation.

Source labels are `northside` and `reviewed_csv`. Reviewed spreadsheets are Northside evidence, not a provider-verified feed. Last Northside update and the last reviewed source timestamp are displayed separately. Corrections append events/audit; no history rewrite. Row versions and item locks reject stale edits. The external link identity cannot be remapped in place.

Images reuse the private upload/storage path and signed-download authorization. The sample attachment is a known labeled illustration only. Live uploads remain bounded to 5 MiB with MIME/magic validation and audit metadata. Actual hosted Storage delivery/expiry has not been verified.

## Import contract

CSV is bounded to 256 KiB, 1–100 rows, 30 unique columns and the existing parser's 10,000-character record bound. Each row is one physical item. Required mapped fields: stable `external_id`, description, supported `state_key`, explicit `currency=USD`, and a past ISO timestamp with timezone in `source_updated_at`. New records require a received date and an approved exact customer match. `customer_id` and/or `item_id` can provide explicit identifiers; blank ownership enters the staff queue. Existing external links take precedence and conflicting identities cannot be rematched.

Optional fields cover channel, asking/sale/fee cents, provider item/submission/listing references and customer notes. Blank optional cells preserve existing values and remain unknown for new records; clearing an existing known value requires a manual audited edit. Sale amounts require the reviewer's explicit evidence confirmation. Payout/settlement entries are recorded individually after verification; CSV import does not infer paid or parse a partner payout feed.

The full normalized incoming row and the current item snapshot/version are saved before review. Exact repeated source/external ID/fingerprint is a no-op, including after manual corrections. Changed data with an equal/older source timestamp is conflicting; a later source timestamp still needs explicit review. Commit takes an import lock, rechecks versions/ownership/source timestamps, and applies the batch atomically. Unmatched/error/conflict rows block commit until resolved or explicitly rejected. Updates use the same audited manual services. A failed commit does not partially apply the batch. Payouts, images and private notes are not fetched from arbitrary URLs in CSV.

The scope is reviewed intake/status/financial-information import and compensating manual corrections. Unlike grading's untouched-intake reversal, there is no bulk rollback for consignment imports that may update pre-existing financial records. Preserve the import record and use explicit item/settlement corrections. Exports neutralize spreadsheet formula prefixes and preserve unknown amount cells as blank.

Lists are bounded to 300 recent items, 500 customers and 50 import batches. Queue count includes all unresolved rows; larger historical queue browsing/reporting is not implemented. Staff should resolve pending rows before growing beyond the displayed batch window.

## Local persistence and hosted setup

Grading and consignment share the ignored local PGlite database at `work/grading-preview/`. The consignment preview applies migration 005 locally once, preserving prior grading records, and seeds only fictional consignment examples if no consignment items exist. The same services run under actual runtime roles/RLS. Data survives browser refresh and database/server restart. Use one preview process for this directory. This filesystem is sample storage, not a hosted database or Vercel persistence layer.

The preview route requires explicit non-production fixtures, a loopback Host and same-origin writes, with only fixed fictional actors. Production returns 404 even if fixture opt-in is set. Real private routes never fall back to fixtures.

When account access returns, follow setup for Prompts 2–4, then apply migration 005 with the private migration-owner connection via `pnpm db:migrate`. Keep application roles non-superuser/non-bypass-RLS and fixtures disabled. Production migrations do not seed sample customers, sessions, items, amounts or payouts. Back up hosted data before migration; do not drop the new tables to undo reviewed financial history.

Verify a private staging deployment with two real verified customers plus a different tenant, invited staff role limits, private image upload/signing/expiry, a safe sanitized import/review/correction flow, database restart/restore and actual phone logout/cache behavior. No live Fanatics adapter should be enabled until the partner contract, field coverage and permitted read-only access are supplied and tested. Read `FANATICS-DATA-REQUEST.md`; do not infer private consignor coverage from Shopify inventory sync.

Validation: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Against a temporary production server with test-only APP_ORIGIN and no credentials, run `node scripts/consignment-smoke.mjs` alongside the existing smoke scripts. These are local rejection/privacy checks, not proof of real partner or cloud integration. Prompt 6 was subsequently authorized and implemented locally; see SETUP-PROMPT-6.md and STATUS.md.
