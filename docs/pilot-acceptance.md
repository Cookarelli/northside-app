# Repeatable pilot acceptance

October 19, 2026. This runner verifies a bounded slice of the protected previews.
It does not sign into customer/staff/operator accounts, create carts or orders,
upload files, send messages, start workers or activate features. Existing browser
sessions remain untouched while physical QR testing proceeds separately.

## Run

From the repository root, with Node 24 and the existing authorized Vercel CLI login:

```sh
pnpm acceptance:pilot /absolute/path/to/vercel/dist/index.js
```

On the pilot Mac the installed CLI entry point is
`/Users/northside/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js`.
If that npm cache entry disappears, use a reviewed installed CLI entry point; the
runner does not download a replacement or request a new token. No operator.env,
database password, Shopify client secret or application session is needed.

The runner pins both existing branch Preview origins, project IDs and team. It
checks the full deployment metadata through the authenticated Vercel CLI API:
correct repository/branch/project, READY, non-production target, commit SHA.
It verifies deployment IDs again at the end and refuses a run spanning a change.
It uses `vercel curl` for protected application requests and makes one separate
unauthenticated ingress request. It never follows redirects. Response size and
time are bounded; CLI output and raw headers/bodies never become evidence logs.
Only a sanitized report is retained in an ignored 0700 directory under `.runtime`,
with mode 0600. CLI subprocesses inherit a small environment allowlist, not app
secrets. A private wrapper invokes the Mac's `/usr/bin/curl` with `-q` first,
preventing user curl configuration from adding redirects, cookies, trace output
or extra URLs. Temporary CLI context, wrapper and headers are deleted.

Exit codes: **0** all automated checks pass within this limited scope; **1** a
check/setup failed; **2** the application checks passed but external ingress is
blocked. Even exit 0 is not full release acceptance. Each report includes the
manual and hosted checks that this runner cannot establish.

## Automated scope and observed result

Initial live run on October 19, 13:17 UTC checked both previews at `2a93d57`:

| Check | Result |
| --- | --- |
| Search for Zion and approved product detail | 200, correct product, purchase-disabled message |
| Anonymous identity, cards, orders and export | 401, exact application `sign_in_required`, no-store |
| Cart read | 503, exact `purchases_disabled`, no-store |
| Retail pickup page | 404, application HTML, no-store |
| Mission Control snapshot without operator session | 401, exact application error, no-store |
| Empty unsigned webhook through authorized Vercel transport | 401, exact `invalid_webhook_signature`, no-store |
| Same unsigned webhook without Vercel access | **BLOCKED: 401 before application signature verification** |

All ten application checks passed; the report correctly exits 2. Neither webhook
probe includes an order ID or valid HMAC; neither can enqueue an order. A 503 on a
private-data endpoint, a platform login page, an unexpected error body or a
redirect is a failure, not evidence of authorization. The cart's exact disabled
503 is intentionally expected. These checks do not establish current prices or
inventory, authenticated database health, staff role isolation, POS installation
state, worker service state or physical camera operation.

## Isolated webhook and order tests

Final local verification: **361 tests passed** (6 runner, 91 core, 17 customer
script, 247 customer service tests), both TypeScript checks, lint with one existing
unused-variable warning, both application builds and the 28-artifact client
configuration scan. The independent reviewer reran all 12 newly added tests and
reported no remaining blocking findings after the curl-configuration fix. No UI
component changed; this task leaves physical/browser acceptance with the tester.

```sh
node --test scripts/pilot-acceptance.test.mjs
pnpm --filter @northside/customer exec node --conditions=react-server --import tsx --test tests/commerce.test.ts tests/order-isolation.test.ts tests/webhook-acceptance.test.ts
```

The new webhook acceptance suite runs the existing SQL migrations in fresh
in-memory PGlite, with the actual restricted commerce role and synthetic signed
requests. It loads no env-file, removes database URLs and blocks fetch. It calls
the actual HTTP handler for negative inputs and persistence-unavailable handling;
the successful intake tests compose the actual raw-body verifier, receipt/job
functions and restricted database transaction. Positive HTTP-to-hosted-Supabase
delivery is **not** claimed. The provider reader is synthetic, and no worker
process/service is started.

Coverage includes invalid/tampered signatures, wrong shop/topic/delivery/JSON,
failure to persist returning 503 rather than acknowledging success, atomic receipt
and job rollback/redelivery, duplicate delivery, atomic order/ledger/receipt
rollback, all four supported topics, duplicate state under different delivery
IDs, refund-before-delayed-paid convergence, mismatched provider order ID and
eight-attempt retry exhaustion with sanitized failure messages. Existing tests
also cover stale snapshots, lease fencing/recovery, private order ownership,
restricted-role isolation and immutable ledger records. PGlite serializes access;
these tests do not prove multi-connection hosted PostgreSQL contention.

The runner's own tests reject platform HTML masquerading as success, unexpected
503/redirect responses, leaked extra JSON fields, missing no-store, fixture pages,
wrong deployment identity and production targets. They check subprocess error
redaction and that application secrets are not inherited.

## Exact remaining webhook steps

1. Review a narrow ingress design separately: a dedicated Preview webhook receiver
   accessible to Shopify while keeping customer/staff/Mission Control protection,
   retaining raw-body HMAC and the restricted commerce role. Use an approved
   platform-supported route exception only if its scope can be proven; otherwise
   use a separate receiver deployment. No protection change was made by this task,
   and no shared bypass secret should be added to webhook URLs.
2. Verify the installed app's subscriptions, including app-configured subscriptions,
   for `orders/paid`, `orders/cancelled`, `orders/updated`, `refunds/create`, API
   `2026-07`, exact receiver URL and corresponding app client secret. Earlier API
   inspection found no matching registrations; this runner does not repeat or
   mutate the subscription inventory.
3. Use an authorized noncharging test store/event with isolated test persistence.
   Prove actual signed delivery and replay, committed receipt/job and timely 2xx.
   Do not send a synthetic paid order to the pilot's business database. Shopify
   requires HMAC over the raw bytes and treats redirects as delivery failures;
   see [Shopify delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).
4. Review and enable a bounded order-processing service only after that test setup
   and its credentials are approved. Real services remain disabled, including the
   order worker and supervised coding workers. Then test canonical Admin reads,
   replay, failure/restart, refund/cancellation convergence and monitoring on the
   isolated target before considering pilot activation.

App checkout would create a Shopify online order visible in Shopify Admin →
Orders; it does not automatically become a POS transaction. Payment, fulfillment,
collection and POS behavior remain unverified and disabled in the app. No test
here modifies Shopify products, prices, inventory or payments.

Continue physical QR testing on the current product Preview. Record device/browser,
the exact label type, destination, displayed product/variant and current price,
camera permission/denial and repeated-scan behavior. Separate remaining acceptance:
two actual customer identities, an approved private file for ownership/Storage
tests, account-switch/logout on devices, and an authorized noncharging checkout
arrangement. Passing this runner never enables those flows.
