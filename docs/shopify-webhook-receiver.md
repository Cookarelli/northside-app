# Isolated Shopify webhook pilot receiver

Status, October 19: **receiver Preview deployed; all four subscriptions created and verified**. The Customer and Mission Control Previews retain their existing protection. Purchases, collection, POS, real commerce processors and real coding workers remain disabled. Actual Shopify-origin delivery is still unverified; the official synthetic delivery tool is awaiting CLI sign-in.

## Hosted pilot verification

- Receiver: [Preview health](https://northside-webhook-pilot-15eqolamo-steves-projects-e37a4ef4.vercel.app/health), deployment `dpl_3KKHhCezHS5Mb1SUNxp774eiLhNr`, project `prj_xf96xfNmquUZISLZ18difhsE6T1u`, team `team_iPL9ti94DMgRhfyzvbgjzZdG`.
- Verified READY, `target=null`, source `1304c2819b19a083c1f0698e25690821ed04770b`, branch `integration/supervised-store`. Vercel returns the Git identity in `meta.githubCommitSha` / `meta.githubCommitRef`.
- The only production deployment in this new project is a credential-free all-path 404 initialization placeholder. No customer/control/receiver application was promoted to production. Source is private; Git is unlinked.
- Four sensitive variables are **Preview-only within this dedicated project**, with no Production or Development values. Vercel rejected branch-scoped variables because the project is unlinked. The independently reviewed alternative preserves manual deployments and pins the source manifest; it does not connect Git or enable automatic PR deployments. These secrets apply to every manually created Preview in this project, not just one branch.
- Real Session-pooler TLS authentication passed as `northside_webhook_receiver`. Forced RLS, unsafe-role-attribute absence, anonymous/authenticated denial and business/control/catalog denial passed. Restricted insert/replay/conflict probes rolled back without persisted probe rows.
- Public health returned 200 with `processesOrders:false`; staff/control/order-list paths returned 404. Unsigned and tampered signatures returned 401. A signed synthetic canary and replay both returned the generic 200 acknowledgement, while changed signed content using the same delivery ID returned 409. A separate database read verified exactly one row for delivery `ec58396a-ae72-48bf-a612-b65fa424941e`. This is locally signed evidence, not Shopify-origin delivery.
- An independent verifier repeated the TLS/isolation probes and read the canary row. Customer and Control entry URLs still redirect to Vercel SSO. No source, gates or credentials for either existing app changed.

Four Admin API subscriptions were created and re-read with exact JSON format, endpoint, minimal fields and API version `2026-07`:

| Topic | Subscription ID |
| --- | --- |
| `ORDERS_PAID` | `gid://shopify/WebhookSubscription/2555904852337` |
| `ORDERS_CANCELLED` | `gid://shopify/WebhookSubscription/2555904885105` |
| `ORDERS_UPDATED` | `gid://shopify/WebhookSubscription/2555904917873` |
| `REFUNDS_CREATE` | `gid://shopify/WebhookSubscription/2555904950641` |

All point to the immutable receiver Preview above plus `/api/shopify/webhooks`. Fresh API inventory verified the exact app/installation and `read_orders` only before each create; the active Dev Dashboard version was rechecked. Attempt markers and returned IDs were saved privately before subsequent mutations. Re-running the read-only plan reports `keep` for all four; never blindly repeat a create after an uncertain response.

The official pinned Shopify CLI `4.9.4` requires browser authorization for its synthetic delivery tool. The selected existing account alone did not authorize that command. No synthetic provider request has been enqueued yet. Shopify documents that [CLI sample delivery cannot validate API subscriptions](https://shopify.dev/docs/api/shopify-cli/app/app-webhook-trigger); even a successful sample does not prove real order-event or payment/collection behavior. No order or inventory change was made to obtain evidence.

## Receiver boundary

`apps/webhooks` is a third, route-only Next.js app. Its only implemented endpoints are `POST /api/shopify/webhooks` and a generic `GET /health`. Health is liveness only and explicitly reports readiness as unchecked. There are no customer, staff, operator, order-list or credential-management screens.

The receiver is designed to accept public Shopify HTTPS POSTs **only on its separate Vercel project**. Do not disable Vercel authentication on Customer or Control, put a protection bypass secret in a webhook URL, or forward a router port to the Mac mini. Existing Customer webhook routes remain protected and are not the pilot delivery destination.

Intake verifies a SHA-256 HMAC over the exact raw bytes with constant-time comparison before JSON parsing or database access. It bounds the body to 1 MiB and one second, permits only JSON/uncompressed payloads, checks the fixed shop, API version, topic and delivery UUID, and rejects imprecise numeric order IDs. Error responses contain fixed codes, never payloads or provider/SQL error details. Database connection and statements have timeouts; the Vercel route has a five-second maximum. A non-2xx response leaves delivery retry to Shopify; the receiver runs no retry loop or background worker.

The signature authenticates the body. Shopify routing headers are validated but are not included in Shopify's body HMAC; they are not financial evidence. The signed body's `test: true` is recorded when present. A false/missing test field, including a refund payload, does **not** prove a live payment or order.

Only shop, delivery UUID, topic, order GID, API version, body hash, signed test marker and database receipt time are retained. No email, customer profile, address, line items, raw body or payment data is persisted. This metadata inbox cannot replay full business events and does not update app orders or dispatch jobs. Staff continue to rely on Shopify's actual order/payment/fulfillment records. Online checkout is not a POS transaction.

The additive migration creates `northside_webhook_receiver` as **NOLOGIN**, with no superuser, BYPASSRLS, replication, role creation, database creation, inheritance or memberships. It grants only schema USAGE, table SELECT and INSERT on seven named columns in `ns_webhook_pilot.receipts`; server-assigned receipt time cannot be supplied. RLS is enabled and forced. No business/control schema privileges or cross-schema triggers are added. Runtime rejects unsafe role attributes/memberships. Migration ownership stays with the operator, not the receiver.

Deduplication uses `(shop, delivery_id)`. The same delivery with matching metadata is acknowledged without another row; a reused ID with changed hash/topic/order/version/test status returns 409. A 200 is returned only after the transaction commits. `X-Shopify-Webhook-Id` identifies a delivery, not a general exactly-once business event guarantee. Reconciliation remains a separate disabled process.

## Earlier local validation

Independent verification passed 389 tests, root/customer/receiver typechecks,
all three production builds, and lint with one pre-existing warning. The new
receiver and planner contribute 28 tests, including actual PGlite restricted
session permissions and anonymous/authenticated denial. The verifier used each
app's own Next.js binary; using the root's different peer-context Next binary for
the customer build failed, while its normal app-local build passed. No build used
live secrets. The customer client configuration-name scan passed across 28
artifacts. Independent review passed after correcting topic normalization and the
SQL test's session-authorization setup.

Existing protected Previews at `a608015` passed ten read-only application checks
on October 19 at 13:51 UTC. Direct ingress remains blocked by Vercel; both app
entry pages redirected unauthenticated requests to Vercel sign-in. That earlier
run preceded hosted receiver provisioning; the current results are recorded above.

## Required private configuration

| Receiver value | Scope |
| --- | --- |
| `WEBHOOK_RECEIVER_MODE=pilot-inbox` | Metadata-only intake, no processing |
| `SHOPIFY_APP_CLIENT_SECRET` | Existing Northside app secret, HMAC verification only |
| `WEBHOOK_DATABASE_URL` | Only the new restricted role, Session pooler port 5432, database `postgres`, project `nrsuosydvjqovrevmych`, `sslmode=verify-full` |
| `WEBHOOK_DATABASE_CA_CERT` | Existing trusted Supabase CA PEM; certificate/hostname verification stays enabled |

The receiver gets **no** Admin access token/client ID, Storefront token, customer/control database URL, migration URL, Supabase secret key, operator password, Vercel token or worker credentials. All values must be server-only sensitive variables on the receiver Preview. Never prefix them with `NEXT_PUBLIC_` or place them in build arguments, command-line values, URLs or reports. The app secret is a sensitive credential even though receiver code uses it only to verify HMAC.

The existing app ID/secret were saved through the loopback private-capture form into the ignored, owner-only `operator.env`, preserving other values. Fresh API authorization and identity/scope readback succeeded. No credential was rotated. The local capture process was stopped after saving.

The saved operator-only `MIGRATION_DATABASE_URL` still returns `28P01` through both the Session pooler and direct PostgreSQL. Changing the Supabase account sign-in password does not change the project's database password. Both connected management identities deny project access, but the newly authenticated dashboard SQL Editor works as `postgres`. Runtime customer/control credentials must not be reset or substituted.

### Reviewed dashboard fallback

Read-only queries in the exact project's dashboard confirmed that the receiver role, inbox schema and migration ledger entry are absent. The operator has CREATEROLE without SUPERUSER, and can read `pg_authid` for verification. No database changes have been made by these checks.

`node --import tsx scripts/prepare-webhook-handoff.ts` prepares an ignored, owner-only `.runtime/webhooks/receiver-setup-private.sql` and `receiver-recovery.json`. It does not connect to any service. Random independent recovery credentials and their directory entries are fsynced before SQL is emitted; retries preserve the same credentials and refuse conflicting files. Never print, commit, upload or share either file.

The private SQL is one transaction: it checks fresh state, applies the checksum-pinned migration, checks attributes/grants/RLS, sets only the new role's initial 4096-iteration SCRAM verifier, and records only the committed schema migration in the ledger. An existing role/schema/ledger entry aborts rather than rotating a password. The SQL cannot independently identify a Supabase project by reference: the user must verify **nrsuosydvjqovrevmych** in the dashboard URL before replacing the entire query and running it.

PostgreSQL 17 automatically grants a newly created role to its nonsuperuser creator with ADMIN=true, INHERIT=false and SET=false. The guard allows only that inbound `postgres` administration membership; the receiver receives no outbound memberships. This does not give the receiver operator access. See [PostgreSQL role attributes](https://www.postgresql.org/docs/17/role-attributes.html).

Browser credential rules required the user to paste and submit the initial credential SQL. The user completed it, and actual receiver TLS login and isolation subsequently passed. Do not save credential SQL as a shared snippet or rerun fresh-state provisioning now that the role/schema exist. An uncertain outcome requires inspection, not blindly replaying the SQL.

Independent checks passed all 36 focused provisioning/receiver/subscription tests, root TypeScript and scoped lint. The eight provisioning cases include a real nonsuperuser PGlite operator, native creator membership, unsafe-default-grant rollback, partial-state refusal and private-file retry preservation. These synthetic checks do not establish hosted provisioning or delivery.

## Subscription plan and read-only inventory

Verified active Dev Dashboard release: `northside-supervised-pilot`, version `1169015242753`, app `436021788673`, webhook API **2026-07**, `read_orders` only, with no app-configured topics displayed. Before creation, a fresh paginated Admin API inventory returned zero subscriptions for the expected installation `1196680151409`. Current inventory contains the four exact subscriptions recorded above. Always refresh it before any subsequent subscription changes.

Prepared subscriptions:

| GraphQL topic | Payload fields | Destination |
| --- | --- | --- |
| `ORDERS_PAID` | `admin_graphql_api_id`, `test` | Dedicated receiver Preview `/api/shopify/webhooks` |
| `ORDERS_CANCELLED` | `admin_graphql_api_id`, `test` | Same |
| `ORDERS_UPDATED` | `admin_graphql_api_id`, `test` | Same |
| `REFUNDS_CREATE` | `order_id` | Same |

JSON format; API version comes from the **app's webhook configuration**, not a per-subscription mutation field. No write-order or inventory permission is needed. The prepared `webhookSubscriptionCreate` mutation uses `uri` and `includeFields`, and requests the resulting configuration and `userErrors` for readback.

`scripts/plan-shopify-webhooks.ts` is **read-only**, including its plan mode. It exchanges the existing same-organization app credential for a short-lived Admin token in memory, verifies the exact shop/app/installation and only `read_orders` on every inventory page, bounds responses and pagination, and prints no tokens or existing callback URLs. It never executes its emitted mutation.

Prepare a mode-0600 JSON file inside a private mode-0700 directory after reviewing the active app configuration:

```json
{
  "appId": "gid://shopify/App/436021788673",
  "webhookApiVersion": "2026-07",
  "appConfiguredTopics": [],
  "sameOrgConfirmed": true
}
```

`appConfiguredTopics` must reflect the actual active app configuration. Both `orders/paid` and `ORDERS_PAID` notation are recognized. Do not assert an empty list or same-organization authorization without checking them.

```sh
# Values are file paths only; never put secrets on the command line.
node --import tsx scripts/plan-shopify-webhooks.ts /absolute/private/operator.env --inspect /absolute/private/reviewed-app-config.json
node --import tsx scripts/plan-shopify-webhooks.ts /absolute/private/operator.env https://RECEIVER-PREVIEW-HOST /absolute/private/reviewed-app-config.json
```

An exact existing subscription is kept. Conflicting destinations, versions, fields, duplicates or app-configured topics produce `review-conflict` and exit 2. No existing subscription is deleted or overwritten. The hostname filter is only a planning constraint: **a Vercel-looking hostname is not proof of project ownership or Preview status**.

## Operator execution sequence after private setup is repaired

1. Recheck the operator login over verified TLS and project identity. Independently review and apply `20261019133518_shopify_webhook_pilot_inbox.sql` using the repository migration procedure. It creates a fresh NOLOGIN role/schema; if either already exists, stop and inspect instead of overwriting or replaying it blindly.
2. Generate an independent random receiver password into ignored mode-0600 recovery storage and fsync it before changing LOGIN/password. Use a reviewed provisioning transaction and a PostgreSQL-compatible SCRAM verifier, preserving existing passwords on retries. Do not reuse the seven-role provisioner: its allowlist intentionally excludes this new role. Never grant operator authority or either app role to the receiver.
3. Independently verify real receiver TLS login, exact attributes, absence of memberships/extra grants, forced RLS, denied business/control/anonymous/authenticated access, and insert/select-only inbox permissions. Check existing default grants and schema exposure on the actual hosted database. Local PGlite checks do not replace this step.
4. Prepare the separate `northside-webhook-pilot` Vercel project with root `apps/webhooks`, Node 24 and frozen installation with lifecycle scripts disabled. Use the established team `team_iPL9ti94DMgRhfyzvbgjzZdG`. Keep source private. Do not attach a live store domain or publish an app as production. The first-deployment promotion behavior previously observed requires an empty, credential-free placeholder initialization before a true application Preview; inspect metadata rather than assuming `--preview` is sufficient.
5. Deploy only the receiver's scoped secrets. Read actual Vercel metadata: expected team/new project, reviewed Git commit, `target=null`, READY, correct root. Verify Customer and Control protection is unchanged. Make only this receiver Preview externally reachable; do not change either existing project's protection policy.
6. Without Vercel credentials, verify unsigned POST returns the receiver's signature error, GET has no inbox access, and staff/control paths are absent. Send an explicitly synthetic signed canary with an unmistakable synthetic order ID and a unique UUID, verify one committed metadata row, replay to confirm one row, test tampering and storage failure. Do not inject into business receipts/order jobs. Retention/deletion of pilot receipts is an operator action; runtime cannot delete them.
7. Refresh both API and app-configured subscription inventories, review the generated four-topic plan, then create **only missing** subscriptions with the reviewed endpoint. Inspect `userErrors` and re-read all four topics, fields, URI and API version. If results are uncertain, inventory again before retrying; do not blindly repeat create mutations.
8. Use Shopify's supported synthetic webhook delivery tooling for the installed app. Verify the delivery in provider logs and the durable inbox, including a duplicate. A locally signed canary proves receiver mechanics, not that Shopify itself delivered it. Do not create paid orders, change inventory, enable checkout, or run a business processor to obtain this evidence.

To stop intake on the currently subscribed immutable deployment, apply Vercel authentication to **only the receiver project** and verify external POSTs are blocked. Shopify may retry failed deliveries. A new deployment or environment-variable edit alone does not stop the old immutable URL; the committed Vercel configuration also sets pilot mode. Removing the four recorded subscriptions or changing their destination is a separate reviewed operator action. Do not weaken either customer/control protection policy. Inbox retention remains operator-managed; runtime cannot delete receipts. Synthetic setup receipts may be retained for verification, and no business records were created.

References: [Shopify HTTPS delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [subscription creation](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/webhookSubscriptionCreate), [subscription input fields](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/WebhookSubscriptionInput).
