import test from "node:test";
import assert from "node:assert/strict";
import {
  checkoutTestConfig,
  startTestCheckout,
} from "../lib/server/checkout-test";
import { publicFlags } from "../lib/policy.mjs";
import { SHOP, TENANT } from "../lib/server/providers";
import type { Actor } from "../lib/server/db";
import {
  GET as liveGet,
  POST as livePost,
} from "../app/api/commerce/cart/route";

const actor: Actor = {
  tenant_id: TENANT,
  staff_id: "test-owner",
  staff_role: "owner",
  customer_id: null,
};
const shop = "northside-checkout-test.myshopify.com";
const env = {
  NORTHSIDE_CHECKOUT_TEST_MODE: "development-store",
  SHOPIFY_TEST_SHOP: shop,
  SHOPIFY_TEST_ADMIN_ACCESS_TOKEN: "SYNTHETIC_ADMIN",
  SHOPIFY_TEST_STOREFRONT_PRIVATE_TOKEN: "SYNTHETIC_STOREFRONT",
  SHOPIFY_TEST_ADMIN_TOKEN_EXPIRES_AT: "2099-01-01T00:00:00Z",
};
const variant = {
  id: "gid://shopify/ProductVariant/1",
  title: "Test variant",
  availableForSale: true,
  quantityAvailable: 2,
  currentlyNotInStock: false,
  price: { amount: "12.50", currencyCode: "USD" },
  product: { title: "Test", handle: "test" },
};
const input = { variantId: variant.id, quantity: 1 };
function provider(
  options: {
    development?: boolean;
    domain?: string;
    destination?: string;
    stock?: number;
    version?: string;
    transferAfter?: number;
    fail?: boolean;
    changedPrice?: boolean;
  } = {},
) {
  const calls: {
    url: string;
    query: string;
    variables: Record<string, unknown>;
    headers: Headers;
  }[] = [];
  let attestations = 0;
  const run: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    const { query, variables } = JSON.parse(String(init?.body));
    calls.push({
      url: String(url),
      query,
      variables,
      headers: new Headers(init?.headers),
    });
    assert.ok(String(url).startsWith(`https://${shop}/`));
    if (options.fail) return new Response("unavailable", { status: 500 });
    const item = { ...variant, quantityAvailable: options.stock ?? 2 };
    const cart = {
      id: "gid://shopify/Cart/SYNTHETIC?key=PRIVATE_CART",
      totalQuantity: 1,
      discountCodes: [],
      checkoutUrl: options.destination || `https://${shop}/checkouts/SYNTHETIC`,
      cost: {
        subtotalAmount: variant.price,
        totalAmount: variant.price,
        totalAmountEstimated: true,
      },
      lines: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: "PRIVATE_LINE",
            quantity: 1,
            merchandise: item,
            cost: { totalAmount: variant.price },
          },
        ],
      },
    };
    let data;
    if (query.includes("CheckoutTestStore")) {
      attestations++;
      data = {
        shop: {
          myshopifyDomain: options.domain || shop,
          plan: {
            partnerDevelopment:
              options.transferAfter && attestations > options.transferAfter
                ? false
                : (options.development ?? true),
          },
        },
      };
      assert.equal(
        new Headers(init?.headers).get("X-Shopify-Access-Token"),
        "SYNTHETIC_ADMIN",
      );
    } else {
      assert.equal(
        new Headers(init?.headers).get("Shopify-Storefront-Private-Token"),
        "SYNTHETIC_STOREFRONT",
      );
      assert.equal(
        new Headers(init?.headers).get("Shopify-Storefront-Buyer-IP"),
        "192.0.2.1",
      );
      if (query.includes("Availability")) data = { node: item };
      else if (query.startsWith("mutation")) {
        const operation = query.match(/^mutation (\w+)/)![1];
        data = { [operation]: { cart, userErrors: [], warnings: [] } };
      } else {
        if (options.changedPrice && query.includes("checkoutUrl"))
          cart.cost.totalAmount = { amount: "13.00", currencyCode: "USD" };
        data = { cart };
      }
    }
    return Response.json(
      { data },
      { headers: { "x-shopify-api-version": options.version || "2026-07" } },
    );
  };
  return { run, calls };
}

test("test checkout defaults closed; live shop, expired grants, fixtures and production deployment cannot activate it", () => {
  for (const bad of [
    {},
    { ...env, SHOPIFY_TEST_SHOP: SHOP },
    { ...env, SHOPIFY_TEST_SHOP: `${shop}/evil` },
    { ...env, SHOPIFY_TEST_ADMIN_TOKEN_EXPIRES_AT: "2020-01-01" },
    { ...env, NORTHSIDE_FIXTURES: "1" },
    { ...env, VERCEL_ENV: "production" },
  ])
    assert.throws(() => checkoutTestConfig(bad));
  assert.equal(publicFlags.purchases, false);
});

