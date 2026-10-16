# Loyalty reconciliation and recovery evidence

September 12, 2026. Local evidence only. No real Shopify discount, purchase, refund, POS scan or hosted worker has been tested. Public loyalty earning/redemption, purchases and all future in-store gates remain false. Joey’s actual economics remain unapproved.

## Local verification report

The full suite passes **94 tests**: 3 policy tests plus 91 TypeScript tests. Prompt 6 adds 24 tests across the ledger (9), redemption (7), Shopify contract (4) and reporting (4) files, retaining the previous 70. Tests run the actual migrations and service transactions on PGlite, not a stubbed SQL interface. Shopify HTTP responses are mocked; the crash simulator keeps provider evidence outside the rolled-back local transaction. Concurrent requests run through PGlite’s serialized transaction engine and exercise the same locking/idempotence service paths; they do not prove real multi-connection PostgreSQL contention behavior.

| Invariant / failure case | Local result |
| --- | --- |
| Unapproved settings cannot earn/redeem live | PASS: hard gates, draft-only versions, immutable approval and sample-production separation. |
| Duplicate paid/reconciliation/source events | PASS: same financial result, unique source operation, no cache change on an ignored duplicate insert. |
| Eligible retail only; discounted net; tax/shipping/gift/services excluded | PASS: service/registry allocation tests and mocked Shopify monetary fields. Actual checkout tax/discount configuration remains unverified. |
| Partial refunds in different partitions, full refund and zero line | PASS: property loops keep target in original bounds and full reversal at original allocation; cumulative partial/refund order tests converge. |
| Cancellation before paid, stale delivery, line removal/discount edits | PASS: current snapshots preserve cancellation/refunds and frozen allocations; unsupported increases/malformed lines enter review without partial posting. |
| Anonymous, prelaunch/pre-enrollment and forged customer claims | PASS: exact verified mapping required; repeated later reconciliation cannot bypass the original enrollment timestamp. |
| Negative balance after earning reversal | PASS: signed debt retained, spendable zero and review; no free zero-clamp credit. |
| Cache versus immutable ledger | PASS: explicit reconciliation detects a corrupted cache and financial operations refuse it. |
| Two redemptions, retry UUID, double/stale worker | PASS: holds share one spendable balance; one voucher/debit per reservation; lease/token checks prevent old completion. |
| Shopify timeout and crash after remote creation | PASS: stable-code lookup recovers evidence and issues once; uncertainty preserves hold, proven initial rejection can release it. |
| Customer, value, minimum, stacking, eligibility and expiry response | PASS: strict mocked Admin contracts reject wrong/partial evidence; this does not prove actual checkout enforcement. |
| Cart owner, applicability and another discount | PASS: mocked Storefront contract binds owner, reads applicability and rejects conflicting applicable codes. |
| Voucher reuse / other-customer paid usage | PASS: paid usage recorded separately, duplicate order no-op, wrong owner/reuse review. |
| Cancellation/refund restoration and late paid order | PASS: deactivation, independent clearance and original-debit cap; stable source no duplicate; late paid usage after unused credit enters review. No automatic restore. |
| Tenant/customer/role privacy and database restart | PASS: actual different-tenant SQL checks, worker denied session access, authenticated owner scope, private staff permissions and database close/reopen persistence. |
| Analytics / cohort contract | PASS: separate earning/reversal/exchange/use amounts, explicit exposure, tier snapshots, source/period labels and suppressed small cohorts. |

Build, typecheck and lint passed. All **58 production HTTP checks** passed: previous 48 plus 10 loyalty checks for no-store/no-sample shells, fixture GET/POST denial, session-required wallet/staff/export/reconciliation, cross-origin exchange refusal and the disabled real cart route. The production server was deliberately given fixture opt-in to verify it still rejects samples.

Browser evidence: sample A exchanged 500 from 1,250 points, simulated a timeout while the 500-point hold remained, then recovered the same voucher with exactly one -500 debit. Reload retained a 750 balance and zero hold. B’s not-enrolled view contained no A history/voucher; enrollment showed zero. Staff saved version 3 at 11 points/dollar as an inactive SAMPLE draft while version 2 remained the active fixture. Wallet desktop and phone layouts were visually inspected; phone document/viewport measured 390/390 pixels and the long code wrapped. All sample codes remain unusable at Shopify.

The [saved JSON checkpoint](loyalty-local-checkpoint.json) includes the precise local sample period, measurement time, metric definitions and reconciliation result.

## Run the report

Authorized staff: Rewards desk → Reports → Ledger reconciliation. For a private JSON result use `GET /api/private/loyalty?reconciliation=1` through the authenticated app. The sample equivalent is confined to localhost fixture mode. It reports checked time/source, account count, discrepancies, negative-account count and current holds. It reads the complete saved account set even though the member list is bounded.

Checks compare each cached account with `sum(loyalty_ledger.points)`, verify every issued reservation has a voucher and an exchange debit equal to its reserved cost, reject voucher mappings attached to a non-issued reservation and flag restoration sums above the original debit. Negative balances are reported separately from consistency errors. Holds are not debits. A zero-issue local report is not evidence that Shopify has no missing, orphaned, edited or used discounts.

