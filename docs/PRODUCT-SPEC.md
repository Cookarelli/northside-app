# Accepted product specification

The preserved Northside-App-Codex-Prompts.md is the full source of requirements for all ten stages. This document carries the accepted global scope into the project; it does not replace that source.

## Product and brand

First release: responsive installable customer web app; native Apple/Google distribution later. Northside is first tenant, not a complete marketplace. Separate domain services from brand configuration. Five customer navigation items: Home, Shop, Breaks, My Cards, Account. Rewards is prominent on Home and Account. Staff workspace is isolated. Prefer merchandise browsing and readable per-card timelines.

User supplied Northside-Collectibles-Blue (1).svg during Prompt 1. Preserve it intact at public/northside-logo.svg with original 2070:572 proportions. Source colors are #3695c3 blue, #050708 near-black and #ffffff white. Dark blue and pale blue interface variants are derived for readable contrast. CSS illustrations are labeled sample artwork, never actual merchandise. No fabricated testimonials, sales, prices or live states; examples are labeled. Opening and show dates remain editable and unconfirmed.

## Commerce, identity and data

Next.js App Router, React, TypeScript, Tailwind and accessible primitives; lockfile required. Conventional Node hosting prepared, Vercel compatible; Vercel project northsidecollectibles/northside-app was supplied; exact deployment domain is not yet verified. PostgreSQL via Supabase, versioned SQL, private storage and invited staff Supabase Auth in Prompt 2. Customers authenticate through Shopify Customer Account API, not a second password database. Identity is scoped to tenant/shop/provider/subject; never merge shops by email.

Shop 9i3hnb-jw.myshopify.com. Shopify Storefront catalog/cart and hosted payment checkout. Shopify remains authoritative for payable amounts, paid orders, refunds, inventory and fulfillment. Products stay Draft until separately authorized selected channel publication. Never expose Admin merchandise publicly or change stock to fill a preview. Preserve Northside Retail Floor, Northside Breaker Storage and Northside Excess Storage as separate pools.

## Cards and breaks

Northside examination: $5 per card, separate from unconfirmed external grading/shipping/insurance/other charges. PSA known; second provider “BGP” unconfirmed, not silently BGS. Staff maintained per-card timelines and reviewed imports precede optional provider APIs. Group grading submissions may hold multiple customers' cards; customers see only their own records, not private staff notes or batch totals.

Fanatics Collect partnership is confirmed by Steve, but connector identity and customer sale/payout coverage are unverified. Manual operational portal and capability-aware disconnected adapter are implemented locally. Unknown fees are not zero, sold is not paid, and app never initiates consignment payouts.

Breaks are in shop, believed to stream via Facebook/Instagram. URLs, format, terms, capacity and actual dates unconfirmed. New purchases move to Shopify only after verification. Scheduled time never proves live status. Shopify paid line mappings determine purchased spots; cart addition does not reserve stock.

## Custom loyalty

No paid loyalty provider dependency or external rewards-page substitute. First-party ledger, tiers, reward issuance and reporting; Rookie, Vet, HOF, GOAT. Joey approves earning rate, thresholds, qualification period, exclusions, reward value, stacking, expiry and refund restoration. Defaults inactive; examples local only. Points are neither cash nor payouts.

Later implementation requires immutable rule versions, append-only ledger, source uniqueness, transactional locking, reserved points, durable outbox, verified paid order earning and cumulative refund reconciliation. Successful Shopify voucher issuance spends points; usage tracked separately. Timeouts keep holds until reconciliation. Cancellation/restoration requires approved policy and confirmed state. Fixed customer-eligible discounts through authorized Admin API, applied via Storefront cart API. Online/POS identifiable paid orders share shop-scoped identity; future physical redemption remains disabled.

## In-store, marketing and privacy

Eight editable aisles, sides/zones and schematic labels until actual plan arrives. Public scanner, directions and pickup disabled. Stable product/variant identity separate from physical location and campaign. Northside controlled QR URLs carry opaque IDs, never price/stock/secrets; Shopcodes remains an optional Shopify link mechanism, not a map/reservation system. Do not reveal breaker/backstock positions to customers.

UTC storage; USD integer cents; America/Chicago display. No caching private pages, images, tokens or cart secrets. Preserve consent and campaign/QR attribution for a separate Marketing Hub export contract; no assumed live Hub connection. Purchases must be server verified and deduplicated; consignment payouts are not retail revenue.

## Stages