test("only current Northside owners/admins may prepare a test cart, before any provider call", async () => {
  const p = provider();
  for (const a of [
    { ...actor, staff_role: null, customer_id: "customer" },
    { ...actor, staff_role: "operations" },
    { ...actor, tenant_id: "foreign" },
    { ...actor, staff_id: null },
  ] as Actor[])
    await assert.rejects(startTestCheckout(a, input, "192.0.2.1", env, p.run));
  assert.equal(p.calls.length, 0);
});

test("authorized development checkout uses supported Cart operations and fresh provider attestation without live buyer identity", async () => {
  const p = provider();
  const result = await startTestCheckout(actor, input, "192.0.2.1", env, p.run);
  assert.equal(result.mode, "development-store");
  assert.equal(result.livePurchasesEnabled, false);
  assert.equal(result.checkoutUrl, `https://${shop}/checkouts/SYNTHETIC`);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_CART"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_LINE"));
  const mutations = p.calls.filter((c) => c.query.startsWith("mutation"));
  assert.equal(mutations.length, 3);
  assert.deepEqual(mutations[0].variables, {
    input: { buyerIdentity: { countryCode: "US" } },
  });
  assert.deepEqual(mutations[1].variables.lines, [
    { merchandiseId: variant.id, quantity: 1 },
  ]);
  assert.ok(
    p.calls.filter((c) => c.query.includes("CheckoutTestStore")).length >=
      mutations.length + 1,
  );
  assert.equal(publicFlags.purchases, false);
});

test("non-development status, wrong shop, transfer, provider failure, unavailable stock and unsafe URL fail closed", async () => {
  for (const option of [
    { development: false },
    { domain: SHOP },
    { transferAfter: 1 },
    { fail: true },
    { stock: 0 },
    { version: "2026-10" },
    { destination: `https://${SHOP}/checkouts/REAL` },
    { destination: `https://${shop}:444/checkouts/X` },
    { destination: "https://shopify.com/anything" },
    { changedPrice: true },
  ]) {
    const p = provider(option);
    await assert.rejects(
      startTestCheckout(actor, input, "192.0.2.1", env, p.run),
    );
    if (option.development === false || option.domain || option.fail)
      assert.equal(
        p.calls.filter((c) => c.query.startsWith("mutation")).length,
        0,
      );
  }
});

test("test cart rejects supplied prices, discounts, live cart handles and customer tokens", async () => {
  const p = provider();
  for (const key of [
    "price",
    "cartId",
    "customerAccessToken",
    "shop",
    "discountCode",
  ])
    await assert.rejects(
      startTestCheckout(
        actor,
        { ...input, [key]: "FORGED" },
        "192.0.2.1",
        env,
        p.run,
      ),
      /invalid_test_cart/,
    );
  await assert.rejects(
    startTestCheckout(
      actor,
      { ...input, quantity: 6 },
      "192.0.2.1",
      env,
      p.run,
    ),
    /test_quantity_limit/,
  );
  assert.equal(p.calls.length, 0);
});

test("production limited-sales cart rejects forged test requests and unapproved variants without provider access", async () => {
  const before = { ...process.env },
    originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    Object.assign(process.env, env, {
      NODE_ENV: "production",
      APP_ORIGIN: "https://app.example.test",
      SHOPIFY_SHOP: SHOP,
      SHOPIFY_API_VERSION: "2026-07",
      NORTHSIDE_FIXTURES: "0",
    });
    delete process.env.SHOPIFY_TRUSTED_BUYER_IP_HEADER;
    delete process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;
    globalThis.fetch = async () => {
      calls++;
      throw Error("No production provider request allowed");
    };
    const get = await liveGet(
      new Request("https://app.example.test/api/commerce/cart"),
    );
    assert.equal(get.status, 503);
    assert.deepEqual(await get.json(), { error: "shopify_not_configured" });
    for (const action of ["add", "update", "checkout", "reset"]) {
      const response = await livePost(
        new Request("https://app.example.test/api/commerce/cart", {
          method: "POST",
          headers: {
            origin: "https://app.example.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action, test: true }),
        }),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "unexpected_cart_input" });
    }
    const unapproved = await livePost(
      new Request("https://app.example.test/api/commerce/cart", {
        method: "POST",
        headers: {
          origin: "https://app.example.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "add", ...input }),
      }),
    );
    assert.equal(unapproved.status, 403);
    assert.deepEqual(await unapproved.json(), {
      error: "variant_not_approved_for_sale",
    });
    assert.equal(calls, 0);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    globalThis.fetch = originalFetch;
  }
});
