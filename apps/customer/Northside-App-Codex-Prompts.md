# Northside App: Codex Build Prompts

Prepared for Steven Cook, Director of Digital Marketing and Technology

Working specification based on the latest answers in this conversation. Research checked September 12, 2026. Recheck provider plans and development documentation when implementing.

## Start on the Mac Mini

Create an empty project folder named `northside-app` in your normal development location and open it in Codex. Save this file in the folder as `Northside-App-Codex-Prompts.md`. Run Prompt 1 first, review the working preview, and then run the remaining prompts in order. Each prompt is an implementation task with a completion check.

Do not give Codex all ten prompts as one giant task. Keep each stage reviewable. When starting a new Codex conversation, tell it to read this file, `AGENTS.md`, and `docs/STATUS.md`, then run the next incomplete prompt. Those project files are created by Prompt 1.

The first preview should run without Shopify credentials. Real customer accounts, persistent operational data and checkout require the later integrations. Demo data must never be represented as Northside's actual records.

## Decisions and boundaries

| Area | Build decision |
| --- | --- |
| Starting code | Fresh project. No existing Northside or Hobby Key repository. |
| First release | Responsive, installable web app. Apple and Google store releases follow later. |
| Framework | Next.js App Router, React and TypeScript. Use current stable compatible versions and a lockfile. |
| Data | PostgreSQL hosted through Supabase, with SQL migrations, private file storage and server controlled access. Supabase Auth is for invited staff. Shopify authenticates Northside customers. |
| Hosting target | Prepare a conventional Node/Next deployment, compatible with Vercel; final domain and hosting account remain unselected. |
| Commerce | Shopify Storefront API for available merchandise and carts; Shopify hosted checkout for payment; Customer Account API for customer identity and order history. |
| Store | `9i3hnb-jw.myshopify.com`. Design exists; products are currently Draft. |
| Northside and Hobby Key | Northside is the first vendor/tenant. Separate business modules from branding, without building a complete marketplace now. Customer identity is scoped to each Shopify shop. |
| Main navigation | Home, Shop, Breaks, My Cards, Account. Rewards appears prominently on Home and Account. Staff have a separate workspace. |
| Loyalty | Custom Northside points engine, ledger, tiers, rewards and analytics. Rookie, Vet, HOF, GOAT. Economic rules remain drafts until Joey approves. No paid loyalty provider dependency. |
| Grading | Northside examination is $5 per card. External grading, shipping, insurance and other charges are separate and unconfirmed. PSA is known; the second provider was described as “BGP” and remains unconfirmed. |
| Grading operations | Group submissions can contain cards from multiple customers. Start with staff updates and reviewed spreadsheet imports. |
| Consignment | Fanatics Collect partner relationship confirmed by Steve. Availability of customer specific submission, sale and payout data through a Shopify connector is not verified. Build a functional staff maintained portal and an integration interface. |
| Breaks | In shop, believed to stream on Facebook and Instagram. Move new break purchases into Shopify. Exact channel URLs and break formats still need confirmation. |
| In store | Build the underlying locator, QR and scanner functionality, hidden from customers until enabled. Latest instruction: eight aisles. Layout must remain editable. |
| Inventory | Preserve Northside Retail Floor, Northside Breaker Storage and Northside Excess Storage as distinct pools. Do not change current Shopify inventory or fulfillment settings during the build. |
| Dates | Store opening and show dates are editable. Do not publish an unconfirmed date as a fact. |
| Marketing | Preserve campaign and QR attribution, consent, operational events and exports for the separate Marketing Hub. |

## Custom loyalty decision

Steve selected a custom loyalty program to avoid a loyalty vendor's API subscription. Northside's application will own points, tier rules, reward issuance and reporting. Shopify remains authoritative for paid orders, refunds and the discount actually applied at checkout. Database hosting, operation and maintenance still belong to the app's costs.

Start with purchase based points, four configurable tiers, a customer rewards wallet and fixed amount discount rewards. Use Shopify's supported Admin API to create eligible customer discount codes and its Storefront cart API to apply them. A paid loyalty plugin is not required for those documented API operations, although the app still needs its own authorized Shopify access. [Discount creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeBasicCreate) and [cart discount application](https://shopify.dev/docs/api/storefront/latest/mutations/cartDiscountCodesUpdate)

Points are not a cash balance or a consignment payout. Keep a history of every earning, correction, refund reversal and reward exchange. Use transactions and unique source IDs so duplicate order notifications or concurrent redemption clicks cannot create extra points or rewards.

The initial reward exchange spends points when a Shopify discount voucher is successfully issued. Code usage on a paid order is tracked separately. Uncertain issuance keeps points reserved until reconciliation. This avoids awarding a voucher and immediately making the same points spendable again. Unused reward cancellation and refund restoration need explicit rules and reconciliation rather than automatic balance edits.