1. Project, typed service boundaries, fixture preview, manifest, docs and local validation — complete locally.
2. Supabase persistence, Shopify customer identity, staff invitations and actual authorization/isolation tests — locally implemented; hosted verification pending.
3. Published Shopify catalog, cart, identity/order integration, verified durable webhook implementation — locally implemented and tested; real provider/checkout/worker deployment verification pending.
4. Persistent grading intake, $5 examination, pooled submissions and reviewed imports.
5. Persistent manual consignment, reviewed imports and Fanatics capability boundary.
6. Custom loyalty ledger/earning, Shopify issuance, wallet/tiers/analytics with approved economics inactive until approval.
7. Break editor, reminders and verified Shopify spot purchases/reconciliation.
8. Future eight-aisle locator, QR, scanner and pickup design; public gates remain off.
9. PWA offline/install/update testing, notification outbox/delivery, consent/marketing exports.
10. Requirements evidence, security/release checks, deployment handoff and staff/launch documentation; native phase tracked later.

All completion criteria and detailed failure-case tests remain in the source prompt. Proceed in order only when requested.

## Prompt 4 accepted behavior

Grading operations are now implemented locally: default 500-cent examination snapshots, a distinct ID for every physical card, customer-visible findings/notes, private staff reasons, editable operational statuses and append-only events, submit/return requests only at the decision step, shared batches with selected-card events and partial returns, reviewed mapped CSV intake with permanent external IDs and guarded reversal, and separate Shopify-order/external-payment references. A receipt contact can exist before account activation, with a secret receipt code plus independent staff approval required to link a verified account to that grading case. Three cards show $15 examination subtotal; external charges are separate and unquoted. No provider feed, paid loyalty plugin or public in-store feature is activated. Prompts 5–8 are now implemented locally; see the stage sections below.

## Prompt 5 accepted behavior

Customer-owned consignment items now retain intake/card/item identity, provider/submission/listing references, received date/channel, asking and staff-verified sale amounts, unknown/known fees, estimated net, informational settlement references and immutable history. Partial settlements and compensating record corrections are supported without moving money. A sale never implies a payout; missing fees never become zero. Staff CSV review requires stable external IDs, explicit approved ownership, current-versus-incoming comparison, timestamp/version checks and audit. Unmatched/conflicting rows stay private in review. Partner health cannot erase manual records. Fanatics capabilities remain unavailable and the unsent partner request documents every unknown contract input.

## Prompt 6 accepted behavior

Northside owns the purchase-based loyalty ledger, immutable rule versions, original line eligibility allocations, cumulative refund reversals, rolling spend-based tier qualification, fixed reward definitions, transactionally reserved points, durable issuance jobs and Shopify voucher mappings. The wallet distinguishes not launched, not enrolled, processing, zero, negative debt and errors. Staff can save inactive drafts, approve only under the verified approver policy, suspend rewards, append reasoned adjustments, handle disputes/jobs and inspect defined metrics and reconciliation.

Supported draft economics are whole points per USD dollar, per-line floor/cumulative reversals, a rolling qualification window, no point expiry and manual reward restoration; fixed vouchers require eligible spend covering their full value, one customer/use and no product/order stacking. Other policies cannot activate without implementation. All live rules/rewards remain inactive in this delivery. The local sample approval is fictional. See SETUP-PROMPT-6.md for exact bounds and external checks. No referral, birthday or social awards, physical scanner, live Marketing Hub feed or payout conversion is enabled.

## Prompt 7 accepted behavior

Saved staff schedules include product notes, Chicago/UTC time, status, host, artwork, description, named/identical format, finite capacity, terms and configurable watch/replay links. Public next-event/list/detail views expose no buyers. Stable-version calendar downloads, own in-app reminders and purchased spots persist. Participants appear only under an explicitly consented alias; customers can withdraw consent. There is no email/push delivery or clock-based live inference.

Verified Shopify paid line variants map to immutable event/spot identities. Duplicate/current-state reconciliation, exact customer ownership, unique finite allocations, durable leased jobs and a review queue protect against conflicting grants. Cart addition has no reservation effect. General and dedicated cart paths share the break policy guard. Refund/cancel capacity stays held until reviewed; started events cannot reopen slots. Independently evidenced external purchases stay separate from Shopify/loyalty revenue. Before-sale reconciliation checks stock, format, physical fulfillment, legacy commitments and actual test-store concurrency. All purchase gates stay off. See SETUP-PROMPT-7.md for supported bounds and external verification.

