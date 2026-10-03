import { createHmac, timingSafeEqual } from "node:crypto";

export class ShopifyError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export type ShopifyConfig = {
  domain: string;
  version: string;
  storefrontToken: string;
  adminToken: string;
  webhookSecret: string;
};
export function configuration(
  env: NodeJS.ProcessEnv = process.env,
): ShopifyConfig {
  const domain = env.SHOPIFY_SHOP_DOMAIN ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new ShopifyError(
      "Configure the confirmed Shopify shop domain on the server.",
    );
  const version = env.SHOPIFY_API_VERSION || "2026-07";
  if (!/^202[6-9]-(01|04|07|10)$/.test(version))
    throw new ShopifyError("Configure a supported Shopify API version.");
  return {
    domain,
    version,
    storefrontToken: env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN ?? "",
    adminToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "",
    webhookSecret: env.SHOPIFY_WEBHOOK_SECRET ?? "",
  };
}
export function verifyWebhook(
  raw: Buffer,
  signature: string | null,
  secret: string,
): boolean {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const actual = Buffer.from(signature, "base64");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function graphql<T>(
  config: ShopifyConfig,
  kind: "storefront" | "admin",
  query: string,
  variables: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const token =
    kind === "storefront" ? config.storefrontToken : config.adminToken;
  if (!token)
    throw new ShopifyError(`Shopify ${kind} credentials are not configured.`);
  const url =
    kind === "storefront"
      ? `https://${config.domain}/api/${config.version}/graphql.json`
      : `https://${config.domain}/admin/api/${config.version}/graphql.json`;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [kind === "storefront"
        ? "Shopify-Storefront-Private-Token"
        : "X-Shopify-Access-Token"]: token,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new ShopifyError(
      "Shopify could not verify this request. Staff reconciliation may be needed.",
    );
  const json = (await response.json()) as { data: T; errors?: unknown[] };
  if (json.errors?.length || !json.data)
    throw new ShopifyError(
      "Shopify returned an API error. No payment was verified.",
    );
  return json.data;
}
/** Integration boundary. The customer route remains blocked until fulfillment is proven in a development store. */
export async function createCart(
  config: ShopifyConfig,
  lines: { variantId: string; quantity: number }[],
  reference: string,
  fetcher: typeof fetch = fetch,
) {
  if (
    !lines.length ||
    lines.some(
      (l) =>
        !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(l.variantId) ||
        !Number.isInteger(l.quantity) ||
        l.quantity <= 0,
    )
  )
    throw new ShopifyError(
      "A validated Shopify variant basket is required.",
      400,
    );
  const data = await graphql<{
    cartCreate: {
      cart: null | { id: string; checkoutUrl: string };
      userErrors: { message: string }[];
      warnings: { message: string }[];
    };
  }>(
    config,
    "storefront",
    `
      mutation NorthsideCart($input: CartInput!) {
        cartCreate(input: $input) {
          cart {
            id
            checkoutUrl
          }
          userErrors {
            message
          }
          warnings {
            message
          }
        }
      }
    `,
    {
      input: {
        lines: lines.map((l) => ({
          merchandiseId: l.variantId,
          quantity: l.quantity,
        })),
        attributes: [{ key: "_northside_reference", value: reference }],
      },
    },
    fetcher,
  );
  const result = data.cartCreate;
  if (result.userErrors.length || result.warnings.length || !result.cart)
    throw new ShopifyError(
      "Shopify changed or rejected the basket. Review availability and pricing before checkout.",
      409,
    );
  const url = new URL(result.cart.checkoutUrl);
  if (url.protocol !== "https:")
    throw new ShopifyError("Shopify returned an invalid checkout destination.");
  return { cartId: result.cart.id, url: url.toString() };
}
export async function verifyOrder(
  config: ShopifyConfig,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id))
    throw new ShopifyError("Invalid Shopify order ID.", 400);
  const data = await graphql<{
    order: null | {
      id: string;
      displayFinancialStatus: string;
      cancelledAt: string | null;
      customAttributes: { key: string; value: string }[];
      lineItems: {
        nodes: { quantity: number; variant: { id: string } | null }[];
        pageInfo: { hasNextPage: boolean };
      };
    };
  }>(
    config,
    "admin",
    `
      query NorthsideOrder($id: ID!) {
        order(id: $id) {
          id
          displayFinancialStatus
          cancelledAt
          customAttributes {
            key
            value
          }
          lineItems(first: 100) {
            nodes {
              quantity
              variant {
                id
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
    `,
    { id },
    fetcher,
  );
  const o = data.order;
  if (
    !o ||
    o.cancelledAt ||
    o.lineItems.pageInfo.hasNextPage ||
    o.lineItems.nodes.some((l) => !l.variant)
  )
    throw new ShopifyError("Order requires staff reconciliation.", 409);
  return {
    id: o.id,
    paid: o.displayFinancialStatus === "PAID",
    reference:
      o.customAttributes.find((a) => a.key === "_northside_reference")?.value ??
      "",
    lines: o.lineItems.nodes.map((l) => ({
      variantId: l.variant!.id,
      quantity: l.quantity,
    })),
  };
}
/** POS backend auth must also authorize this app installation and allowed location before enabling the bridge. */
export function verifyPosSessionToken(
  jwt: string,
  secret: string,
  audience: string,
  shopDomain: string,
  now = Math.floor(Date.now() / 1000),
) {
  const [header, payload, signature, ...extra] = jwt.split(".");
  if (extra.length || !header || !payload || !signature)
    throw new ShopifyError("Invalid POS session token.", 401);
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString());
    if (h.alg !== "HS256") throw 0;
    const expected = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      !secret ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      throw 0;
    const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      aud: string;
      dest: string;
      exp: number;
      nbf: number;
      sub: string;
    };
    if (
      p.aud !== audience ||
      p.dest !== `https://${shopDomain}` ||
      !Number.isFinite(p.exp) ||
      p.exp <= now ||
      !Number.isFinite(p.nbf) ||
      p.nbf > now ||
      !p.sub
    )
      throw 0;
    return p;
  } catch {
    throw new ShopifyError("Invalid or expired POS session token.", 401);
  }
}
