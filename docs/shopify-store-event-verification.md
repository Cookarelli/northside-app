# Northside store-specific webhook verification

Prepared October 20, 2026. This plan does not enable purchases, collection, POS,
commerce processors or real workers. Both existing apps retain authentication.
No new order, payment, inventory, subscription, scope or credential change is
part of this preparation.

## Diagnosis and current evidence

The official Shopify CLI sample has a valid HMAC but identifies its shop as
`shop.myshopify.com`, not Northside's `9i3hnb-jw.myshopify.com`. A temporary,
loopback-only listener inspected one CLI sample in memory, verified the HMAC,
and confirmed that the unchanged local handler rejects it. Forwarding the same
raw body and allowlisted Shopify headers to the existing immutable receiver
returned **403 with `{"error":"unrecognized_shop"}`** at 19:01:34 UTC.
No raw payload was logged or saved; the listener stopped afterward. This
reproduces the sample's rejection without weakening the deployed shop check or
adding a public diagnostic endpoint. The earlier 17:41 request's response body
was not captured; this later controlled reproduction establishes the sample
incompatibility, not the exact contents of the earlier request.

A fresh API read at 19:01:04 UTC verified the expected shop/app/installation,
`read_orders` only, and all four existing subscriptions unchanged. The query
`test:true` returned zero orders with no further page in the access available to
this app. `read_orders` normally exposes the last 60 days; this does not prove
there are no older test orders in Shopify Admin. No customer names, addresses,
line items, notes or emails were requested.

Independent read-only verification at 19:03:15 UTC found zero receipts for the
diagnostic delivery and zero receipts since 19:00 UTC. Receiver health was 200
with `processesOrders:false` and readiness `not-checked`; Customer and Mission
Control both redirected
unauthenticated requests to Vercel SSO.

## Selected path: next normal store update

The owner selected **verify the next normal store update**. No note edit or new
order is authorized. A read-only follow-up will check for `orders/updated`
receipts after `2026-10-20T19:03:15Z`, then correlate any candidate with provider
delivery evidence and the receiver response. No candidate alone is a pass.
Stop the follow-up after one verified event; leave every operational gate off.
The test-order alternative below is preparation only if the owner later chooses
it explicitly.

## Alternative event preparation

1. **No suitable test order:** prefer observing the next legitimate store order
   event that would happen anyway. This introduces no test mutation. A new
   `orders/updated` event is the most direct match for this test. Normal operations
   remain the merchant's decision; do not create, pay, refund, cancel or fulfill
   an order to generate a webhook. This app's commerce gates remain off.
2. **Existing designated test order:** obtain only its order number from the
   owner. Verify the exact shop and order, Shopify's `test=true` status, and that
   it is not a customer order. An internal label or zero price alone is not proof
   of a Shopify test order. For an older order outside API access, use authorized
   Shopify Admin inspection; do not add `read_all_orders` merely for this test.
3. Before proposing an edit, inspect applicable order-update workflows and
   installed integrations, and confirm any remaining operational uncertainty
   with the owner. Neither a note nor a tag is universally free of side effects.
   Do not alter workflows or other apps as part of this test.
4. If suitable, prepare exactly one **order-note append**, preserving the
   existing note. Proposed line:
   `Northside webhook verification — 2026-10-20 — no fulfillment action.`
   Show the exact order and appended line for approval before saving. Do not
   reproduce private existing notes in chat or reports. A Timeline comment is a
   different action and is not a substitute for an order-note edit.
5. Use the merchant's existing Admin permission for that one approved Save.
   The app remains `read_orders` only. Do not add API write scopes, change tags,
   contact a customer, or change payment, fulfillment, inventory or collection.
   Removing the marker would be another update; do not auto-clean it up.

If the owner cannot identify a suitable order or confirm downstream effects,
leave the event test pending. Creating a new test order or changing gateway test
mode requires a separate reviewed plan and explicit approval; neither is the
next automatic action here.

## Capture evidence without causing another event

Immediately before the chosen event, record a UTC start time and the verified
order GID privately. Re-read the exact four subscription IDs, immutable callback,
API version `2026-07`, minimal fields and `read_orders` scope. Check receiver
health and confirm Customer and Control remain protected. Do not use a Vercel
bypass credential in the webhook URL.

After the approved or naturally occurring event:

- Read Shopify delivery details, if present, for the app and exact store. Record
  topic, delivery ID, timestamp, destination and response status without copying
  the payload or customer data.
- Read the receiver's metadata inbox with the restricted role over verified TLS.
  Require a matching shop, delivery ID, topic, order GID, API version and expected
  test flag. Require one committed row, not just an HTTP log or a CLI success.
- Correlate the receiver's HTTP response and commit with the provider event.
  A matching 200 and row establish intake for that event; they do not establish
  payment, order processing, collection, POS or worker behavior. Testing
  `orders/updated` does not prove deliveries of the other three topics.
- If delivery fails, inspect its exact response and the receiver logs before
  another action. Do not disable signature/shop validation, inject a replacement
  shop header, or create a financial event as a workaround.

## Replay and duplicate limitations

No supported manual replay API or Dev Dashboard control was established during
this review. Shopify documents automatic retries of genuine failed deliveries,
up to eight attempts over four hours; CLI samples have no retries and cannot
validate API-created subscriptions. Do not intentionally break the receiver to
force retries or call a locally signed POST a provider replay.

The existing reduced order payload contains only `admin_graphql_api_id` and
`test`. Successive note edits can therefore produce identical payloads. Shopify
may drop identical deliveries within an unspecified short debounce window.
Repeatedly adding/removing a note is not a reliable delivery or duplicate test.
The recommended `updated_at` field would require a separately reviewed
subscription-plan change; it has **not** been added. The local signed duplicate
and conflict tests remain separate evidence from provider duplicate delivery.

## What is needed from the owner

No new secret or login is currently needed. Choose either passive verification
of the next normal store event, or provide the number of an existing designated
Shopify test order for inspection. Approval for one exact note append is requested
only after eligibility and downstream effects have been reviewed. No order edit
is authorized merely by supplying its number.

References: [CLI limitations](https://shopify.dev/docs/api/shopify-cli/app/app-webhook-trigger),
[delivery failures and retries](https://shopify.dev/docs/apps/build/webhooks/troubleshoot),
[reduced payloads and debouncing](https://shopify.dev/docs/apps/build/webhooks/delivery-structure#debouncing),
[order access limits](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order),
[order notes](https://help.shopify.com/en/manual/fulfillment/managing-orders/managing-order-details).