At the browser checkpoint before any further demonstration edits: 2 enrolled sample accounts, 1,250 gross earned points, 500 exchange debits, 750 outstanding signed points, zero holds, one issued voucher, zero recorded used vouchers, zero observed Shopify discount cents, one Rookie and one Vet, zero consistency issues. These are fictional records on this Mac, not store performance. Subsequent sample actions can legitimately change the checkpoint.

## Recovery runbook

- **Pending / uncertain issuance:** inspect reservation and job together. Keep its code and hold; let the due worker look up that exact code. Never create a replacement reservation/code to “fix” the original uncertainty. Matching evidence completes one debit/voucher atomically. Contract mismatch or exhausted retries stays in review until an authorized operator resolves provider facts. Staff retry retains attempt history.
- **Crash / duplicate worker:** allow the lease to expire; a new worker reclaims it and looks up the same code. The old lease cannot commit. Verify exactly one mapping/debit afterward. On hosted PostgreSQL, exercise this with two actual processes and injected disconnects before enabling real rewards.
- **Proven creation failure:** only the explicit first-attempt rejection plus confirmed code absence can release a hold automatically. Missing network responses, an expired local lease or a subsequent error after uncertainty are not proof of absence.
- **Refund or negative points:** reconcile the latest complete verified order. Keep immutable original allocations and append the required signed delta. Unknown monetary allocations, incomplete reads and increased existing lines require review. If debt is correct, leave it negative; an exceptional staff correction needs a separate reasoned entry and must not rewrite the original award.
- **Unused voucher cancellation / expiry:** suspend affected new exchanges if necessary, request deactivation, wait for confirmation, independently inspect paid and pending checkout evidence and outstanding order jobs, then record the evidence reference before an authorized capped credit. `asyncUsageCount=0`, a cart abandoned message or a past expiry timestamp is not clearance. A late paid event after a credited cancellation opens review; resolve its consequences explicitly.
- **Used voucher refund:** reconcile the paid usage and current refund/cancellation first. A manual credit is separate from reversing purchase earnings and cannot exceed the original exchange minus prior restorations. Preserve the same source UUID on an uncertain submission; new partial approvals still share the original cap. An automatic fractional allocation policy is not implemented.
- **Cache discrepancy:** block new financial operations, investigate the immutable entries and trigger/role history. Do not fix customer points with a direct cache overwrite. Rebuild a cache only through an independently reviewed maintenance operation from the ledger; the UI exposes no balance overwrite. Business corrections remain new ledger entries.
- **Database restore / migration recovery:** keep gates off, preserve the failed state and backups, apply a forward migration if needed, then reconcile Shopify’s still-existing codes and paid usage against restored reservations before resuming. Never rerun an already-applied edited migration or delete original ledger history. Restore testing against hosted PostgreSQL remains outstanding.

## Authorized Shopify verification still required

Record evidence privately, with only redacted outcomes in this repository. No checkout has been authorized/performed in this stage. Keep Draft products and the three inventory pools unchanged until a separately authorized test setup is concrete.

| External check before live rewards | Required evidence / current state |
| --- | --- |
| Approved economics and identity | Joey’s verified invited staff record, approved version/reward snapshot/effective date and independently confirmed product registry. Pending. |
| Installed API permissions and schema | Real current installation with order and discount access, correct 2026-07 contract, token rotation and proper Storefront channel. Pending. |
| Owned supported checkout | Eligible customer’s full fixed reward at or above minimum eligible spend, actual paid order and one-use enforcement. Pending. |
| Other customer / guest | Attempted use rejected for another account and without the eligible customer; switching accounts cannot retain authorization. Pending. |
| Minimum and exclusions | Below-minimum, excluded-only, gift-card and mixed carts; reward not partially wasted; empty/ineligible cart retains the issued voucher. Pending. |
| Discount combinations / unsupported modes | Product/order non-stacking, approved shipping combination, automatic discounts, accelerated checkout, tax configuration and subscription/test limitations. Restrict unsupported modes; do not generalize mock results. Pending. |
| Timeout / application crash | Real stable-code readback before retry, job/hold recovery and one committed debit/mapping. Pending. |
| Refund/edit/cancel event ordering | Paid then cumulative partial/full refunds; cancel-before-paid delivery; order edit and monetary-only refund review; tax/shipping excluded. Pending. |
| Voucher cancellation race | Confirm deactivation, independent pending/paid clearance and delayed payment outcome; no automatic points restoration. Pending. |
| Hosted concurrency and restore | Two worker processes, real PostgreSQL locks/leases/RLS, restart, backup restoration and provider reconciliation. Pending. |
| POS later | Customer-bound discount eligibility and documented QR-link scan on actual POS, separate from product/location QR. Scanner remains disabled. Pending. |

After successful authorized checkout verification, record evidence and review the additional worker verification flag. Public gate changes require a separately reviewed launch change. Local completion does not assert provider completion.
