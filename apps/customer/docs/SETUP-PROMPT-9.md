# Prompt 9 — installation, notifications and measurement

Stage-specific implementation record. For the current combined handoff, see [RELEASE-REPORT.md](RELEASE-REPORT.md).

Local functionality is implemented. The existing login/password reset can wait for local review. No messages were sent, provider accounts configured, migrations hosted, Shopify products changed, store features enabled, or site deployed. Prompt 10 release preparation is now complete locally; the dedicated design pass is next.

## Start and review

Run from this project with `./scripts/preview.sh`; it locates the bundled runtime and starts the explicit local fixture mode at http://127.0.0.1:3000. Use 127.0.0.1 consistently; fixture APIs reject other hosts.

- `/account/notifications`: sample A/B isolation, individual grading/consignment/break preferences, generic in-app inbox, read status and optional push registration.
- `/staff/engagement`: metrics with date/source/campaign filters and CSV, show editing, stable QR placement destinations, due jobs and UNSENT attempt logs. The sample worker never contacts a provider.
- `/go/SAMPLE_geneva_table_entrance_01`: stable QR redirect to a labeled collector show. All four lowercase UTMs come from the approved placement. Dates and locations are deliberately unset.
- `/hobby-key/vendor-interest?show=sample-hobby-key&ref=SAMPLE_hobby_key_vendor_desk_01`: separately labeled sample interest form; use an email ending `.invalid`. It stores consent, not a booking, sale or sent message.
- `/install`: capability-based guidance. `/pwa/offline.html`: generic public connection fallback.

Local records live in ignored `work/grading-preview/`; repeated starts preserve them. New migration `202609120009_engagement.sql` adds engagement tables and triggers without rewriting migrations 001–008. On a new local DB, initialization applies the required consignment and break schemas before engagement. No sample rows are in the hosted migration.

## PWA and privacy contract

The approved, intact Northside SVG is centered with padding in 180, 192 and 512 pixel PNGs. Regenerate with `pnpm pwa:assets`. Manifest supports standalone display and includes a padded maskable icon. The current logo is retained; no alternative artwork was invented.

`public/sw.js` caches exactly six public files: the offline HTML/CSS, approved SVG and three PNGs. It never caches application navigation, API/RSC responses, private images, account/session data, cart secrets or checkout. Failed document navigation displays only the generic public fallback; APIs retain their normal failure. Updates wait for the user to save changes and choose **Update and reload**. Bump the public cache version when replacing cached assets and inspect the allowlist when changing it.

Before a page enters browser history cache, its body is hidden. History restoration reloads it. A boolean local privacy lock (no identity or token) and BroadcastChannel/storage/service-worker messages close other account tabs. Sign-out revokes the server session, clears app cookies and requests cache/storage clearing; if a connection fails, the public signed-out screen asks the user to finish signing out. Private data is never available offline. Local app sign-out does not prove the Shopify SSO session on every device was ended. Supported browsers that ignore Clear-Site-Data still use the explicit screen lock and server revocation.

In-app-browser installation is not a real iPhone/Android result. The interface uses an install button only after an actual `beforeinstallprompt` event; it retains that event across app navigation. Acceptance is a separate metric, not independent installation proof. Without a prompt, browsing and menu guidance remain usable. iPhone Safari home-screen installation, Android Chrome installation, real push permissions, device delivery, history/logout behavior on shared physical devices and native Apple/Google distribution remain pending. No app-store attribution continuity is assumed.

## Notification operation

Grading and consignment public events create generic in-app notifications and channel jobs in the same database transaction. Break reminder inserts/changes cancel prior pending jobs and schedule replacements; cancellation, unpublication, missing dates and preference opt-out prevent dispatch. Repeated identical reminder saves are no-ops. Customers only read their own generic inbox and update their own preferences. Contacts and subscription keys stay encrypted, server-only; API responses never expose them.

Email recipients come from the currently verified Shopify Customer Account profile, not a browser-supplied address. Push subscription endpoints are limited to supported HTTPS Apple, Google and Mozilla push hosts and valid key shapes. Notification permission is requested only from the account's **Enable push on this browser** action when configured. Denied/unavailable permission keeps in-app updates available. Service notification preferences and optional analytics/HobbyKey follow-up consent are separate.

Provision a login for the `northside_engagement` SQL role, restricted to the Northside tenant. It has no session, grading-card, consignment-finance or loyalty-ledger access. Do not use a migration role or Supabase service-role connection as `ENGAGEMENT_DATABASE_URL`. This role stores engagement state and encrypted notification contacts; protect its credentials and encryption key independently.

