import "server-only";
import {
  commerceConfig,
  required,
  graphql,
  gid,
  cents,
} from "./shopify-config";
import { AccessError } from "./security";
import type { Query } from "./storefront";
import type { Money } from "../commerce";
let cached: { token: string; until: number } | undefined;
export async function adminToken(run = fetch) {
  const { shop } = commerceConfig();
  const mode = process.env.SHOPIFY_ADMIN_AUTH_MODE;
  if (mode === "installed_oauth") {
    // Supplied by a supported app installation/token broker, with explicit expiry. Never assume a permanent legacy token.
    const expires = Date.parse(required("SHOPIFY_ADMIN_TOKEN_EXPIRES_AT"));
    if (!Number.isFinite(expires) || expires < Date.now() + 60000)
      throw new AccessError(503, "admin_oauth_token_expired");
    return required("SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  if (
    mode !== "same_org_client_credentials" ||
    process.env.SHOPIFY_SAME_ORG_CONFIRMED !== "true"
  )
    throw new AccessError(503, "admin_installation_unverified");
  if (cached && cached.until > Date.now() + 60000) return cached.token;
  const response = await run(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: required("SHOPIFY_APP_CLIENT_ID"),
      client_secret: required("SHOPIFY_APP_CLIENT_SECRET"),
    }),
  });
  if (!response.ok) throw new AccessError(503, "admin_authorization_failed");
  const data = await response.json();
  if (
    typeof data.access_token !== "string" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 60 ||
    !String(data.scope).split(",").includes("read_orders")
  )
    throw new AccessError(503, "admin_scope_or_expiry_invalid");
  cached = {
    token: data.access_token,
    until: Date.now() + data.expires_in * 1000,
  };
  return data.access_token as string;
}
export async function adminQuery(): Promise<Query> {
  const { shop, version } = commerceConfig(),
    token = await adminToken();
  return (query, variables) =>
    graphql(
      `https://${shop}/admin/api/${version}/graphql.json`,
      { "X-Shopify-Access-Token": token },
      query,
      variables,
    );
}
type Bag = { shopMoney: Money };
export type OrderSnapshot = {
  id: string;
  customerId: string | null;
  name: string;
  financialStatus: string;
  cancelledAt: string | null;
  updatedAt: string;
  currency: "USD";
  totalCents: number;
  receivedCents: number;
  refundedCents: number;
};
export async function fetchOrder(
  query: Query,
  id: string,
): Promise<OrderSnapshot> {
  const data = await query<{
    order: {
      id: string;
      customer: { id: string } | null;
      name: string;
      displayFinancialStatus: string;
      cancelledAt: string | null;
      updatedAt: string;
      currentTotalPriceSet: Bag;
      totalReceivedSet: Bag;
      totalRefundedSet: Bag;
    } | null;
  }>(
    `query ReconcileOrder($id: ID!) { order(id: $id) { id customer { id } name displayFinancialStatus cancelledAt updatedAt currentTotalPriceSet { shopMoney { amount currencyCode } } totalReceivedSet { shopMoney { amount currencyCode } } totalRefundedSet { shopMoney { amount currencyCode } } } }`,
    { id: gid(id, "Order") },
  );
  const o = data.order;
  if (!o || o.id !== id || !Number.isFinite(Date.parse(o.updatedAt)))
    throw new AccessError(503, "order_state_unavailable");
  return {
    id: o.id,
    customerId: o.customer ? gid(o.customer.id, "Customer") : null,
    name: o.name,
    financialStatus: o.displayFinancialStatus,
    cancelledAt: o.cancelledAt,
    updatedAt: new Date(o.updatedAt).toISOString(),
    currency: "USD",
    totalCents: cents(o.currentTotalPriceSet.shopMoney),
    receivedCents: cents(o.totalReceivedSet.shopMoney),
    refundedCents: cents(o.totalRefundedSet.shopMoney),
  };
}
