import "server-only";
import { isIP } from "node:net";
import { type Actor, requireRole } from "./db";
import { SHOP, TENANT } from "./providers";
import { AccessError } from "./security";
import { TESTED_API_VERSION, gid } from "./shopify-config";
import {
  addLine,
  cartView,
  checkout,
  createCart,
  quantity,
  type Query,
} from "./storefront";

type Environment = Record<string, string | undefined>;
export function checkoutTestConfig(env: Environment = process.env) {
  if (
    env.NORTHSIDE_CHECKOUT_TEST_MODE !== "development-store" ||
    env.VERCEL_ENV === "production" ||
    env.NORTHSIDE_FIXTURES === "1"
  )
    throw new AccessError(503, "checkout_test_disabled");
  const shop = env.SHOPIFY_TEST_SHOP || "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || shop === SHOP)
    throw new AccessError(503, "separate_development_store_required");
  const expires = Date.parse(env.SHOPIFY_TEST_ADMIN_TOKEN_EXPIRES_AT || "");
  if (
    !env.SHOPIFY_TEST_ADMIN_ACCESS_TOKEN?.trim() ||
    !env.SHOPIFY_TEST_STOREFRONT_PRIVATE_TOKEN?.trim() ||
    !Number.isFinite(expires) ||
    expires <= Date.now() + 60000
  )
    throw new AccessError(503, "checkout_test_credentials_required");
  return {
    shop,
    adminToken: env.SHOPIFY_TEST_ADMIN_ACCESS_TOKEN,
    storefrontToken: env.SHOPIFY_TEST_STOREFRONT_PRIVATE_TOKEN,
  };
}

export function requireCheckoutTester(actor: Actor) {
  requireRole(actor, ["owner", "admin"]);
  if (actor.tenant_id !== TENANT || !actor.staff_id || actor.customer_id)
    throw new AccessError(403, "northside_staff_required");
}

// Separate transport: never fall back to live shop credentials, buyer tokens or cart handles.
export async function startTestCheckout(
  actor: Actor,
  input: unknown,
  ip: string,
  env: Environment = process.env,
  run: typeof fetch = fetch,
) {
  requireCheckoutTester(actor);
  const config = checkoutTestConfig(env);
  if (!isIP(ip)) throw new AccessError(503, "verified_buyer_ip_required");
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["variantId", "quantity"].includes(key))
  )
    throw new AccessError(400, "invalid_test_cart");
  const body = input as Record<string, unknown>;
  const variantId = gid(body.variantId, "ProductVariant"),
    n = quantity(body.quantity);
  if (n > 5) throw new AccessError(400, "test_quantity_limit");

  async function query<T>(
    admin: boolean,
    document: string,
    variables: object,
  ): Promise<T> {
    // Revalidate expiry/configuration on every request; do not cache development status.
    checkoutTestConfig(env);
    const response = await run(
      `https://${config.shop}/${admin ? "admin/api" : "api"}/${TESTED_API_VERSION}/graphql.json`,
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          ...(admin
            ? { "X-Shopify-Access-Token": config.adminToken }
            : {
                "Shopify-Storefront-Private-Token": config.storefrontToken,
                "Shopify-Storefront-Buyer-IP": ip,
              }),
        },
        body: JSON.stringify({ query: document, variables }),
      },
    );
    if (
      !response.ok ||
      response.headers.get("x-shopify-api-version") !== TESTED_API_VERSION
    )
      throw new AccessError(503, "checkout_test_provider_unavailable");
    const result = await response.json();
    if (result.errors?.length || !result.data)
      throw new AccessError(503, "checkout_test_provider_unavailable");
    return result.data;
  }
  async function attest() {
    const data = await query<{
      shop: { myshopifyDomain: string; plan: { partnerDevelopment: boolean } };
    }>(
      true,
      "query CheckoutTestStore { shop { myshopifyDomain plan { partnerDevelopment } } }",
      {},
    );
    if (
      data.shop?.myshopifyDomain !== config.shop ||
      data.shop?.plan?.partnerDevelopment !== true
    )
      throw new AccessError(503, "development_store_not_verified");
  }
  const catalog: Query = async <T>(document: string, variables: object) => {
    await attest();
    return query<T>(false, document, variables);
  };
  const cart = await createCart(catalog);
  const updated = await addLine(catalog, cart.id, variantId, n);
  const url = await checkout(catalog, cart.id, undefined, [config.shop]);
  await attest();
  return {
    mode: "development-store" as const,
    shop: config.shop,
    checkoutUrl: url,
    cart: cartView(updated),
    livePurchasesEnabled: false as const,
  };
}
