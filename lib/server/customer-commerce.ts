import "server-only";
import type { Connection, Money } from "../commerce";
import {
  type Sql,
  type Actor,
  transaction,
  withSession,
  requireCustomer,
} from "./db";
import { currentToken } from "./http";
import { ensureFresh, type StoredSession, type Tokens } from "./sessions";
import { AccessError, hashToken, unseal, validToken } from "./security";
import { TENANT, SHOP, liveOnly } from "./providers";
import {
  apiVersion,
  commerceConfig,
  cursor,
  gid,
  graphql,
} from "./shopify-config";
import type { Query } from "./storefront";
export type CustomerProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddress: { emailAddress: string | null } | null;
};
export type CustomerOrder = {
  id: string;
  name: string;
  processedAt: string;
  financialStatus: string;
  totalPrice: Money;
};
export async function customerContext(optional = false) {
  liveOnly();
  const token = await currentToken();
  if (!token && optional) return null;
  await ensureFresh(token);
  if (!validToken(token)) throw new AccessError(401, "sign_in_required");
  const actor = await withSession(token, async (_db, a) => {
    requireCustomer(a);
    return a;
  });
  const accessToken = await transaction("auth", async (db) => {
    const hash = hashToken(token);
    const s = (
      await db.query<StoredSession>(
        "select * from ns.sessions where token_hash=$1 and tenant_id=$2 and customer_id=$3 and provider='shopify' and revoked_at is null and expires_at>now() and token_expires_at>now()",
        [hash, actor.tenant_id, actor.customer_id],
      )
    ).rows[0];
    if (!s) throw new AccessError(401, "session_expired");
    return unseal<Tokens>(s.encrypted_tokens, hash).access_token;
  });
  return { actor, accessToken };
}
export async function customerQuery(accessToken: string): Promise<Query> {
  commerceConfig();
  const response = await fetch(
    `https://${SHOP}/.well-known/customer-account-api`,
    {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new AccessError(503, "customer_api_unavailable");
  const metadata = await response.json(),
    endpoint = new URL(metadata.graphql_api);
  const issuer = new URL(
    process.env.SHOPIFY_EXPECTED_ISSUER || "https://invalid.invalid",
  );
  const shopId = issuer.pathname.match(/^\/authentication\/([0-9]+)$/)?.[1];
  // Discovery supplies the shop-specific endpoint. Pin its version without changing its host/shop path.
  if (
    !shopId ||
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "shopify.com" ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !new RegExp(`^/${shopId}/account/customer/api/\\d{4}-\\d{2}/graphql$`).test(
      endpoint.pathname,
    )
  )
    throw new AccessError(503, "customer_endpoint_unverified");
  endpoint.pathname = endpoint.pathname.replace(
    /\/api\/\d{4}-\d{2}\//,
    `/api/${apiVersion()}/`,
  );
  return (query, variables) =>
    graphql(
      endpoint.toString(),
      { Authorization: accessToken },
      query,
      variables,
    );
}
export async function bindCustomer(db: Sql, actor: Actor, shopifyId: string) {
  requireCustomer(actor);
  if (actor.tenant_id !== TENANT) throw new AccessError(403, "wrong_shop");
  gid(shopifyId, "Customer");
  await db.query(
    "insert into ns.shopify_customers(tenant_id,customer_id,shop,shopify_id) values($1,$2,$3,$4) on conflict(tenant_id,customer_id) do nothing",
    [actor.tenant_id, actor.customer_id, SHOP, shopifyId],
  );
  const row = (
    await db.query<{ shopify_id: string }>(
      "select shopify_id from ns.shopify_customers where tenant_id=$1 and customer_id=$2 and shop=$3",
      [actor.tenant_id, actor.customer_id, SHOP],
    )
  ).rows[0];
  if (row?.shopify_id !== shopifyId)
    throw new AccessError(403, "verified_customer_conflict");
}
export async function customerAccount(query: Query, after?: string) {
  const data = await query<{
    customer: CustomerProfile & { orders: Connection<CustomerOrder> };
  }>(
    `query MyAccount($after: String) { customer { id firstName lastName emailAddress { emailAddress } orders(first: 12, after: $after, sortKey: PROCESSED_AT, reverse: true) { nodes { id name processedAt financialStatus totalPrice { amount currencyCode } } pageInfo { hasNextPage endCursor } } } }`,
    { after: cursor(after) },
  );
  if (!data.customer)
    throw new AccessError(401, "customer_account_unavailable");
  gid(data.customer.id, "Customer");
  return data.customer;
}
export async function loadCustomerAccount(after?: string) {
  const context = (await customerContext())!;
  const customer = await customerAccount(
    await customerQuery(context.accessToken),
    after,
  );
  await transaction("auth", (db) =>
    bindCustomer(db, context.actor, customer.id),
  );
  return customer;
}
export async function ownedOrders(db: Sql, actor: Actor) {
  requireCustomer(actor);
  return (
    await db.query(
      "select o.order_id,o.name,o.financial_status,o.cancelled_at,o.total_cents,o.received_cents,o.refunded_cents,o.currency,o.reconciled_at from ns.shopify_orders o join ns.shopify_customers c on c.tenant_id=o.tenant_id and c.shop=o.shop and c.shopify_id=o.shopify_customer_id where c.tenant_id=$1 and c.customer_id=$2 and c.shop=$3 order by o.provider_updated_at desc limit 100",
      [actor.tenant_id, actor.customer_id, SHOP],
    )
  ).rows;
}
