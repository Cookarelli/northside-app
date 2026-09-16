# Marketing Hub engagement export — v1

Contract: `northside.engagement.v1`. Manual review/import only. This app did not connect to or change Marketing Hub.

The UTF-8 CSV from `/staff/engagement` is a report with metadata, event rows, Shopify-channel totals and a separate legacy-evidence section. It is not a stream of raw customer events. Fixture downloads start with `SAMPLE LOCAL FIXTURES — NOT BUSINESS PERFORMANCE`; reject them from real business reporting.

| Field or section | Meaning |
| --- | --- |
| tenant | Authorized Northside tenant ID; never a browser-selected customer/tenant identity |
| start_utc_inclusive / end_utc_exclusive | Paid-order cohort and observed-event interval; 1–366 days |
| campaign / source | Exact approved lowercase field or `all`; first observed eligible touch reporting |
| last_sync | Most recent measured order reconciliation, or `never`; not a real-time promise |
| event / count / definition | Distinct event categories listed below; definitions travel with the export |
| channel / unique_paid_orders | `online`, `pos`, `other_shopify`, kept separate; deduplicated tenant/order IDs internally |
| gross_cents / refund_adjustment_cents / net_cents | USD integer cents received, refunded and net received, including Shopify tax/shipping as applicable; not item-only merchandising revenue |
| unattributed_orders | No matching approved first placement; retained instead of discarded |
| external_legacy_evidence_records | Existing legacy break-payment lines, unique external references, recorded amount and voided count; separate evidence, unknown refunds, no inferred net or Shopify conversion |
| consignment | Excluded from retail revenue; operational payout data and private provider figures do not enter this export |

Events: `landing_view`, `install_prompt_accepted`, `signup_completed`, `meaningful_activation`, `product_view`, `checkout_initiation`, `verified_purchase`, `saved_break_reminder`, `grading_status_view`, `vendor_interest_submission`.

An install-prompt acceptance is not independently confirmed installation. Signup is a verified new identity with eligible analytics consent, not an account page visit. Activation is the first authenticated saved reminder, owned grading-status view or notification read; landing alone never qualifies. Saved reminders and grading-status views count unique customer/record pairs rather than refreshes. Purchase counts require server-read paid Shopify financial/transaction evidence; repeat receipts/refunds never add a second purchase. Test orders are rejected by the live reader.

Attribution is descriptive. First/latest eligible observed references, timestamps and consent are retained internally; the report uses first touch. No UTM value proves ownership or payment. Cookie loss, consent denial, cross-device browsing, unobserved prior visits, provider restrictions, blocked scripts and future app-store transitions can leave orders unmatched. Legacy evidence is unmatched and is excluded when filtering by a campaign/source. Refunds restate the original paid-date cohort; use overlapping refreshes/upserts of a report period rather than appending each download as new revenue.

No email, phone, customer ID, raw visitor token, service case/card ID, card description, private grading/consignment image, payout amount, subscription endpoint/key, checkout URL or order ID is exported. Case/record deduplication uses one-way internal hashes and never a raw operational identifier. Do not join advertising vendor conversion totals by addition; those platforms may attribute the same order differently. Shopify pixels do not automatically cover this custom app.

Before a live import, agree on period replacement semantics, currency and tax/shipping treatment, timezone conversion, consent/retention policy, handling of unknown channels and unmatched attribution, and the Marketing Hub owner’s schema. API streaming, reverse writes and a live connection are outside this stage.
