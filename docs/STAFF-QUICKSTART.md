# Northside staff quickstart

This guide describes the implemented workflow. **The current local preview contains only labeled SAMPLE records.** Use fictional information there. Real staff/customer login, hosted files and Shopify transactions still need verification. Start at `/staff`; customers use My Cards, Rewards and Account. Staff sign-in is invitation-only, with no public signup.

Owner/admin can manage settings and approvals within their assigned role. Operations handles cards, batches, imports and breaks. Read-only staff can inspect permitted records/export but cannot edit. Content editors can manage break/show content and cannot read private card/payout/reward operations. Joey's real loyalty approval is a separate required decision.

## Grading intake and customer access

1. Open **Grading desk → New intake**. Select the exact verified customer. If they have no online account, create a receipt contact and select that exact contact. Typing an email never grants case access.
2. Describe the physical cards and enter sport, year, maker/set, number, parallel and quantity. Each card receives its own permanent ID. The default examination is **$5 per card**: three show **$15 examination subtotal**. External grading, shipping, insurance, tax and other charges remain separate and unquoted.
3. Save with a private verification reason. After an uncertain save, reload and inspect before submitting again. Open a saved card to add findings, customer-visible notes, images and examination payment evidence. Local images are sample illustrations; real files require private hosted Storage.
4. Update status and give a reason. Customer-visible history shows Northside-recorded milestones and the last update. Keep private notes in the private reason field. Never call a staff entry provider verified or promise a grade/turnaround.
5. At **Awaiting customer decision**, the authenticated customer can request submission or return. That request does not mean the cards were shipped or returned. Record physical events when staff has evidence.
6. For a receipt contact, issue the private case-specific receipt claim code. The customer must sign in with Shopify and submit it. Staff **Claims** independently verifies receipt/identity evidence before approval. Approval covers that case only; it does not merge other accounts or consignment records. Never grant access from email or a case number alone.

## Group submissions and returns

Use **Batches** to create a provider/reference and enter confirmed carrier/tracking information. PSA is configured; the second provider described as “BGP” stays internal/unconfirmed. Select the exact cards, including multiple customers where appropriate. Batch details and other owners' cards stay staff-only.

Record an appropriate milestone on the selected included cards. For a partial return, select only the cards physically returned; leave the rest in their existing state and record exceptions individually. Add each card's result/certificate on its own record. Use a new correction event for mistakes; never rewrite history.

## Grading imports and examination references

Download the sanitized grading CSV in **Imports**. Use a stable source name and stable external row IDs. Upload/map the columns, build the saved preview, review every row, then confirm with a reason. Exact repeated rows are skipped; conflicting ownership/data must be resolved, not silently replaced. One row can create several unique physical cards. Reversal is available only for untouched imported intakes; later activity needs individual audited corrections.

Link an already reconciled Shopify order only when its verified owner owns/has approved access to that intake. Alternatively record an actual external payment source/reference/date/amount. A typed reference creates no charge or Shopify sale. Never count it a second time as retail revenue.

## Consignment and customer matching

1. Open **Consignment desk → New intake**. Select the exact verified customer and record one physical item, received date and known partner/listing references. Keep unknown amounts blank.
2. Record operational status with a private reason. An asking price is not a sold amount; recording a sale requires evidence. **Sold does not mean paid.** Net stays unknown until sale and fees are known; displayed net is an estimate, not a transfer.
3. Record each verified external settlement separately with amount, date, unique reference and evidence. Partial settlements accumulate; amounts above known net need review. Correct a settlement with its reversal form, preserving the original. This app cannot send money.
4. For CSV, use **Imports & matching**: load the sanitized template, map columns, choose a stable source, and save a review. Missing ownership stays unmatched. Independently verify exact customer/item IDs and partner/receipt evidence before approving a match; title/email are insufficient.
5. Review incoming versus existing values, timestamps and conflicts. Reject bad rows or correct the source; confirm only when every remaining row is resolved. A manual change after preview requires a fresh review. Repeat files do not overwrite later corrections. Blank optional cells preserve known values. Paid in a spreadsheet is not settlement proof.

Fanatics access is **disconnected**. Manual records remain usable. Steve must obtain the actual partner data contract; the draft request in FANATICS-DATA-REQUEST.md has not been sent. Financial import corrections use explicit item/settlement events, not bulk deletion.

## Break setup, purchased spots and exceptions

1. In **Breaks desk → Schedule**, enter the confirmed title, products, host, format, capacity, terms, image, Chicago time/offset and real watch/replay links. Save an unpublished draft until reviewed. Dates are stored in UTC. A countdown never changes a break to Live; staff must explicitly record the actual state.
2. **Spot mappings & sale checks** must identify the exact Shopify product/variant/SKU for each named spot, or a finite pooled variant with its real capacity. Named variants require capacity one and tracked finite stock. Keep Retail Floor, Breaker Storage and Excess Storage separate. Do not activate Draft products or change stock in this app.
3. Enter independently verified **legacy external purchases** with the exact customer/mapping/payment evidence before offering remaining capacity. They hold a spot and remain separate from Shopify revenue and loyalty. Social messages/cart attributes do not establish paid ownership.
4. Complete [BREAK-SALE-CHECKLIST.md](BREAK-SALE-CHECKLIST.md) for the current event version. Real Shopify last-spot concurrency and fulfillment checks remain pending. Saving a checklist does not enable public purchases.
5. Inspect **Purchases & legacy** and the review queue. Only verified current Shopify paid lines can confirm app purchases. Failed/expired checkout grants nothing. Duplicate deliveries reconcile once. Unknown customer/variant, over-capacity or missing paid lines remain in review; never assign a contested spot twice.
6. Refunds retain capacity until an eligible reviewed release. Before-start releases are capped to verified refunded/canceled quantity; an event that has started cannot reopen through this action. Record the business outcome and reconcile Shopify separately. Closing an exception alone does not grant/refund/release a purchase.
7. Delays/cancellations update saved reminders and cancel pending notifications. Customers should re-download calendar files after schedule changes; downloads are not subscriptions. Real calendar-client behavior still needs testing.

## Rewards, notifications and daily checks

At **Rewards desk**, review ledger consistency, negative balances, held reservations and failed jobs. Do not overwrite balances or issue a second code after a timeout. An uncertain voucher retains its original code and point hold until reconciliation. Corrections/restorations need the permitted role, evidence, a reason and the original debit cap. Joey must approve real economics before launch. Follow [LOYALTY-RECONCILIATION.md](LOYALTY-RECONCILIATION.md).

At **Engagement**, review generic in-app updates, delivery jobs, show records and approved QR placements. **UNSENT** means no provider delivery; **accepted** means the provider accepted it, not that a phone displayed it. Email/push are disabled. Exported metrics include source, period, definitions and unmatched/refund amounts; consignment payouts are not retail revenue. SAMPLE exports must never enter real performance reports.

Before each operating day, check Integration health, overdue/failed jobs, unmatched imports, break conflicts and reward holds. Escalate configuration failures to Steve and operational/payment evidence to the appropriate manager. Reload after an uncertain request; do not delete history to remove an error. Resolve queues before the documented recent-list limits are exceeded. Actual scanner, aisle directions and pickup stay disabled until the separate store activation checklist passes.