The dedicated design pass follows completion of functional stages. Prompt 8 is implemented locally; public scanning, eight-aisle navigation and pickup remain disabled. Prompt 9 is now implemented locally; see its acceptance section below.

## Prompt 8 accepted behavior

Staff can edit eight schematic aisle records, sides, zones, categories, path nodes, connections, entrance and service counter positions. Product family, Shopify product/variant, verified SKU/barcode and physical assignments remain separate; moving a product changes the approved locator without changing its identity or printed token. All three inventory pools stay distinct, with only active approved retail locators in the customer projection.

An audited server QR registry holds stable opaque tokens and constrained product/retail-locator destinations, with optional variant, private placement and campaign. Downloaded SVG/PNG labels contain only an app URL plus a fixed caption; SAMPLE images are visibly marked. Staff camera/manual/search/image scanning supports the known Northside format and verified product mappings, safe unsupported-code feedback, duplicate suppression, variant selection and current published Storefront availability. Scans never mutate stock. The future add path uses the existing Shopify cart service and remains gated.

Pickup has an authorized, audited SAMPLE rehearsal through paid, preparing, ready and collected. Live payment, pickup checkout, collection, walking directions and customer scanner routes remain disabled. See SETUP-PROMPT-8.md for bounds and STORE-ACTIVATION-CHECKLIST.md for physical plan, real phone, barcode, hosting and fulfillment evidence still required. No paid loyalty plugin or future notification delivery was added.

## Prompt 9 functional addition

Collectors can manage service update channels, read generic in-app notices and view capability-based installation guidance. Show routes and stable placement QR codes support Northside collector visits and a separately gated HobbyKey interest form. Optional analytics records approved first/latest touches and verified useful actions; staff metrics keep Shopify orders/refunds, legacy payment evidence and consignment payouts separate. Marketing follow-up consent is independent of service notifications. Private records require a connection. Real installations, delivery and hosted integration verification remain pending.

## Prompt 10 release readiness

Local functional stages 1–10 are complete. REQUIREMENTS-MATRIX.md separates local tests, prior public discovery, configuration gaps and deferred work. DEPLOYMENT.md, ENVIRONMENT.md and BACKUP-RESTORE.md provide the reviewable hosting/recovery handoff; STAFF-QUICKSTART.md and LAUNCH-CHECKLIST.md cover operations and owners. Real launch is still blocked on hosted authentication/Storage and authorized Shopify/device evidence. The dedicated design pass is now due. Native and additional Hobby Key shops remain later phases with deliberate account linking and separate Shopify installs.

## Authorized grading extension — September 16

[Card photography and a digital Northside Exam](NORTHSIDE-EXAM.md) add staff camera/file capture, confirmed private front/back and optional closeup/paper evidence, retry without duplicate received cards, durable drafts and explicit publication. Exact fields are four initially blank integer 1–10 scores (Centering, Surface, Edges, Corners), public Notes, a manually entered Projected grade or Unable to estimate, and authenticated examiner signoff/time. Internal notes are separate. No generated grade or score average is provided. The external grader’s final result remains independent.

Publication requires complete confirmed front/back evidence, all scores, an estimate choice and signoff. Revisions and their photo snapshots are immutable; corrections retain actor, reason and prior reports. Customers see only published assessments and printable exam reports without internal notes or paper exam images. The subsequent customer extension below also exposes confirmed received card photos before publication. This is locally implemented; hosted Storage/Auth, physical device acceptance and the dedicated design pass remain outstanding.

## Customer grading extension — September 16

[My Cards → Grading](CUSTOMER-GRADING.md) uses the same responsive portal and verified Shopify identity for received cards/photos, intake receipts, published exams, itemized quotes, dated progress and separately recorded final results. Collectors explicitly approve selected cards or request return; decisions preserve exact card/exam/quote/provider/service revisions and authenticated actor/time. New published exams or quotes require renewed approval before dispatch. Unset external grading/shipping/insurance/other charges remain unknown and prevent submission approval; a configured zero is explicit. Dispatch requires current approval and matching batch service, enforced on server writes. Internal notes, paper exams, other owners and shared manifests never enter the customer projection.

The app includes `/grading` and **Grading / Track My Cards** navigation. The actual public website is Square Online; the user deferred its live external link until later. No public portal origin or alternate login is invented. PSA is the confirmed provider; BGP remains unconfirmed. Hosted acceptance remains pending; see [website handoff](WEBSITE-GRADING-ENTRY.md) and [current evidence](STATUS.md).
