# Prompt 7 — breaks setup and operations

Stage-specific implementation record. For the current combined handoff, see [RELEASE-REPORT.md](RELEASE-REPORT.md).

Implemented locally on September 12, 2026. This stage adds saved break schedules, calendar downloads, in-app reminders, paid-spot reconciliation and staff review. **Purchases remain disabled. No Shopify product, inventory, location, fulfillment setting, payment or refund was changed.** The local simulation is not evidence of Shopify checkout concurrency protection.

## Preview

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

- [Schedule](http://127.0.0.1:3000/breaks), including the next break on Home.
- [Staff break desk](http://127.0.0.1:3000/staff/breaks).
- [My breaks and reminders](http://127.0.0.1:3000/account/breaks).

The initial event, product descriptions, two named spot mappings, dates, prices and any simulated purchases are fictional. The supplied logo remains real brand artwork. Saved samples share the existing ignored `work/grading-preview/` database; grading, consignment and loyalty records remain intact. Do not remove that directory merely to reset a break demo. Hosted migrations seed no break events or paid spots.

Try these flows:

1. Open a break, save a reminder, choose an optional public alias and explicitly grant display permission. Reload: preferences persist. Switch sample A/B: private records stay with their owner. Permission can be withdrawn from My breaks even after the event is unpublished.
2. In Staff → Schedule, change a Chicago date/time with the matching CDT/CST offset and a reason. UTC storage and the in-app reminder schedule update together. A nonexistent spring clock time is refused; the offset distinguishes repeated fall times. Delayed, live, complete and canceled are explicit staff states. Passing the clock time never marks an event live.
3. Download the `.ics` calendar. It has a stable UID, schedule version, UTC start/end, escaped/folded UTF-8 lines and canceled/tentative status. A download is not a subscription: re-download after a schedule change and verify replacement behavior in the actual calendar client.
4. On the original sample event, Staff → Purchases & legacy offers fictional A/B paid orders for the same one-capacity North spot. A is confirmed; B stays in review with no allocation. Replaying does not duplicate the purchase. Simulate refund A: capacity stays held. No Shopify request occurs.
5. Enter independently verified external payment evidence against an exact mapped spot/customer. It is labeled external, holds capacity and never enters Shopify revenue or loyalty earning. A duplicate reference for the same mapping is idempotent. An occupied spot is refused. Voiding the legacy record requires external evidence; it does not refund money.
6. A staff release is possible only for verified canceled/refunded quantities, before the scheduled start, before any recorded actual start and while scheduled/delayed. Release cannot exceed the refunded quantity. It closes sale reconciliation; Shopify inventory still requires separate review. Started/canceled/complete events cannot reopen slots through this action. Record the business outcome in the exception resolution.

The browser validation left a delayed, published SAMPLE event at September 19, 2026, 7 PM Chicago, A's saved reminder and refunded-but-held purchase, B's conflicting purchase in review, and an unpublished SAMPLE draft. These are examples, not actual operating records.

## Data and permissions

Apply `202609120007_breaks.sql` using the existing migration runner **before deploying the updated order worker**. Do not edit already applied migrations 001–006. Migrations require the private migration connection; the app must use its restricted runtime/commerce roles. No hosted migration was run here.

- Runtime customer scope comes from the existing verified Shopify session and tenant. Own reminders, display preferences, purchases and safe purchase history are protected by RLS. Unpublished event context remains readable only for owned records. Public functions return spot counts and consented aliases, never customer IDs, buyer emails or legacy evidence.
- Owner/admin/operations can manage mappings, external evidence, checks, capacity releases and exceptions. Content editors can edit schedule content and create schedule audit entries but receive no private purchase/review data. Read-only staff cannot change records.
- The existing `northside_commerce` role receives break order/job/allocation access and read access to exact verified Shopify customer mappings. It cannot read sessions, auth tokens, grading or consignment data. It can close sales while reconciling but cannot edit public schedule content.
- Unique tenant/source/order/line identity prevents duplicate purchase records. A partial unique tenant/mapping/slot index prevents two active owners of a finite slot; composite foreign keys bind allocation to the purchase's customer, mapping and event. Slot limits are checked in SQL. Original purchase identity/evidence and mapping identity are immutable. Allocation release is irreversible; append-only purchase events and staff audit preserve history.

Mapping identities cannot be rewritten or reused across events. Disable a mistaken mapping and create a replacement event with reviewed mappings before selling; no silent reassignment of already mapped/purchased spots is supported. This intentionally conservative workflow requires review for order quantity increases, changed/missing paid lines, ownership changes, monetary-only/ambiguous refunds and unsupported financial states.

## Shopify contract and rollout

The Admin API remains pinned to `2026-07`. No app installation or grant is assumed. Configure the existing authenticated Admin reader and `COMMERCE_DATABASE_URL`, plus Storefront and Customer Account connections from Prompt 3. Reading variants requires `read_products`; InventoryItem is available under `read_products` or `read_inventory`. Order access needs the installed order scopes and protected customer access appropriate to the real installation. Older-order access must be separately verified.

The read-only variant proof checks exact product/variant/SKU, ACTIVE status, tracked inventory, `DENY` overselling policy, physical shipping and finite sellable quantity. At the before-sale check, provider quantity must equal mapped capacity minus locally held slots. Global sellable inventory does **not** prove the correct stock pool or fulfillment routing: staff must separately reconcile retail, breaker and excess pools and all legacy commitments. Draft products are never published or modified by this code.

Set `SHOPIFY_BREAK_CHECKOUT_VERIFIED=true` only after an authorized real test-store concurrency exercise with recorded evidence. This does not enable `publicFlags.purchases`; all six public gates still remain false. Use [BREAK-SALE-CHECKLIST.md](BREAK-SALE-CHECKLIST.md) for each event. Format, capacity, physical fulfillment, terms, host/time, legacy evidence and actual stream links require real confirmation.

The dedicated spot cart route accepts only a mapping ID and quantity and derives the variant on the server. The general add/update/checkout route also checks every mapped variant, so a direct variant request cannot bypass break policy. Break checkout requires a verified signed-in customer, a current approved schedule/check, open sales, finite remaining capacity, no unresolved event/global conflicts and fresh Shopify proof. Removal of a cart line remains possible when a sale closes. Cart contents never reserve capacity; Shopify confirms the final payment and availability.

A signed webhook only queues work. The existing order worker obtains a fresh Shopify order and durably enqueues both loyalty and break jobs in the same transaction. Run the two bounded passes after private configuration:

```sh
pnpm orders:work
pnpm breaks:work
```

No scheduler is installed. Schedule workers during hosted rollout and monitor pending/review/error states. The break worker uses two-minute leases, eight attempts, exponential retry backoff and per-order/event locking. Provider reads precede current-state reconciliation under the order lock. A stale or conflicting snapshot cannot reverse newer state. Expired leases are recoverable; old workers cannot finish a replacement claim. Missing credentials/provider failure do not grant a purchase.

The normalized current-order reader is shared with loyalty for verified payment timestamps, quantities and attributed refunds. Break purchase processing itself does not write the loyalty ledger or retail order ledger. Unknown owners never match by email. Unmapped retail-only orders are skipped; unknown variants on a break product/mixed break order enter review. Prior mapped lines that disappear enter review and retain holds. Existing completed receipts from before this rollout are not automatically backfilled: staff must queue exact order rechecks after mappings/ownership are verified. Queuing an order ID is not paid-order proof. In sample mode a manually queued recheck stays local and makes no provider request; use the explicit sample paid/refund exercise to simulate results.

Review queue resolutions record the outcome but never silently grant, restock or refund a spot. For a conflict that becomes resolvable, independently settle the business outcome and then queue a fresh Shopify recheck. Retained capacity remains a separate reviewed action. Previously manually released slots are never reactivated by replaying the same purchase.

## Bounds and remaining verification

Schedules: 100 rows; staff mappings: 500; purchases: staff 300/customer 100; audit/checks/exceptions/reminders/history: 100 each; customer selectors: 500. Event and variant capacity: at most 500; the shared cart allows 99 units per operation. Product notes: 30. Duration: 15–1440 minutes. Worker pass: up to 100 jobs, default 10. Add pagination before exceeding these operational bounds. No random assignment mechanism is implemented.

Images accept approved local artwork paths or HTTPS Shopify CDN assets. Watch/replay URLs allow exact Facebook, Instagram and YouTube hosts over HTTPS. No stream embed, chat scrape, automatic live detection or verified real social URL is claimed. Email/push delivery belongs to Prompt 9; in-app reminders never claim a notification was sent.

Outstanding: hosted migrations/RLS, real concurrent Postgres workers, restore/rollback, actual calendar clients, Shopify scoped reads, stock-pool/physical fulfillment review, real simultaneous last-spot checkout, delayed/refund/cancellation delivery races and actual staff/customer logins. PGlite serializes local transactions, so its simultaneous promise test verifies app reconciliation and database constraints but does not substitute for real Shopify/Postgres concurrency.

Official references reviewed for the implementation: [ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant), [InventoryItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryItem), [Shopify order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545). Existing local Next route-handler guidance was read for current async route conventions.

## Design follow-up

The user wants the functional stages finished first. The task's `northside-design-pass-reminder` checks quietly each day until functional work through Prompt 10 is locally complete or the user declares it finished, then reminds once and pauses. The dedicated visual pass remains pending; Prompt 7 only fixed concrete mobile wrapping and workflow defects. Prompt 8 is now implemented locally.
