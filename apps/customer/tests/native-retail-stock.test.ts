import test from "node:test";
import assert from "node:assert/strict";
import { nativeRetailQuantity } from "../lib/server/mobile/approved-native-catalog";
import { NORTHSIDE_NATIVE_SELECTION } from "../../../packages/customer-contracts/src/native-scan";
import type { Query } from "../lib/server/storefront";

const p = NORTHSIDE_NATIVE_SELECTION[0];
function payload() {
  return {
    productVariant: {
      id: p.variantId,
      product: { id: p.id, status: "ACTIVE" },
      inventoryItem: {
        tracked: true,
        sku: "SYNTHETIC-SKU",
        inventoryLevels: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              location: {
                id: "gid://shopify/Location/121087263089",
                name: "Northside Retail Floor",
                isActive: true,
              },
              quantities: [{ name: "available", quantity: 2 }],
            },
            {
              location: {
                id: "gid://shopify/Location/121202770289",
                name: "Northside Breaker Storage",
                isActive: true,
              },
              quantities: [{ name: "available", quantity: 100 }],
            },
          ],
        },
      },
    },
  };
}
function query(data: ReturnType<typeof payload>): Query {
  return async <T>() => structuredClone(data) as T;
}
test("retail proof uses only the approved Floor location, never summed backstock", async () => {
  assert.equal(
    await nativeRetailQuantity(p.variantId, "SYNTHETIC-SKU", query(payload())),
    2,
  );
});
test("retail proof rejects truncated levels, wrong product/SKU, inactive Floor and duplicate levels", async () => {
  for (const mutate of [
    (x: ReturnType<typeof payload>) => {
      x.productVariant.product.id = "gid://shopify/Product/999";
    },
    (x: ReturnType<typeof payload>) => {
      x.productVariant.inventoryItem.sku = "WRONG";
    },
    (x: ReturnType<typeof payload>) => {
      x.productVariant.inventoryItem.inventoryLevels.pageInfo.hasNextPage = true;
    },
    (x: ReturnType<typeof payload>) => {
      x.productVariant.inventoryItem.inventoryLevels.nodes[0].location.isActive = false;
    },
    (x: ReturnType<typeof payload>) => {
      x.productVariant.inventoryItem.inventoryLevels.nodes.push(
        x.productVariant.inventoryItem.inventoryLevels.nodes[0],
      );
    },
  ]) {
    const x = payload();
    mutate(x);
    await assert.rejects(
      nativeRetailQuantity(p.variantId, "SYNTHETIC-SKU", query(x)),
      /invalid_provider_data/,
    );
  }
});
