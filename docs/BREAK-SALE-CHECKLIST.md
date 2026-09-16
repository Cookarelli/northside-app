# Before-sale break reconciliation

Use for **every event before opening sales**. No actual event has passed this checklist. The local sample checklist is a fictional exercise. Completing this document alone does not enable the global purchase gate.

| Record | Verified value / evidence |
| --- | --- |
| Event ID and title | Unconfirmed |
| Schedule version / UTC start / Chicago display | Unconfirmed |
| Staff reviewer and date | Unconfirmed |
| Selling format, capacity and customer terms | Unconfirmed |
| Host, products, watch/replay destinations | Unconfirmed |
| Physical card fulfillment and allocation of stock pools | Unconfirmed |
| Exact Shopify product / variant / SKU mapping | Unconfirmed |
| Existing external commitments and payment evidence | Unconfirmed |
| Shopify checkout concurrency test reference | Not performed |
| Open purchase/refund/ownership exceptions | Must be resolved with evidence |

1. Confirm the real selling format. Each named/team spot needs a unique tracked variant/SKU and capacity one. Identical pooled spots need one tracked finite variant and the real capacity. Do not infer random assignments. Confirm terms, shipping, cancellation/refund outcomes and physical card fulfillment. Never misclassify physical cards as downloads.
2. Reconcile retail, breaker and excess inventory separately. Inventory availability across Shopify locations is not proof of correct physical stock or fulfillment. Preserve all currently Draft products until an explicitly authorized, selected test setup is ready.
3. Enter every verified external purchase against an exact spot/customer with independent payment evidence, paid timestamp and original USD amount. Keep external revenue separate. Reconcile each variant's remaining capacity against Shopify; do not offer an externally held spot again. Record uncertainties and conflicting owners in review.
4. Verify exact product/variant/SKU identity, tracked stock, `DENY` continue-selling policy, ACTIVE status for the authorized test channel, physical shipping, and Shopify sellable quantity equal to currently unheld capacity. Confirm the actual retail/breaker/excess location routing separately. The app performs only reads.
5. Close every unresolved conflict relevant to the event, including unidentified break-order variants. Confirm ownership from Shopify's verified customer ID and actual paid line; cart attributes, messages, email matches or a checkout return cannot establish a purchase. Record the staff outcome. A resolution does not itself grant a spot.
6. Perform the real test-store concurrency matrix below. Record evidence before considering `SHOPIFY_BREAK_CHECKOUT_VERIFIED=true`. Keep the source-controlled public purchase gate off until the separate release decision and full real validation.
7. Record the current event version and evidence in Staff → Spot mappings & sale checks. Saving schedule content, adding/disabling mappings, adding external paid spots or releasing capacity closes this reconciliation. Repeat after any of those changes and immediately before sale.

## Required real Shopify matrix

| Exercise | Expected result / evidence to retain |
| --- | --- |
| Two signed-in customers, last named spot, concurrent checkouts | Shopify allows at most one successful paid purchase; loser gets authoritative unavailable state; app has one active allocation. Record both checkout outcomes and order/variant IDs privately. |
| Two customers request more identical spots than remain | Finite stock enforced across carts/checkouts; local slots cannot exceed mapped capacity. |
| Add to cart, abandon/expire, failed payment | No confirmed purchase or local allocation. Adding never reserves a spot. |
| Duplicate paid webhooks and out-of-order refund/cancel/paid | One purchase per paid line; fresh order state wins; no duplicate grants. Verify actual concurrent Postgres workers, not only local PGlite. |
| Partial quantity refund and monetary-only adjustment | Attributed quantity updates; ambiguous monetary state enters review; held capacity remains until an eligible reviewed release. |
| Refund/cancel before and after actual start | No automatic restock. Before-start release is capped and requires evidence; after-start capacity cannot reopen through this app. Record the business outcome. |
| Event delayed/canceled or mapping disabled while cart open | Checkout guard refuses stale sale state; saved in-app reminders follow the schedule; countdown never claims live. |
| Unknown/changed/deleted variant or paid line; missing customer | No inferred grant. Exact mapping/ownership review, with held prior capacity preserved. |
| Legacy external commitment competes with Shopify order | No duplicate active slot, no conversion to Shopify revenue or loyalty award; conflict retained for staff resolution. |
| Worker failure after claim, provider outage, late retry | Durable job remains retryable/reviewable, stale lease cannot complete, ledger/history remains intact. |

Retain evidence privately; do not commit tokens, buyer emails, cardholder details or raw customer exports. Capture a redacted pass/fail record and update STATUS.md. Actual Shopify, hosted database and calendar-client tests remain unperformed in this local delivery.
