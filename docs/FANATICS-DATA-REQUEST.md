# Fanatics Collect partner data request — DRAFT, NOT SENT

Prepared for Northside's partner contact. Northside's partnership is confirmed by Steve. The connector identity and customer-specific data coverage have not been verified. This document requests information; it does not authorize installation, access changes, publication, scraping or money transfers.

## Current evidence

| Contract detail | Verified value |
| --- | --- |
| Shopify connector name / publisher / installation | Unknown |
| Partner API documentation URL and document version/date | Unknown; no partner specification supplied |
| Authentication scheme / credential owner / rotation | Unknown |
| Read permissions, tenant scope and consignor scope | Unknown |
| Rate limits, quotas, pagination and retry rules | Unknown |
| Inventory/order synchronization directions | Unknown |
| Consignor identity mapping | Unknown |
| Submission / listing / sale / fee / payout field coverage | Unknown |
| Webhook / export availability and authentication | Unknown |
| Sandbox / authorized test access | Unknown |
| Live integration test evidence | None |

The implemented `FanaticsCollectAdapter` is a Northside interface with explicit capabilities. Its disconnected implementation makes no provider requests, returns no invented records and advertises every provider capability as unavailable. Proposed normalized fields in code are **not** evidence that the partner supplies them. Manual Northside records work independently.

## Questions for the partner

1. What is the exact Shopify connector name, publisher and supported installation path? Please provide current official partner documentation, its version/date and a technical contact. Is the connector for marketplace merchandise, consignor operations, or both?
2. Which inventory/product/order directions are supported? Does it write Shopify products, publication/channel assignments, stock, locations, orders or fulfillment settings? Can read-only access be used? Northside's products are Draft and its retail, breaker and excess inventory pools must stay separate and unchanged during verification.
3. Does this access include individual consignors, or only Northside's aggregate partner account? What stable partner consignor ID is available? How can Northside establish an approved match from that ID to its verified customer and intake/item IDs? Email or card title alone is insufficient.
4. Which stable item, submission, batch and listing identifiers are returned? Can multiple physical cards share one listing? Can one card be relisted or receive new identifiers? How are merged/split submissions, duplicate records and identity corrections represented?
5. Which operational statuses, timestamps and history events are exposed? Please define received, processing, listed, sold, returned, exception and settlement states. Which timestamps represent the event, source update and export generation? How are late/out-of-order corrections represented?
6. Are asking prices and verified sale amounts available separately? Are amounts gross or net, and before or after buyer premiums, seller charges, discounts, taxes and refunds? What explicit currency/precision applies? How are unknown values distinguished from confirmed zero?
7. Are all fee components available, including commission, handling, shipping, insurance, adjustments, tax and other deductions? When are fees final, estimated, withheld or unavailable? Can fees exceed sale proceeds? Provide each field's definition and inclusion in net proceeds.
8. Are payout/settlement status, reference, amount, date and per-item allocation available? Are partial settlements, grouped payouts, holds, reversals, failed transfers, chargebacks and refunds supported? What identifies each distinct settlement and correction? How are unallocated pooled amounts represented without exposing other consignors?
9. Is an authenticated API, webhook stream or scheduled CSV/export available for these operational fields? Please provide sanitized schemas and examples for ordinary records, unknown fees, partial settlement, return, correction and an unmatched consignor. Merchandise sync alone does not establish payout coverage.
10. What authentication and exact read scopes are required? Who owns the credentials and how are tokens created, refreshed, rotated and revoked? Are there IP restrictions, per-partner access controls, data retention requirements or production/sandbox separation? Share credentials only through an approved private channel, never this document or source control.
11. What are the request/export quotas, rate-limit headers, pagination/cursor stability, retry/Retry-After rules and maximum batch sizes? How can a client detect a complete initial import, incremental changes and a missed update without deleting valid manual records?
12. For webhooks, what are the signature/raw-body verification method, event ID, ordering guarantees, delivery retries and replay procedures? For exports, are external IDs and source update timestamps stable across repeated files? How are deletions and corrected fields represented?
13. Is there a sandbox with at least two distinct test consignors and sample submission/listing/sale/fee/partial-payout data? What authorization is needed for a read-only production verification? Does access or the Shopify connector require a paid plan, and what exact account capability does it enable?
14. Can approved manual corrections be preserved with a documented conflict-review process? Which source should own each field, and how can Northside distinguish stale provider data from a new verified correction?

## Evidence needed before enabling a live adapter

Obtain the actual versioned contract, read-only authorization and sanitized examples. Record the tested version, authentication method, scopes, limits and field coverage in `docs/INTEGRATIONS.md`. Exercise two-consignor isolation, stable mapping, repeated/out-of-order updates, unknown fees, partial settlement allocation, outages and recovery. Require explicit staff review for unmatched/conflicting records. Retain manual history and corrections. Do not infer live access from a successful Shopify merchandise sync.

Money transfers are outside this application's consignment scope. The portal records verified external settlement references for information only. No partner message, credential request, account installation or test transaction has been sent or performed by creating this draft.
