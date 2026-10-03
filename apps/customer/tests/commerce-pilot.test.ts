import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectCommercePilot,
  inspectInstallation,
  inspectWebhookSubscriptions,
  pilotTopics,
} from "../lib/server/commerce-pilot";
import type { Actor } from "../lib/server/db";
import type { Query } from "../lib/server/storefront";

const owner: Actor = {
  tenant_id: "northside",
  customer_id: null,
  staff_id: "invited-owner",
  staff_role: "owner",
};
const page = { hasNextPage: false, endCursor: null };
const installation = {
  shop: {
    myshopifyDomain: "9i3hnb-jw.myshopify.com",
    plan: {
      publicDisplayName: "Development",
      shopifyPlus: false,
      partnerDevelopment: true,
    },
  },
  currentAppInstallation: {
    id: "gid://shopify/AppInstallation/1",
    app: { id: "gid://shopify/App/2", title: "Test installation" },
    accessScopes: [{ handle: "read_orders" }],
  },
};
function fixtureQuery(
  responses: Record<string, unknown>,
  calls: string[],
): Query {
  return async <T>(query: string): Promise<T> => {
    calls.push(query);
    assert.match(query, /^query /);
    const name = Object.keys(responses).find((key) => query.includes(key));
    assert.ok(name, "Only the expected read-only operations are permitted");
    return structuredClone(responses[name]) as T;
  };
}

test("pilot configuration reads require an invited owner/admin role before any provider call", async () => {
  let calls = 0;
  const fail = () => {
    calls++;
    throw Error("should not be called");
  };
  for (const role of [
    null,
    "operations",
    "content_editor",
    "read_only",
  ] as const) {
    await assert.rejects(
      inspectCommercePilot({ ...owner, staff_role: role }, undefined, {
        catalog: fail,
        admin: async () => fail(),
        origin: fail,
      }),
      /staff_permission_required/,
    );
  }
  assert.equal(calls, 0);
});

test("local fixture opt-in blocks live pilot reads even for an owner", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    NORTHSIDE_FIXTURES: process.env.NORTHSIDE_FIXTURES,
  };
  let calls = 0;
  const fail = () => {
    calls++;
    throw Error();
  };
  try {
    Object.assign(process.env, { NODE_ENV: "test", NORTHSIDE_FIXTURES: "1" });
    await assert.rejects(
      inspectCommercePilot(owner, undefined, {
        catalog: fail,
        admin: async () => fail(),
        origin: fail,
      }),
      /live_commerce_disabled_in_fixture_mode/,
    );
    assert.equal(calls, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("published Storefront data is read without activating purchases or pickup", async () => {
  const calls: string[] = [];
  const id = "gid://shopify/Product/101";
  const proof = {
    id,
    title: "Published card",
    handle: "published-card",
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/102",
          title: "Box",
          sku: "BOX-1",
          barcode: "0123456789012",
          availableForSale: true,
          currentlyNotInStock: false,
          quantityAvailable: null,
          price: { amount: "19.50", currencyCode: "USD" },
        },
      ],
      pageInfo: page,
    },
  };
  const catalog = fixtureQuery(
    {
      Collections: { collections: { nodes: [], pageInfo: page } },
      Products: { products: { nodes: [], pageInfo: page } },
      ScannedProduct: { node: proof },
    },
    calls,
  );
  const admin = fixtureQuery(
    {
      NorthsidePilotInstallation: installation,
      NorthsidePilotWebhooks: {
        webhookSubscriptions: {
          nodes: pilotTopics.map((topic) => ({
            topic,
            uri: "https://pilot.example/api/shopify/webhooks",
            apiVersion: { handle: "2026-07" },
          })),
          pageInfo: page,
        },
      },
    },
    calls,
  );
  const report = await inspectCommercePilot(owner, id, {
    catalog: () => catalog,
    admin: async () => admin,
    origin: () => "https://pilot.example",
  });
  assert.equal(report.catalog.state, "observed");
  if (report.catalog.state === "observed")
    assert.deepEqual(report.catalog.data.products.nodes, []);
  assert.equal(report.selectedProduct?.state, "observed");
  if (report.selectedProduct?.state === "observed") {
    assert.equal(
      report.selectedProduct.data.variants.nodes[0].quantityAvailable,
      null,
    );
    assert.equal(
      report.selectedProduct.data.variants.nodes[0].price.amount,
      "19.50",
    );
    assert.equal(report.selectedProduct.data.variants.nodes[0].sku, "BOX-1");
  }
  assert.equal(report.installation.state, "observed");
  assert.equal(report.webhooks.state, "observed");
  if (report.webhooks.state === "observed")
    assert.deepEqual(report.webhooks.data.missingTopics, []);
  assert.equal(report.purchasesEnabled, false);
  assert.equal(report.pickupEnabled, false);
  assert.equal(report.checkoutVerified, false);
  assert.equal(report.posVerified, false);
  assert.equal(calls.length, 5);
});

test("wrong shops fail closed and provider errors cannot leak credentials", async () => {
  const wrongShop = {
    ...installation,
    shop: { ...installation.shop, myshopifyDomain: "other.myshopify.com" },
  };
  await assert.rejects(
    inspectInstallation(
      fixtureQuery({ NorthsidePilotInstallation: wrongShop }, []),
    ),
    /shopify_shop_mismatch/,
  );
  const secret = "sensitive-provider-error-not-for-browser";
  const fail = () => {
    throw Error(secret);
  };
  const report = await inspectCommercePilot(owner, undefined, {
    catalog: fail,
    admin: async () => fail(),
    origin: fail,
  });
  assert.equal(report.catalog.state, "unavailable");
  assert.equal(report.installation.state, "unavailable");
  assert.equal(report.webhooks.state, "unavailable");
  assert.ok(!JSON.stringify(report).includes(secret));
});

test("webhook inspection rejects URL/version lookalikes and redacts callback credentials", async () => {
  const query = fixtureQuery(
    {
      NorthsidePilotWebhooks: {
        webhookSubscriptions: {
          nodes: [
            {
              topic: "ORDERS_PAID",
              uri: "https://pilot.example.evil/api/shopify/webhooks",
              apiVersion: { handle: "2026-07" },
            },
            {
              topic: "ORDERS_CANCELLED",
              uri: "https://pilot.example/api/shopify/webhooks?token=never-render-this",
              apiVersion: { handle: "2026-07" },
            },
            {
              topic: "ORDERS_UPDATED",
              uri: "https://pilot.example/api/shopify/webhooks",
              apiVersion: { handle: "2026-10" },
            },
          ],
          pageInfo: { hasNextPage: true },
        },
      },
    },
    [],
  );
  const result = await inspectWebhookSubscriptions(
    query,
    "https://pilot.example",
  );
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingTopics, [...pilotTopics]);
  assert.ok(!JSON.stringify(result).includes("never-render-this"));
  assert.ok(!JSON.stringify(result).includes("evil"));
});

test("unknown or unpublished product proof never falls back to a fixture", async () => {
  const calls: string[] = [];
  const query = fixtureQuery(
    {
      Collections: { collections: { nodes: [], pageInfo: page } },
      Products: { products: { nodes: [], pageInfo: page } },
      ScannedProduct: { node: null },
    },
    calls,
  );
  const report = await inspectCommercePilot(
    owner,
    "gid://shopify/Product/999",
    {
      catalog: () => query,
      admin: async () => {
        throw Error();
      },
      origin: () => "https://pilot.example",
    },
  );
  assert.equal(report.selectedProduct?.state, "unavailable");
  assert.ok(calls.every((query) => !query.includes("mutation")));
});