Joey still approves earning rates, tier thresholds, qualifying period, exclusions, reward values, stacking, expiry and refund restoration. Defaults are inactive. Tests can use clearly labeled sample values. Scan to redeem and a custom POS tile are later enhancements; online reward redemption and earning from identifiable Shopify online/POS orders use the shared customer record.

## Product QR confirmation

Shopify's Shopcodes app creates QR codes for existing products. They can open a product page or a checkout with the chosen product/variant, and its reporting includes scan and conversion views. The app is listed as free. This is a link mechanism, not a complete Northside scanner, store map or stock reservation system. [Shopify instructions](https://help.shopify.com/en/manual/promoting-marketing/create-marketing/shopcode) and [Shopcodes listing](https://apps.shopify.com/shopcodes).

Use Shopcodes where a Shopify product destination is sufficient. For Northside app scanning and aisle guidance, generate Northside controlled URLs tied to stable product/variant IDs. Keep product identifiers, physical location and campaign identity separate. A QR must not embed a price or promise stock; those are checked when opened.

Draft products still require appropriate readiness and channel publication before customers can purchase them. An empty live catalog while everything remains Draft is expected, not permission to expose the Admin API to the public. [Shopify product status and publishing](https://help.shopify.com/en/manual/products/details/product-details-page)

## Competitor features to apply

Use these as feature references, not as sources of artwork or text:

| Reference | Useful pattern for Northside |
| --- | --- |
| [Best Card Breaks app](https://play.google.com/store/apps/details?id=com.bestcardbreaks.bestcardbreaksapp) | Follow favorite categories and provide relevant break reminders. |
| [Card Culture by LH app](https://play.google.com/store/apps/details?id=eu.dacardworld) | Connect shopping, releases, live breaks and order visibility. |
| [Layton rewards](https://laytonsportscards.com/pages/layton-sports-cards-rewards) | Make rewards useful for future purchases and break participation. |
| [PSA submission guidance](https://www.psacard.com/info/how-to-submit) | Show submission progress as understandable milestones. |

The proposed advantage is one useful Northside account: customers can shop, follow breaks and check their own grading or consignment records. These references are public descriptions, not completed usability tests.

## Prompt 1: Establish the project and build the first working preview

```text
You are building Northside Collectibles' customer web app from a fresh project on this Mac Mini. Read Northside-App-Codex-Prompts.md completely. Implement Prompt 1 only, carrying its decisions and global requirements into the project documentation. Do the implementation, not just a plan.

Inspect the current folder and available Node/package manager versions first. Do not overwrite an existing project. Use current stable compatible Next.js App Router, React, TypeScript, Tailwind and accessible UI primitives. Pin dependencies with a lockfile. Use a normal Node deployment model and keep provider integrations on the server. Avoid adding a second application framework.

Create AGENTS.md, README.md, docs/PRODUCT-SPEC.md, docs/ARCHITECTURE.md, docs/INTEGRATIONS.md and docs/STATUS.md. Record the accepted scope, all ten stages, unresolved integration inputs, validation commands and the next unfinished task. AGENTS.md should preserve project decisions and direct future work to these files. It must not invent approvals for routine local development.

Build responsive routes for Home, Shop, product details, cart, Breaks, break details, My Cards with Grading and Consignment tabs, Rewards, Account, and an isolated staff preview. Use Home, Shop, Breaks, My Cards and Account for the five mobile navigation items. Show Rewards on Home and Account. Prefer clear product browsing and readable status timelines over decorative dashboard tiles.

Use the latest clean Northside logo supplied in the project. Otherwise inspect northsidecollectibles.com's public assets for an intact approved version without the Fanatics or Topps marks or gold seal. Preserve its proportions. Do not silently use an outdated logo or invent a replacement. If the clean logo is unavailable, continue with an explicitly temporary local asset slot and record the missing file for launch. Derive brand colors from approved assets; centralize design tokens. Use real Northside photography when available and labeled sample images otherwise. No fabricated customer testimonials, prices, sales results or live indicators.

Implement typed boundaries for commerce, customer accounts, grading, consignment and breaks, plus a first party Northside loyalty service. We have chosen custom loyalty, not a paid plugin or an external rewards page fallback. Add explicit fixture adapters so the local preview works with no credentials. Fixtures are visibly labeled, isolated from live adapters and disabled in production. A demo purchase must never call a live checkout. Missing live data must show an honest empty, unavailable or connection error state rather than falling back to fixtures.

Seed representative sample states: guest and signed in home screens, an empty draft catalog explanation in staff settings, a grading timeline, a consignment timeline, configurable loyalty tier previews and a scheduled break. Dates, provider names and monetary values must be marked as examples. Use USD and America/Chicago for display.

Default public flags to disabled for purchases, loyalty earning/redemption, barcode scanning, aisle navigation and pickup. Add a web app manifest and appropriate responsive metadata. Do not cache private customer information. Later prompts complete offline behavior and installation testing.

Validate the production build and inspect the mobile and desktop preview with available browser tools. Fix broken navigation, overflow, unreadable contrast and nonfunctional controls. Record what is fixture based, what is implemented and what remains disconnected. End with the local preview URL, exact start command, changed files and any real blocker. Update docs/STATUS.md. Do not proceed to Prompt 2 yet.
```

## Prompt 2: Database, identity and customer privacy

```text
Read AGENTS.md, the product specification, architecture and status. Implement Prompt 2 without replacing the existing UI.

Use PostgreSQL through Supabase, versioned SQL migrations, private Storage and Supabase Auth for invited staff. Northside customer authentication must use Shopify's supported Customer Account API OAuth flow, not a second customer password system. Verify current official Shopify setup requirements, scopes and callback rules. Use a configured HTTPS development origin for real OAuth; do not assume plain localhost callbacks are accepted. Missing credentials should leave fixture tests available while clearly marking real authentication unverified.

Use a mature OAuth/OIDC library. Validate state, PKCE where applicable, issuer, audience, nonce when used and redirect destinations. Keep tokens encrypted on the server and use secure HttpOnly session cookies. Implement expiration, refresh, logout and CSRF/origin protections. Never put provider secrets or refresh tokens into localStorage or browser bundles.

Represent tenants, verified customer identities, customer profiles, invited staff memberships and roles, service cases, grading batches, customer owned card items, status events, consignment items, break events, Shopify spot mappings, consent, imports, integration connections, webhook receipts and audit records. Add loyalty accounts, immutable ledger entries, versioned rules, tier qualification records, rewards, redemption reservations and Shopify voucher mappings. An external identity is keyed by tenant/shop/provider/subject. The same email at two shops is not proof of a shared customer identity. Do not build cross shop SSO or merge accounts by email.

Northside is the only production tenant initially. Seed a second test tenant solely to prove isolation. Use tenant scoped foreign keys or equivalent constraints to prevent cross tenant child records. Customers see only their own card items, even when a grading batch contains multiple customers. Private staff notes and batch totals are not customer data.

All private data access goes through authenticated server services. Use a least privileged database runtime role distinct from the migration role. Enforce tenant/customer access in server authorization and database policies. Define how verified server identity becomes transaction scoped database context; clients may not choose their identity or role. A Shopify token is not automatically a Supabase session. Supabase service role credentials bypass RLS: do not claim policies protect a request running with that role. Restrict any privileged storage signing to already authorized object records. Document the concrete enforcement path.

Define owner/admin, operations, content editor and read only staff roles. Invite staff; no public admin signup or hardcoded production admin. Store uploads privately and issue short lived links after authorization. Status edits record actor, time, source and reason. Provider credentials, intake notes and payout details must not enter analytics logs.

Test two customers in one batch, another tenant, forged IDs, invalid sessions, staff permission limits, direct object URL access, CSV exports and logout. Tests must exercise actual server authorization and database isolation, not just hidden UI controls. If no database is configured, write migrations and tests, report that live checks are blocked and keep working locally without claiming they passed. Update documentation and the next step.
```

## Prompt 3: Shopify catalog, cart, accounts and paid orders

```text
Read project instructions and implement Prompt 3 for 9i3hnb-jw.myshopify.com.

Use current supported Shopify Storefront GraphQL and Customer Account APIs. Keep versions configurable and pin the tested stable API version. Do not use obsolete Checkout API examples. Add server validated configuration and an integration health page showing connection status without revealing credentials.

Build collection browsing, search, pagination, category filters, product detail, variant selection, inventory availability, cart updates and Shopify hosted checkout. Get all prices, discounts and payable totals from Shopify. Revalidate variant availability and quantities when adding to cart and before checkout. Preserve the current search and filters when returning from a product page.

All store products are currently Draft. Keep them Draft. Public merchandise comes only through the appropriate published sales channel. Do not proxy unpublished Admin API merchandise into customer views to make the catalog look populated. Keep local fixtures separate. Provide a concrete setup checklist for publishing a small selected test catalog to the correct channel when Steve is ready; do not bulk activate products or change inventory/fulfillment settings.

Support customer login, profile and order history through the verified customer context. Pass supported buyer identity into checkout using the current Shopify flow. Keep guest checkout working. Reconcile owned orders by verified Shopify customer identity, not a supplied email address or query parameter. Add first/last eligible campaign and opaque internal campaign references where supported, without attaching personal details to public URLs.

Verify current Dev Dashboard/custom app installation and authentication methods for the Admin API. Do not assume a legacy permanent token or use client credentials on shops that do not meet Shopify's ownership requirements. Scope access to documented order/webhook functions and the discount operations needed by custom loyalty. Provide .env.example placeholders and setup instructions; never log secrets.

Implement Shopify webhook verification on the raw request body, validated shop mapping, durable receipt persistence, duplicate protection and asynchronous retryable processing. Map paid orders, cancellations and refunds into a reconciled order ledger. Handle out of order events by fetching current authorized state when necessary. A checkout return page is not proof of payment. A browser cart ID alone does not establish ownership of an order.

Shopify remains authoritative for payments, quantities and fulfillment. Retail, breaker and excess pools must remain distinct. Do not add all locations together and advertise the result as retail pickup stock. Flag unverified fulfillment routing for the rollout checklist.

Test unavailable variants, zero stock, draft catalog, tampered prices, expired cart, guest and customer checkout paths, rejected signatures, duplicate paid events, refunds before delayed paid events and cross customer orders. Separate mocked provider contract tests from a real authorized test checkout. Document exact untested external steps and keep purchases disabled until those pass. Update status.
```

## Prompt 4: Grading intake, $5 examination and customer status

```text
Read project instructions and implement the grading workflow with persistent records and the existing authenticated customer portal.

Northside examines cards for $5 each. Store the rate as configurable integer cents, default 500, and snapshot the applicable rate on each intake. This is an examination service, not the grading company's fee or a promise of a grade. Keep external grading, shipping, insurance, tax and other charges separate and unquoted until configured. Three examinations should show a $15 examination subtotal before separately configured charges.

Build staff intake with customer linkage, card description, sport/category, year, manufacturer/set, card number, parallel, quantity where appropriate, images, examination findings and customer visible notes. Give each physical card a stable internal identifier even when descriptions match. Allow intake for a customer who has not activated an online account, but require a verified claim process before online access. Do not expose a case to anyone merely supplying its email address.

Implement suggested operational states as editable configuration: received, examination in progress, awaiting customer decision, ready to submit, sent to grader, grader received, grading in progress, returned to Northside, ready for pickup, completed. Include canceled, on hold and exception paths. Record state events and corrections without rewriting history. Distinguish Northside recorded milestones from provider verified milestones and show last updated time.

Customers can see findings and choose submit or return where the business workflow allows. Record their authenticated decision. A submitted request is not physical receipt. Do not promise a provider turnaround date. Provider configuration includes PSA; keep the other requested provider labeled unconfirmed internally because Steve said BGP. Do not silently rename it BGS or advertise it publicly.

Group submissions into batches that can include multiple customers. Track batch references, carrier tracking, cards included and per card results. Propagate appropriate batch events to included items without revealing other owners or their card details. Support partial returns and exceptions per item.

Add CSV import with column mapping, preview, row validation, stable external IDs, deduplication, a reviewer confirmation within the staff workflow and a reversible import batch record. Avoid updating a customer match when ambiguous. Offer a sanitized sample CSV template. Exports must avoid spreadsheet formula execution from user supplied values.

Track examination payment as a Shopify order linkage or staff recorded external payment reference, source and date. Staff entering a reference must not cause an invented Shopify payment or double counted revenue. Grading provider fees remain separate. Automatic grading provider APIs are not required for this working release.

Test intake, amount calculation, grouped batch privacy, customer decisions, partial returns, unauthorized status changes, repeated imports and restart persistence. Update status with a staff demonstration path and a customer demonstration path.
```

## Prompt 5: Consignment portal and Fanatics Collect integration boundary

```text
Read project instructions and implement a working consignment portal with staff updates and reviewed CSV imports.

Northside is a Fanatics Collect partner. The exact connector, API access and customer specific data coverage are unverified. Do not invent endpoints, claim a connection is live or assume Shopify marketplace inventory sync includes consignor identities, payout details or grading updates. Do not scrape authenticated partner pages.

Create a FanaticsCollectAdapter interface with explicit supported capabilities and a disconnected implementation. Keep manual operations independent so the portal works before provider access is available. Only implement live requests from actual partner documentation available in the project. Record document version, authentication, permissions, rate limits, supported fields and test evidence. Unknown fields remain unknown.

Model customer owned consignment items with Northside intake ID, provider item/submission/listing references, images, received date, channel, asking price if known, sold amount if verified, fees, payout status, payout reference and history. Suggested operational states: received, preparing submission, submitted to partner, processing, listed, sold, awaiting settlement, paid, returned or exception. Label staff recorded versus provider supplied events and show last updated time.

Support customer visibility for individual items and the history of their own case. Payout visibility is informational; this app must not initiate money transfers. Use integer cents and explicit currencies. Only show net payout calculations when fees and amounts are known, with estimates clearly labeled. Never convert missing fees to zero or infer paid from sold.

Implement spreadsheet mapping, validation, preview, deduplication and audit records. Unmatched records go into a staff review queue. Link external records using explicit stable IDs and approved matches; email or card title alone cannot prove ownership. Changes in integration health must not erase manually entered records or overwrite reviewed corrections silently.

If access is missing, create docs/FANATICS-DATA-REQUEST.md listing the exact questions for the partner: Shopify connector name, supported inventory/order directions, consignor mapping, submission/listing/sale/fee/payout fields, webhooks or export access, sandbox and credentials. Draft only; do not send messages.

Test customer isolation, unknown payout values, partial settlements if supported, duplicate import, matching conflicts, provider outages and stale status labels. Demonstrate that the manual workflow remains usable while the partner adapter is disconnected. Update status.
```

## Prompt 6: Build the custom Northside loyalty engine

```text
Read project instructions and implement custom Northside loyalty. Steve explicitly chose our own program to avoid a loyalty vendor API subscription. Build the engine, customer experience, staff controls and analytics. Do not install a loyalty plugin or substitute an external rewards page. Implement in three verified passes: ledger and earning; Shopify reward issuance; wallet, tiers and reporting.

Use Rookie, Vet, HOF and GOAT as configurable tier labels. Earning rates, qualifying spend, qualification windows, redemption values, exclusions, expiry, stacking and refund restoration remain draft until Joey approves. Record immutable rule versions, approver and effective date. Each earning and reward exchange records the rule version used. No live points or discounts from unapproved settings. Sample test rules are local fixtures only.

Create tenant/customer scoped loyalty accounts, append only signed ledger entries, eligibility snapshots per order line, tier qualification spend, reward definitions, redemption reservations, Shopify discount mappings and a durable outbox. Source event uniqueness must include tenant, source object and operation so duplicate webhooks or reconciliation runs cannot double award. Keep points as integers, monetary calculations as integer cents/decimal arithmetic, and currency explicit. Cached balances must reconcile to the ledger. Staff corrections are new entries with reason and actor, not silent balance edits.

Earn on verified paid eligible Shopify order lines, net of discounts, excluding tax, shipping and gift card purchases. Grading/consignment services and break spots remain excluded until approved explicitly. Retain eligible product and rule snapshots so later catalog changes do not rewrite history. Show a transparent rounding rule. Identifiable online and POS orders use the same Shopify customer record; anonymous orders wait for a verified claim and do not create guessed matches. Guest claims require authenticated ownership, never an order number or email alone. No automatic backfill of Square history or prelaunch Shopify purchases.

Handle refunds, cancellations and order edits by reconciling the current eligible amount against already posted earnings. Compute cumulative partial refund reversals from original line allocations and cap them at the original awarded points, avoiding repeated rounding losses. Monetary refunds without clear line attribution go to review. Out of order events must converge to the same result. If someone spent points before an earning reversal, preserve the negative ledger balance, make redeemable points zero and route it for review; do not create free points by clamping the ledger to zero. Tier qualification uses eligible net spend, not available points, with its own approved period and return behavior.

Implement fixed amount rewards first. In a database transaction, lock the loyalty account, verify the authenticated owner and active rule/reward, calculate spendable points net of existing holds, and create an idempotent reservation plus an outbox job. Two concurrent requests must not spend the same points. Prices, reward cost and customer IDs come from server records, not browser input.

Issue a high entropy single use Shopify discount code through the currently supported Admin API with the necessary authorized discount scopes. Use documented customer eligibility, product/collection eligibility, minimum purchase and combination rules. Require sufficient eligible spend to use the full fixed reward value so points do not silently buy a partially wasted voucher. Validate Shopify's response and userErrors. Keep amount, expiry, eligibility and combinations identical to the approved reward snapshot. Do not use obsolete API fields. Require the reward owner to be the eligible Shopify customer; verify actual checkout behavior.

Use a stable unique code per redemption job. A timeout is uncertain, not a failed creation: query Shopify for that code and reconcile before retrying. Once issuance is confirmed, atomically convert the reservation to a permanent redemption debit and save the voucher mapping. A proven creation failure releases the hold; uncertainty keeps it reserved with a visible processing state. Recover correctly if the worker crashes after Shopify creation but before local completion. Issued vouchers spend points; track actual discount use separately from issuance using verified paid order data.

Apply the issued code through the supported Storefront cart discount API and read whether it is applicable. Retain visibility of the voucher if the cart is temporarily ineligible. Do not return points automatically because a cart is abandoned, a code appears unused, or a payment webhook is late. Code expiry/cancellation requires confirmed deactivation and reconciliation of pending/paid usage before an authorized compensating credit; unresolved races stay in review. Refund restoration of points spent on a used reward is a separate policy from reversing points earned on that purchase. Implement an audited review flow with original-redemption caps and duplicate protection; enable automatic restoration only when its approved full/partial allocation rule is implemented and verified. Points cannot be cashed out or combined with consignment payouts.

Build a customer wallet showing spendable points, processing reservations, points history, tier progress, available rewards and issued vouchers. Distinguish program not launched, not enrolled, processing, real zero and error. Add staff controls for rule drafts, activation, role restricted reasoned adjustments, disputed entries, reward suspension, failed jobs and reconciliation. Do not introduce birthday, referral or social engagement awards until purchase based earning is working.

Add analytics for members, active earners, gross earned points, refund reversals, exchange debits, outstanding points, held points, vouchers issued, vouchers used, actual Shopify discount amounts, tier distribution and repeat purchases. Every metric has a period, source and definition. Show an estimated reward exposure only under an explicit valuation assumption, not as an accounting liability. Member/nonmember comparisons do not prove incremental sales. Export campaign/customer cohort summaries to the Marketing Hub contract without publishing personal records.

Prepare later POS redemption using supported customer eligible discount codes and a future staff UI. Shopify documents POS scanning of discount QR links in the form https://{shop}.myshopify.com/discount/{CODE}; use the configured shop and standard alphanumeric voucher codes. Keep this reward QR separate from product/location QR records. Verify eligibility and actual POS behavior for the chosen code before enabling it; no custom POS extension is required for web launch. Earning from paid POS orders can work independently of the future physical scanner.

Test duplicate paid events, partial refunds in different orders, cancellation before paid delivery, line edits, excluded lines, zero/negative balances, anonymous claim attempts, wrong tenant/customer, simultaneous redemptions, Shopify timeout recovery, crash recovery, double worker execution, voucher reuse, another customer using a voucher, minimum spend, stacking, unsupported checkout state and late payment during cancellation. Include ledger property tests and a reconciliation report. Run an authorized Shopify test checkout before enabling real rewards. Record precisely which tests are local versus externally verified. Update docs and leave economic rules inactive pending Joey's approval.
```

## Prompt 7: Break schedule, reminders and Shopify spot purchases

```text
Read project instructions and implement the Breaks module. Northside runs breaks in the shop, currently believed to stream on Facebook and Instagram, with purchases arranged through social messages and external payments. We want future purchases through Shopify.

Build a staff schedule editor with title, products, date/time, status, host, image, description, format, capacity, terms, stream destinations and replay links. Store UTC and display America/Chicago. Schedule states include scheduled, delayed, live, complete and canceled. A countdown reaching zero must not automatically claim the event is live. Exact Facebook/Instagram URLs are configurable and unconfirmed initially.

Create a prominent next break module, upcoming list, event details, watch button, add to calendar, saved reminder and the customer's purchased spots. Generate valid calendar files with stable event identifiers. Provide an in app reminder list immediately; email/push delivery depends on Prompt 9. Do not report a notification sent without a successful provider result.

Use external watch links initially. Embed a stream only when the actual platform supports the authorized embed. Do not assume Facebook or Instagram video/chat can be embedded or infer live status by scraping. Public participant displays require a chosen display name and permission; never expose buyer emails.

Prepare Shopify sale mappings for the actual break format. Unique team or named spots map to a distinct tracked variant/SKU with quantity one; identical spots can use one tracked variant with the real capacity. Keep continue selling when out of stock disabled for finite spots. Final format, terms and associated fulfillment remain staff verified. Do not invent a random assignment mechanism or mark a break purchase as a download when it results in physical cards.

Map paid line items using server maintained Shopify variant-to-event/spot relationships, not arbitrary cart attributes. Shopify checkout is the inventory/payment authority. Adding a spot to a cart does not reserve it. Only a verified paid order records a confirmed purchase, subject to current cancellation/refund state. Use database uniqueness for exclusive spot allocation, idempotent webhook processing and an exception queue for unexpected conflicts. A conflict must never silently grant the same exclusive spot to two customers.

Handle expired checkouts, failed payments, sold out states, event delay, cancellation, partial refunds and restocking decisions. Refunds do not automatically reopen a spot after a break has started; staff must resolve the business outcome. Existing external purchases can be recorded as clearly sourced legacy entries with payment evidence. Do not count them as Shopify revenue or list the same available spot for sale twice. Produce a reconciliation checklist before each event goes on sale.

Test competing attempts to purchase the last spot, duplicate/out of order paid webhooks, cancellation, refund, unknown variant and changed schedule. A local simulation is not proof of real Shopify overselling protection: document the required test store concurrency check and keep purchasing disabled until completed. Update status.
```

## Prompt 8: Future store map, app QR links and scanning

```text
Read project instructions and build the future in store module with public features disabled.

The latest instruction is eight aisles. Model aisles 1 through 8 as editable records, not fixed screen coordinates. Allow configurable sides and zones, categories, path nodes, entrance and service counter positions. Any visual map without a supplied floor plan must be labeled schematic in staff preview. Do not invent distances, exact shelf positions or walking directions. Earlier descriptions of four physical aisles with eight sides are historical and must not silently override the latest instruction; allow relabeling once the real plan is supplied.

Preserve three distinct inventory pools: Northside Retail Floor, Northside Breaker Storage and Northside Excess Storage. A product family, Shopify product/variant ID, SKU/barcode and physical locator are separate fields. Product identity must not change when a product moves. Customer navigation can reveal approved retail locations, not internal breaker or backstock positions.

Implement a server managed QR registry and downloadable SVG/PNG labels using a vetted QR library. Links resolve on an eventual configured Northside app domain through stable opaque IDs. The record maps tenant, product/variant, placement and optional campaign to a destination. Keep codes editable without changing the printed token. Never encode credentials, private intake data, prices or inventory counts in labels. Avoid arbitrary URL redirect destinations.

Shopify Shopcodes can link products or selected variants to Shopify pages/checkout. Preserve that option, but do not assume an opaque Shopcode can be decoded into a Northside cart item. The in app scanner must explicitly support known Northside QR formats and verified Shopify/product barcode mappings; unsupported codes receive a safe explanation. Validate scanning input and do not server fetch arbitrary scanned URLs.

Build a camera scanner in staff preview with permission handling, manual entry/search fallback, duplicate scan suppression, variant selection and current availability lookup. Adding a future scanned item must use the existing Shopify cart functions. Do not mutate quantities in Shopify just because an item was scanned. Use a compatible maintained scanner library and test real phones later; desktop camera emulation is insufficient evidence.

Build staff product-to-location assignments and a basic pickup workflow design with separate paid, preparing, ready and collected states, authorization and audit. Keep customer scanner, directions, pickup checkout and pickup collection inactive until the store is ready and checkout/fulfillment settings are verified. No location transfers or customer promises in this stage.

Test disabled flag enforcement on both routes and APIs, malformed codes, foreign domains, duplicate scans, missing variants, moved products and private pool visibility. Update the store activation checklist and status.
```

## Prompt 9: PWA installation, notification delivery and marketing measurement

```text
Read project instructions and finish the installable web app and measurement layer.

Use current Next.js/PWA and browser documentation. Implement manifest, proper icons from approved artwork, standalone display, offline fallback and update handling. Cache only explicitly approved public static resources. Never put authenticated pages, customer API responses, grading/consignment images, account tokens, cart secrets or checkout pages in a service worker cache. Logout must not leave one customer's private screen visible to the next person.

Keep browser browsing fully usable without installation. Show installation guidance based on actual support. Do not claim that every browser supplies an install event or that an install event proves every device installation. Test Safari/iPhone and Android Chrome with real devices before marking them passed. Keep native Apple/Google releases as a later tracked stage with separate distribution requirements.

Build notification preferences and a transactional delivery outbox for grading, consignment and break reminders. Support an email adapter and web push adapter using documented current protocols and permissions. Without configured delivery, use in app notifications and local test logs clearly marked unsent. Deliver through a durable scheduled worker/job path with retry, deduplication, cancellation and failed status; do not use process timers as production scheduling. Changed break times must replace pending reminders. Ask for push permission after a useful user action. Keep marketing consent separate from service notifications. Keep lock screen text generic so private financial/card details require login.

Create Northside collector show landing routes and a separately labeled Hobby Key vendor interest route if enabled. Hobby Key interest capture is not a functioning marketplace. Record event and placement identifiers, consented follow up and approved campaign fields. Missing dates are not invented. Reuse these routes across shows and keep printed QR destinations changeable.

Use lowercase utm_source, utm_medium, utm_campaign and unique utm_content. Sources include geneva_card_show; qr is the medium for its physical codes. Preserve first and latest eligible observed touches with timestamp and consent state. Never use UTMs for identity or payment verification. External app store links, if added later, do not guarantee attribution survives installation.

Record distinct events for landing, supported install prompt acceptance, signup completion, meaningful activation, product view, checkout initiation, verified purchase, saved break reminder, grading status view and vendor interest submission. Define meaningful activation as an authenticated useful action rather than a QR landing alone. Server verify purchases and deduplicate by order ID. Keep service case IDs, private card descriptions and provider payout data out of marketing payloads.

Build a staff metrics page and CSV export with date range, tenant, campaign, source, event definitions, last sync, unmatched attribution and refund adjustments. Separate online sales, external legacy payments and consignment payouts; the latter is not retail revenue. Do not claim Shopify pixels automatically cover the custom app, or sum ad platform attributed sales as unique orders. Create an export contract for the existing Marketing Hub, without modifying or assuming a live connection to that hub.

Test denied permissions, unavailable push, changed reminder time, repeated delivery job, opt out, lost network, cache/logout privacy, duplicate purchase and an unattributed order. Document observed browser limitations and update status.
```

## Prompt 10: Verify the real release and prepare the handoff

```text
Read the complete project documentation and implement the final release readiness stage. Resolve concrete defects found in the existing features; do not rewrite working architecture or add speculative features.

Create a requirements matrix for all ten prompts with statuses: implemented and locally tested, externally verified, waiting for configuration, or deferred. Link each completed item to specific evidence. Keep preview screenshots distinct from integration verification.

Run type checking, lint, production build and the meaningful tests already established. Add only missing coverage for concrete risks: tenant/customer isolation, pooled grading batches, private files, duplicate webhook processing, last spot purchase conflicts, refunds, loyalty ledger reconciliation, concurrent reward exchange and voucher recovery, disabled store features and PWA cache privacy. Inspect 390px mobile and desktop layouts, keyboard access, form labels, long card names, loading/empty/error states and slow connections. Fix broken behavior before cosmetic extras.

Verify that production cannot silently use fixtures, demo identity, seed customers, fake balances, draft products or placeholder stream links. Every integration has an honest status and actionable setup instructions. Confirm server secrets stay out of client bundles and logs. Check webhook signature handling, durable jobs, retry behavior, reconciliation and database backup/restore instructions. No public staff signup or unrestricted case lookup.

Prepare a conventional Node/Vercel deployment configuration, environment variable inventory, migrations, rollback instructions and a safe staging smoke test. Do not publish to an unselected domain, activate paid plans, change production Shopify products or enable live payments as part of preparing the release. Make the deployment result concrete and reviewable so Steve can choose the target and launch it.

Create docs/STAFF-QUICKSTART.md for grading intake, grouping submissions, consignment imports, matching customers, break setup, purchased spot reconciliation, status updates and exceptions. Create docs/LAUNCH-CHECKLIST.md covering approved logo, published test catalog, actual checkout, customer login, real stream URLs, grading provider confirmation, Fanatics data coverage, loyalty approval and field testing on phones. Record who must supply each missing input.

Document the later native phase: reuse domain services, schema and provider contracts; decide between a native shell and React Native after testing camera, push, authentication and store distribution needs. Do not promise every web UI component can be reused unchanged. Document that Hobby Key needs deliberate account linking and separate Shopify installs for additional shops; the first store's OAuth grants cannot simply cover all vendors.

Finish with a concise release report: what works now, what has real external verification, what remains disconnected or intentionally disabled, exact setup commands and the next highest priority action. Update docs/STATUS.md and preserve all existing data.
```

## Inputs that can arrive while development proceeds

These do not block the first local preview:

1. Latest clean logo and approved brand guide.
2. Supabase project and local environment configuration; choose staff owner identity privately.
3. Shopify Headless/Customer Account setup, permitted API access and configured HTTPS callback origin. Do not paste secrets into prompts or commit them.
4. A small selected active catalog for a real checkout test, when Steve is ready. The bulk draft catalog stays unchanged.
5. Sanitized grading and consignment spreadsheet samples.
6. Confirmation of the second grading company: Steve said “BGP”; Beckett/BGS is a possibility, not an established fact.
7. Actual Facebook and Instagram stream/profile URLs, next break details, selling format, capacity and terms.
8. Fanatics partner connector name, documentation and field coverage. Shopify merchandise sync alone does not establish a customer consignment feed.
9. Joey's approval of custom loyalty earning rates, tier rules, exclusions, reward values and refund restoration. The custom engine decision is already made.
10. Actual store plan and aisle/side labeling, product locators, pickup process and confirmed opening date.

## Official development references

Use current official documentation during implementation, and record the tested versions in the project. These are starting points, not guarantees that Northside's account has the required access.

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js PWA guidance](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Shopify Customer Account API setup](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started)
- [Shopify Storefront cart](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Shopify app authentication for owned stores](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
- [Shopify webhook verification and duplicates](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Shopify discount code creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeBasicCreate)
- [Shopify discount code input and eligibility](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/DiscountCodeBasicInput)
- [Shopify discount lookup by code](https://shopify.dev/docs/api/admin-graphql/latest/queries/codeDiscountNodeByCode)
- [Shopify discount deactivation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeDeactivate)
- [Shopify Storefront cart discount application](https://shopify.dev/docs/api/storefront/latest/mutations/cartDiscountCodesUpdate)
- [Shopify discount QR scanning in POS](https://changelog.shopify.com/posts/scan-discount-codes-in-shopify-pos)

No verified Fanatics partner API contract or grading provider status API was available for this pack. The prompts intentionally support useful manual workflows without claiming those feeds are connected.
