# Northside app — executive demo brief

**September 16, 2026 · 7-minute walkthrough + questions**

**The message:** Northside can give collectors one place to shop, follow their cards, participate in breaks and return for rewards—with a staff workspace behind that experience.

**Today’s scope:** A working local demonstration with clearly labeled fictional data. The functional modules are implemented and locally tested. Live connections, business approvals, device testing and the dedicated design pass remain before customer launch.

## Open with this — 30 seconds

“Yesterday we covered the Marketing Hub. Today I want to show the customer experience we’re building around Northside: one place for a collector to shop, see what’s happening with their cards, follow breaks and understand their rewards.

“The business goal is a more useful relationship between visits and less time chasing status across messages and spreadsheets. What you’ll see today is a working local preview with sample records. It lets us review the workflows before connecting real customers, payments and inventory.”

## Click-through talk track

### 1. Home — 40 seconds

**Open:** [Northside Home](http://127.0.0.1:3000/)

**Show:** Shop, Breaks, My Cards and Account navigation; scroll to the rewards section if helpful.

**Say:** “This is the collector’s front door. Shopping, service updates, upcoming breaks and rewards are brought together under Northside. The aim is to give customers useful reasons to come back, even when they aren’t buying that day.”

**Transition:** “The clearest example is what happens after someone leaves cards with us.”

### 2. Grading — 90 seconds

**Open:** [Saved grading cards](http://127.0.0.1:3000/my-cards/grading). Keep **Sample collector A** selected. Click **SAMPLE — basketball examination**, the entry marked **Return requested**, card ending **5aef4de3**. It appears below the earlier test intakes; skip the very long “release check” record.

**Show:** Examination findings, notes, per-card history and the three-card examination subtotal.

**Say:** “Each physical card has its own record. A collector can see what Northside has recorded, the examination findings and the next step. Here, three cards have a $15 examination subtotal at $5 per card. External grading and shipping charges are separate.

“This sample history also shows a customer return request. That is a request—not a claim that the card has already been physically returned. This kind of clarity is designed to reduce ‘where is my card?’ messages and prevent misunderstandings.”

**If asked about automatic grader updates:** “These milestones are staff recorded today; we are not claiming a connected grading-company feed.”

### 3. Consignment — 60 seconds

**Open:** [Saved consignment cards](http://127.0.0.1:3000/my-cards/consignment). Keep **Sample collector A**. Click **SAMPLE — baseball consignment, partial settlement**.

**Show:** The fictional $100 sale, $20 fees, $80 estimated net and $30 recorded settlement.

**Say:** “Consignment makes an important distinction between sold and settled. Customers can understand the sale, known fees and settlement progress without staff having to reconstruct the story each time. Unknown amounts stay unknown. This screen records settlement information; it does not move money.”

**If asked about Fanatics:** “The manual workflow works locally. Fanatics data access and exactly which fields the partner can supply still need verification.”

### 4. Northside Rewards — 60 seconds

**Open:** [Rewards wallet](http://127.0.0.1:3000/rewards). Keep **Sample collector A**.

**Show:** **750 sample points**, **Vet** tier, progress toward HOF, points history and the existing sample voucher. Do not exchange additional points during the presentation.

**Say:** “We chose custom Northside loyalty, with no paid loyalty plugin. Northside controls the rules, tiers and customer experience. Customers can see their available points, progress and reward history in one place.

“The numbers shown are examples. Joey still needs to approve the real economics before earning or redemption is enabled. We want a program the business understands and can reconcile.”

### 5. Breaks — 50 seconds

**Open:** [Break schedule](http://127.0.0.1:3000/breaks), then **View break**.

**Show:** The sample event, Chicago time, calendar link and saved in-app reminder. Stay near the schedule/reminder sections; the purchase history below contains refund test cases.

**Say:** “Breaks become a clear schedule customers can follow, with event details and saved reminders. A schedule change is reflected in the app, and a countdown does not pretend the stream is live.

“The future purchase flow will rely on Shopify’s verified payment and inventory information. Actual streams, spot sales, email and push delivery are not switched on in this preview.”

### 6. Staff workflow — 60 seconds

**Open:** [Grading desk](http://127.0.0.1:3000/staff/grading), then **New intake**. Show the form without submitting it.

**Show:** Customer selection, individual card description, quantity, examination subtotal and private staff notes. Point out **Batches**, **Imports** and **Claims**.

**Say:** “Behind the customer view is the staff workspace: intake, card records, group submissions, imports and customer matching. The goal is to capture the work once, keep a clear history and give the customer the appropriate part of that information. We have parallel desks for consignment, rewards and breaks.”

### 7. Close — 30 seconds

Return to [Home](http://127.0.0.1:3000/). Keep [Integration health](http://127.0.0.1:3000/staff/integrations) available only if someone asks for launch details.

**Say:** “The functional foundation is built and tested locally. The next steps are a dedicated design pass, connecting and verifying the live services, approving the business rules and then running a controlled pilot.

“Today I’d like agreement on the first customer journeys we pilot, the owners of the remaining inputs and the design priorities. Success should be measured by customer use, fewer status-chasing messages and reliable staff workflows—not just by having another app.”

## Optional shopping demonstration — 45 seconds

If the audience wants to see shopping, open [Shop](http://127.0.0.1:3000/shop), search **basketball**, open **Basketball collector box**, choose the standard sample variant and **Add to demo cart**. Open the cart. Quantity **2** shows the fictional **$170** subtotal; checkout stays disabled. Remove the sample item afterward.

Say: “The browsing and cart experience is available for review. Shopify will remain the authority for real merchandise, payment and inventory. Today’s products and prices are examples; the existing Shopify products have not been changed.”

## Short answers for executives

| Question | Answer |
| --- | --- |
| Is this live for customers? | No. This is a working local preview. Hosted access, real sign-in, payment and provider verification remain before launch. |
| Why does this matter commercially? | It is designed to make service easier to follow and give collectors reasons to return. Revenue lift and time savings are goals to measure in a pilot, not proven results. |
| How does it relate to yesterday’s Marketing Hub? | This is the collector and staff experience. Consent-aware measurement and export contracts are prepared for the Hub; a live connection is not yet established. |
| Are we paying for a loyalty plugin? | No paid loyalty plugin is used. Hosting and any chosen external services are separate operating costs; no total cost claim is being made today. |
| Can customers pay or redeem rewards today? | No. Live checkout, earning and redemption are deliberately disabled pending approvals and real tests. |
| Does it pay consignors? | No. It records verified settlement information; it does not initiate transfers. |
| Is it an App Store app? | The first release is a responsive installable web app. Physical iPhone/Android verification is pending; native store releases are a later phase. |
| What about scanning, aisles and pickup? | Preparation exists in the staff preview. Public in-store features remain disabled until the actual store and fulfillment process are verified. |
| What decisions do we need next? | Confirm pilot scope and design priorities; Joey approves loyalty economics; Steve coordinates live service access; operations supplies provider, stream, break and fulfillment details. |

## If time is cut to three minutes

**Home → Grading → Rewards → Close.**

“One home for the collector. Clear status for cards entrusted to Northside. A custom rewards program to support the ongoing relationship. The staff workflow sits behind those screens. We have a tested local foundation; design, live connections and a controlled pilot are next.”

## Presenter preparation

- Present from this Mac, where the local preview runs. The `127.0.0.1` link will not open this Mac’s app from someone else’s phone or computer.
- Use the saved grading and consignment links above. The general **My Cards** page also contains an earlier illustrative overview.
- Use **Sample collector A** on the saved workspaces. Real account credentials are unnecessary for this presentation.
- Keep the clearly marked sample banners visible. Treat all dates, products, balances and prices as fictional.
- Show existing records and forms. Skip new intakes, reward exchanges, rule activation, notifications, camera permissions and uploads during this short demo.
- The brief follows the current functional layout. The dedicated visual design pass is still due.

If the preview stops, use this exact command in Terminal and reopen [Home](http://127.0.0.1:3000/):

```sh
cd /Users/northside/Documents/Codex/2026-09-12/read-northside-app-codex-prompts-md/outputs/northside-app && ./scripts/preview.sh
```

If Terminal says port 3000 is already in use, first open the preview link—the server may already be running. Do not reset its saved sample database.

## Smoke-test result — September 16, 2026

**PASS for the rehearsed local presentation path. No presentation-blocking defect found.**

- Fresh type checking, lint, production build and all **150 automated tests** passed; **23 client artifacts** passed the server-secret configuration scan.
- All nine existing local production HTTP suites passed. The separate read-only release check passed **29 checks** against the temporary local production server.
- **31 read-only preview HTTP checks** passed, including 19 page routes, saved data, calendar output, denied cross-customer card/consignment reads and disabled public store routes.
- Browser rehearsal covered account, home, card overview, saved grading/customer switching and detail, consignment detail, rewards, breaks/detail, staff intake form, integration health, product search, unavailable variant and cart add/quantity/remove. Two $85 sample units correctly showed $170; the cart was returned to empty.
- No warning/error entries were captured in the inspected in-app browser session. Home was visually inspected at the browser’s measured 300px width with no horizontal overflow or error overlay. The browser did not honor the requested 390px width; Chrome automation was blocked by an open extension UI. Today’s check therefore does not establish fresh 390px/desktop or real-phone coverage. Prior September 12 release testing recorded 390px/1280px results separately.
- No application code or saved operational records were changed for this rehearsal. No Shopify products, live payments, loyalty rules, delivery services or future in-store features were activated. These local results do not establish live integration readiness.
