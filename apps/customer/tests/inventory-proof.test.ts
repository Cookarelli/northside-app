import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryLocationMap,
  inspectVariantInventory,
} from "../lib/server/inventory-proof";
import { SHOP, TENANT } from "../lib/server/providers";
import { inventoryPools } from "../lib/store";
import type { Actor } from "../lib/server/db";
import type { Query } from "../lib/server/storefront";
const actor: Actor = {
  tenant_id: TENANT,
  staff_id: "owner",
  staff_role: "owner",
  customer_id: null,
};
const env = {
  SHOPIFY_RETAIL_LOCATION_ID: "gid://shopify/Location/1",
  SHOPIFY_BREAKER_LOCATION_ID: "gid://shopify/Location/2",
  SHOPIFY_EXCESS_LOCATION_ID: "gid://shopify/Location/3",
};
const id = "gid://shopify/ProductVariant/1";
const published = {
  id,
  sku: "SKU-1",
  barcode: "0123456789",
  product: { id: "gid://shopify/Product/1" },
  price: { amount: "10.00", currencyCode: "USD" },
  availableForSale: true,
  currentlyNotInStock: false,
  quantityAvailable: 11,
};
function readers(
  options: {
    scopes?: string[];
    unpublished?: boolean;
    wrongId?: boolean;
    barcode?: string;
    partial?: boolean;
    wrongLocation?: boolean;
    inactive?: boolean;
    wrongShop?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const catalog: Query = async <T>(query: string) => {
    assert.match(query, /^query /);
    calls.push(query);
    return { node: options.unpublished ? null : published } as T;
  };
  const admin: Query = async <T>(query: string) => {
    assert.match(query, /^query /);
    calls.push(query);
    if (query.includes("NorthsidePilotInstallation"))
      return {
        shop: {
          myshopifyDomain: options.wrongShop ? "foreign.myshopify.com" : SHOP,
          plan: {},
        },
        currentAppInstallation: {
          id: "1",
          app: {},
          accessScopes: (
            options.scopes || [
              "read_products",
              "read_inventory",
              "read_locations",
            ]
          ).map((handle) => ({ handle })),
        },
      } as T;
    return {
      productVariant: {
        id: options.wrongId ? "gid://shopify/ProductVariant/2" : id,
        barcode: options.barcode ?? published.barcode,
        product: { ...published.product, status: "ACTIVE" },
        inventoryPolicy: "DENY",
        inventoryItem: {
          sku: published.sku,
          tracked: true,
          inventoryLevels: {
            pageInfo: { hasNextPage: !!options.partial },
            nodes: Object.values(inventoryPools).map((name, i) => ({
              location: {
                id: `gid://shopify/Location/${options.wrongLocation ? 4 : i + 1}`,
                name,
                isActive: !options.inactive,
              },
              quantities: [{ name: "available", quantity: [1, 3, 7][i] }],
            })),
          },
        },
      },
    } as T;
  };
  return { calls, catalog: () => catalog, admin: async () => admin };
}
test("requires distinct configured Shopify locations and does not infer mappings from a label alone", () => {
  assert.throws(() => inventoryLocationMap({}), /mapping_required/);
  assert.throws(
    () =>
      inventoryLocationMap({
        ...env,
        SHOPIFY_BREAKER_LOCATION_ID: env.SHOPIFY_RETAIL_LOCATION_ID,
      }),
    /mapping_required/,
  );
  assert.equal(
    inventoryLocationMap(env).retail,
    env.SHOPIFY_RETAIL_LOCATION_ID,
  );
});
test("read-only inventory proof crosschecks published variant identity and keeps the three pools separate", async () => {
  const dependencies = readers();
  const result = await inspectVariantInventory(actor, id, env, dependencies);
  assert.equal(result.variantId, id);
  assert.equal(result.barcodeReady, true);
  assert.equal(result.onlineQuantity, 11);
  assert.equal(result.pools[0].available, 1);
  assert.deepEqual(
    result.pools.map((p) => p.available),
    [1, 3, 7],
  );
  assert.equal(result.pickupVerified, false);
  assert.equal(dependencies.calls.length, 3);
});
test("customers, foreign tenants, missing scopes, unpublished variants and inconsistent inventory evidence fail closed", async () => {
  const forbidden = readers();
  await assert.rejects(
    inspectVariantInventory(
      { ...actor, staff_role: null, customer_id: "customer" },
      id,
      env,
      forbidden,
    ),
  );
  await assert.rejects(
    inspectVariantInventory(
      { ...actor, tenant_id: "other" },
      id,
      env,
      forbidden,
    ),
  );
  assert.equal(forbidden.calls.length, 0);
  for (const bad of [
    { scopes: ["read_orders"] },
    { unpublished: true },
    { wrongId: true },
    { barcode: "changed" },
    { partial: true },
    { wrongLocation: true },
    { inactive: true },
    { wrongShop: true },
  ])
    await assert.rejects(inspectVariantInventory(actor, id, env, readers(bad)));
});