Private environment requirements are listed in `.env.example`. Keep `NOTIFICATION_DELIVERY_ENABLED=false` until real delivery is explicitly authorized and verified. `RESEND_API_KEY`, a verified `NOTIFICATION_EMAIL_FROM`, HTTPS `APP_ORIGIN`, a separate 32-byte base64 `NOTIFICATION_ENCRYPTION_KEY`, and long-lived VAPID keys/contact are needed. No keys were generated or printed by this stage. Missing/disabled delivery records **UNSENT**, never “sent.” Successful adapters record **accepted**, meaning provider acceptance only.

A hosting scheduler must invoke `pnpm notifications:work` and `pnpm measurement:work` at a suitable interval (for example once per minute) using private environment configuration. These are bounded, durable database workers; no process timers schedule production work. No hosting schedule is installed yet. Each job is claimed with a lease; expired leases recover, transient failures use persisted exponential backoff, and eight attempts reach failed/manual review. Staff can retry a failed/unsent notice only inside its remaining retry window. Canceled jobs are never reopened by retry. Past due in-app reminders remain visible until read/canceled; the delivery worker checks the latest source and consent before dispatch. It cannot recall an already accepted message or eliminate a provider-side race with simultaneous cancellation.

Resend requests reuse the notice ID as an idempotency key; automatic sends stop at 23 hours from first attempt, within the documented 24-hour provider window. Web push uses a stable topic and generic notification tag; transport retries can still duplicate acceptance. A 404/410 deactivates that push subscription. There is no exactly-once device delivery claim. Network failures are recorded without exposing recipient addresses, tokens, endpoint URLs or provider response bodies. A dead worker eventually releases its lease, including the final attempt, which then fails visibly. Worker maintenance removes expired 30-day visitor/touch links and interest contacts older than 90 days. Aggregated events and job audit records are retained; establish a production retention/deletion policy before launch.

## Show campaigns and attribution

Staff records have tenant/event IDs, Northside or HobbyKey branding, optional confirmed date/time/location, publication state and stable placement refs. Keep the public origin fixed before printing real codes. Each label encodes only `/go/{ref}`. Destination and enabled state are editable; the original placement key and UTMs remain immutable. New physical placements get unique lowercase `utm_content`, with `geneva_card_show` / `qr` available. QR labels reuse the pinned local ZXing encoder, preserve its quiet zone and visibly mark fixtures. A disabled/unpublished destination fails closed. `HOBBY_KEY_INTEREST_ENABLED=false` keeps the live interest flow off.

Analytics is off until explicit browser consent. An HttpOnly, SameSite visitor token is hashed in the database. Only eligible approved placements update first/latest ref and timestamp; arbitrary UTMs do not authorize an account, claim a record or prove a payment. Consent withdrawal deletes the browser association and stops new analytics. Existing aggregate history remains. Verified login can link a consented visitor to that customer; authenticated activity also requires that same browser’s current consent token, so consent from a different signed-in browser cannot be inherited; switching customers invalidates that association. Signup completion comes from a new verified identity, with no historical-member backfill. Meaningful activation is the first authenticated saved reminder, owned grading-status view or notification read. Saved reminders and grading views deduplicate per customer/record rather than counting refreshes; no private record ID is emitted in marketing payloads.

Client-observed landing, product-detail view and supported install acceptance are separate from server-owned checkout and purchase events. Checkout initiation is recorded only after a validated Shopify checkout URL is returned; purchases stay gated off. Order-ledger changes queue a separate measurement worker independent of loyalty earning. It reads current Shopify financial/transaction/custom-attribute data, rejects test/incomplete payment evidence, and upserts one order per tenant/order ID. Refunds adjust the original paid-date cohort. Unknown source names remain `other_shopify`; POS and web are separate. Unmatched approved attribution remains visible. There is no automatic Shopify pixel coverage, cross-device certainty, or summation of ad-platform conversions as unique sales.

The report separates Shopify received/refunded/net amounts, existing external legacy break-payment evidence (including voided records, without inventing refund amounts), and consignment payouts, which are excluded from retail/marketing revenue. Legacy evidence is unmatched to campaigns and omitted under campaign/source filters. The CSV includes the authorized tenant, UTC date boundaries, selected filters, definitions, sync information, refund adjustments and unmatched counts. See `MARKETING-HUB-ENGAGEMENT-CONTRACT.md`. No live Marketing Hub was accessed or modified.

## Primary implementation references

- [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), plus the guide bundled with pinned Next 16.3.5.
- [MDN BeforeInstallPromptEvent](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent).
- [Web push overview](https://web.dev/articles/push-notifications-overview) and [web-push 3.6.7 API](https://github.com/web-push-libs/web-push).
- [Resend send-email and idempotency headers](https://resend.com/docs/api-reference/emails/send-email).
- [Shopify Admin Order fields](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), with the application's pinned API version retained.
