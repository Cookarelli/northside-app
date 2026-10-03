import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  addLine,
  updateLine,
  checkout,
  browse,
  product,
  cartView,
  checkAvailable,
  type Query,
} from "../lib/server/storefront";
import {
  apiVersion,
  commerceConfig,
  cents,
  buyerIP,
  graphql,
} from "../lib/server/shopify-config";
import { verifyDelivery, rawBody } from "../lib/server/order-jobs";
import { adminToken, fetchOrder } from "../lib/server/admin-shopify";
import {
  customerAccount,
  customerQuery,
} from "../lib/server/customer-commerce";
import { safeShopBack } from "../lib/commerce";
import { SHOP } from "../lib/server/providers";
import { hashToken } from "../lib/server/security";
import { cartInput } from "../lib/server/cart-input";
import type { Cart, Variant } from "../lib/commerce";
process.env.NORTHSIDE_FIXTURES = "0";
process.env.SHOPIFY_SHOP = SHOP;
process.env.SHOPIFY_API_VERSION = "2026-07";
const money = { amount: "85.00", currencyCode: "USD" };
const variant: Variant = {
  id: "gid://shopify/ProductVariant/1",
  title: "SAMPLE variant",
  availableForSale: true,
  quantityAvailable: 3,
  currentlyNotInStock: false,
  price: money,
};
const pageInfo = { hasNextPage: false, endCursor: null };
test("cart request rejects browser prices, buyer tokens, ownership claims and raw cart IDs", () => {
  const input = { action: "add", variantId: variant.id, quantity: 1 };
  for (const key of [
    "price",
    "discount",
    "customerId",
    "customerAccessToken",
    "cartId",
  ])
    assert.throws(
      () => cartInput({ ...input, [key]: "SAMPLE_FORGED" }),
      /unexpected_cart_input/,
    );
  assert.deepEqual(cartInput(input), input);
  assert.throws(
    () => cartInput({ ...input, quantity: "1" }),
    /invalid_quantity/,
  );
});
const cart: Cart = {
  id: "gid://shopify/Cart/SAMPLE?key=SECRET_FIXTURE",
  totalQuantity: 1,
  checkoutUrl: `https://${SHOP}/checkouts/SAMPLE`,
  cost: {
    subtotalAmount: money,
    totalAmount: money,
    totalAmountEstimated: true,
  },
  discountCodes: [],
  lines: {
    pageInfo,
    nodes: [
      {
        id: "line-SAMPLE-secret",
        quantity: 1,
        merchandise: {
          ...variant,
          product: { title: "SAMPLE", handle: "sample" },
        },
        cost: { totalAmount: money },
      },
    ],
  },
};
function provider(
  options: {
    stock?: Variant | null;
    expired?: boolean;
    warning?: boolean;
    foreignCheckout?: boolean;
  } = {},
) {
  const calls: { q: string; v: Record<string, unknown> }[] = [];
  const query: Query = async <T>(q: string, vars: object) => {
    const v = vars as Record<string, unknown>;
    calls.push({ q, v });
    const c = structuredClone(cart);
    if (options.foreignCheckout)
      c.checkoutUrl = "https://attacker.invalid/checkout";
    let data: unknown;
    if (q.startsWith("query Availability"))
      data = { node: options.stock === undefined ? variant : options.stock };
    else if (q.startsWith("query Cart"))
      data = { cart: options.expired ? null : c };
    else if (q.startsWith("mutation")) {
      const operation = q.split("(")[0].split(" ")[1];
      data = {
        [operation]: {
          cart: c,
          userErrors: [],
          warnings: options.warning
            ? [{ code: "MERCHANDISE_NOT_ENOUGH_STOCK" }]
            : [],
        },
      };
    } else if (q.startsWith("query Collections"))
      data = { collections: { nodes: [], pageInfo } };
    else if (q.startsWith("query Products"))
      data = { products: { nodes: [], pageInfo } };
    else if (q.startsWith("query Product(")) data = { product: null };
    else throw Error("Unexpected fixture query");
    return data as T;
  };
  return { query, calls };
}
test("Storefront availability rejects missing/draft, zero stock, unavailable and backorder variants", async () => {
  for (const stock of [
    null,
    { ...variant, availableForSale: false },
    { ...variant, quantityAvailable: 0 },
    { ...variant, quantityAvailable: null },
    { ...variant, currentlyNotInStock: true },
  ]) {
    const p = provider({ stock });
    await assert.rejects(
      addLine(p.query, cart.id, variant.id, 1),
      /quantity_unavailable/,
    );
    assert.equal(
      p.calls.some((c) => c.q.startsWith("mutation")),
      false,
    );
  }
  assert.throws(() => checkAvailable(variant, 4), /quantity_unavailable/);
});
test("cart addition checks aggregate quantities, ignores client prices and redacts cart secrets", async () => {
  const p = provider();
  await addLine(p.query, cart.id, variant.id, 2);
  const mutation = p.calls.find((c) => c.q.startsWith("mutation"))!;
  assert.deepEqual(mutation.v, {
    id: cart.id,
    lines: [{ merchandiseId: variant.id, quantity: 2 }],
  });
  await assert.rejects(
    addLine(p.query, cart.id, variant.id, 3),
    /quantity_unavailable/,
  );
  await assert.rejects(
    addLine(p.query, cart.id, variant.id, -1),
    /invalid_quantity/,
  );
  const view = JSON.stringify(cartView(cart));
  assert.ok(
    !view.includes("SECRET_FIXTURE") &&
      !view.includes("line-SAMPLE-secret") &&
      !view.includes("checkoutUrl"),
  );
});
test("expired cart, foreign line and provider stock correction require review", async () => {
  await assert.rejects(
    addLine(provider({ expired: true }).query, cart.id, variant.id, 1),
    /cart_expired/,
  );
  await assert.rejects(
    updateLine(provider().query, cart.id, "forged-line", 1),
    /cart_line_unavailable/,
  );
  await assert.rejects(
    addLine(provider({ warning: true }).query, cart.id, variant.id, 1),
    /cart_changed_review_required/,
  );
  const p = provider();
  await updateLine(p.query, cart.id, hashToken(cart.lines.nodes[0].id), 0);
  assert.deepEqual(p.calls.at(-1)?.v.lines, [cart.lines.nodes[0].id]);
});
test("guest and verified-customer checkout recheck stock and fetch a fresh Shopify URL", async () => {
  for (const token of [undefined, "SAMPLE_verified_customer_token"]) {
    const p = provider();
    assert.equal(await checkout(p.query, cart.id, token), cart.checkoutUrl);
    assert.deepEqual(p.calls[0].v.buyer, {
      countryCode: "US",
      customerAccessToken: token || null,
    });
    assert.ok(p.calls[1].q.includes("Availability"));
    assert.ok(p.calls.at(-1)?.q.includes("checkoutUrl"));
  }
  await assert.rejects(
    checkout(
      provider({ stock: { ...variant, quantityAvailable: 0 } }).query,
      cart.id,
    ),
    /quantity_unavailable/,
  );
  await assert.rejects(
    checkout(provider({ foreignCheckout: true }).query, cart.id),
    /checkout_destination_unverified/,
  );
});
test("empty Draft catalog stays empty, unpublished handle is unavailable, filters are variables", async () => {
  const p = provider(),
    data = await browse(p.query, {
      q: 'cards" OR status:active',
      category: "Baseball",
      after: "SAMPLE_CURSOR",
    });
  assert.equal(data.products.nodes.length, 0);
  assert.equal(await product(p.query, "unpublished"), null);
  assert.ok(!p.calls.some((c) => c.q.includes("admin")));
  assert.equal(p.calls[1].v.after, "SAMPLE_CURSOR");
  assert.match(String(p.calls[1].v.query), /product_type:"Baseball"/);
  assert.equal(safeShopBack("//attacker.invalid/shop"), "/shop");
  assert.equal(
    safeShopBack("/shop?q=basketball&category=Basketball&page=2"),
    "/shop?q=basketball&category=Basketball&page=2",
  );
});
test("config is pinned, fixtures cannot call live, buyer IP requires verified ingress", () => {
  assert.equal(apiVersion(), "2026-07");
  process.env.SHOPIFY_API_VERSION = "unstable";
  assert.throws(apiVersion, /version_requires_validation/);
  process.env.SHOPIFY_API_VERSION = "2026-07";
  process.env.NORTHSIDE_FIXTURES = "1";
  assert.throws(commerceConfig, /fixture_mode/);
  process.env.NORTHSIDE_FIXTURES = "0";
  process.env.SHOPIFY_TRUSTED_BUYER_IP_HEADER = "x-reviewed-ingress-ip";
  assert.throws(
    () => buyerIP(new Headers({ "x-forwarded-for": "1.2.3.4" })),
    /verified_buyer_ip_required/,
  );
  assert.equal(
    buyerIP(new Headers({ "x-reviewed-ingress-ip": "192.0.2.10" })),
    "192.0.2.10",
  );
  assert.equal(cents({ amount: "0.29", currencyCode: "USD" }), 29);
  assert.throws(
    () => cents({ amount: "1.111", currencyCode: "USD" }),
    /unsupported_money/,
  );
});
test("GraphQL transport rejects provider errors and silent API-version fall-forward without leaking details", async () => {
  for (const result of [
    new Response(JSON.stringify({ errors: [{ message: "SECRET" }] })),
    new Response(JSON.stringify({ data: { ok: true } }), {
      headers: { "x-shopify-api-version": "2027-01" },
    }),
  ]) {
    await assert.rejects(
      graphql(
        "https://example.test",
        {},
        "query Test { shop { name } }",
        {},
        async () => result,
      ),
      (e) => e instanceof Error && !e.message.includes("SECRET"),
    );
  }
});
function signed(raw: Buffer, topic = "orders/paid", shop = SHOP) {
  return new Headers({
    "x-shopify-shop-domain": shop,
    "x-shopify-topic": topic,
    "x-shopify-webhook-id": randomUUID(),
    "x-shopify-hmac-sha256": createHmac("sha256", "SAMPLE_SECRET")
      .update(raw)
      .digest("base64"),
  });
}
test("webhook validates raw body, exact shop, signature length and safe refund order ID", async () => {
  const raw = Buffer.from(
    '{ "admin_graphql_api_id": "gid://shopify/Order/100" }',
  );
  assert.equal(
    verifyDelivery(raw, signed(raw), "SAMPLE_SECRET").orderId,
    "gid://shopify/Order/100",
  );
  assert.throws(
    () =>
      verifyDelivery(
        Buffer.from(raw.toString().trim() + " "),
        signed(raw),
        "SAMPLE_SECRET",
      ),
    /invalid_webhook_signature/,
  );
  assert.throws(
    () =>
      verifyDelivery(
        raw,
        signed(raw, "orders/paid", "foreign.myshopify.com"),
        "SAMPLE_SECRET",
      ),
    /unrecognized_shop/,
  );
  const invalid = signed(raw);
  invalid.set("x-shopify-hmac-sha256", "x");
  assert.throws(
    () => verifyDelivery(raw, invalid, "SAMPLE_SECRET"),
    /signature/,
  );
  const refund = Buffer.from('{"order_id":100}');
  assert.equal(
    verifyDelivery(refund, signed(refund, "refunds/create"), "SAMPLE_SECRET")
      .orderId,
    "gid://shopify/Order/100",
  );
  const unsafe = Buffer.from('{"order_id":9007199254740999}');
  assert.throws(
    () =>
      verifyDelivery(unsafe, signed(unsafe, "refunds/create"), "SAMPLE_SECRET"),
    /invalid_shopify_id/,
  );
  await assert.rejects(
    rawBody(
      new Request("https://example.test", {
        method: "POST",
        body: "0123456789",
      }),
      5,
    ),
    /request_too_large/,
  );
});
test("Admin credentials cannot use client credentials without confirmed ownership or an expired OAuth grant", async () => {
  process.env.SHOPIFY_ADMIN_AUTH_MODE = "same_org_client_credentials";
  process.env.SHOPIFY_SAME_ORG_CONFIRMED = "false";
  await assert.rejects(adminToken(), /installation_unverified/);
  process.env.SHOPIFY_ADMIN_AUTH_MODE = "installed_oauth";
  process.env.SHOPIFY_ADMIN_TOKEN_EXPIRES_AT = "2020-01-01T00:00:00Z";
  await assert.rejects(adminToken(), /token_expired/);
});
test("Customer Account query uses current token scope, with no customer selector or email matching", async () => {
  let queryText = "",
    variables: object = {};
  const q: Query = async <T>(q: string, v: object) => {
    queryText = q;
    variables = v;
    return {
      customer: {
        id: "gid://shopify/Customer/1",
        orders: { nodes: [], pageInfo },
      },
    } as T;
  };
  const data = await customerAccount(q, "SAMPLE_CURSOR");
  assert.equal(data.id, "gid://shopify/Customer/1");
  assert.deepEqual(variables, { after: "SAMPLE_CURSOR" });
  assert.ok(
    !queryText.includes("customer(id:") && !queryText.includes("query: $email"),
  );
  const saved = globalThis.fetch;
  process.env.SHOPIFY_EXPECTED_ISSUER =
    "https://shopify.com/authentication/103967392113";
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ graphql_api: "https://attacker.invalid/graphql" }),
      );
    await assert.rejects(customerQuery("SAMPLE_TOKEN"), /endpoint_unverified/);
  } finally {
    globalThis.fetch = saved;
  }
});
test("Admin reconciliation uses Shopify totals and rejects a mismatched returned order", async () => {
  const q: Query = async <T>() =>
    ({
      order: {
        id: "gid://shopify/Order/100",
        name: "SAMPLE",
        customer: null,
        displayFinancialStatus: "PARTIALLY_REFUNDED",
        cancelledAt: null,
        updatedAt: "2026-09-12T12:00:00Z",
        currentTotalPriceSet: { shopMoney: money },
        totalReceivedSet: { shopMoney: money },
        totalRefundedSet: {
          shopMoney: { amount: "25.00", currencyCode: "USD" },
        },
      },
    }) as T;
  assert.equal(
    (await fetchOrder(q, "gid://shopify/Order/100")).refundedCents,
    2500,
  );
  await assert.rejects(
    fetchOrder(q, "gid://shopify/Order/200"),
    /order_state_unavailable/,
  );
});
