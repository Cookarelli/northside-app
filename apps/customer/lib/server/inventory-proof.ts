import "server-only";
import type { Actor } from "./db";
import { requireCheckoutTester } from "./checkout-test";
import { inspectInstallation } from "./commerce-pilot";
import { adminQuery } from "./admin-shopify";
import { storefront } from "./storefront";
import { gid, cents } from "./shopify-config";
import { AccessError } from "./security";
import { inventoryPools, type Pool } from "../store";
import type { Variant } from "../commerce";

export function inventoryLocationMap(
  env: Record<string, string | undefined> = process.env,
) {
  const map = Object.fromEntries(
    (Object.keys(inventoryPools) as Pool[]).map((pool) => [
      pool,
      env[`SHOPIFY_${pool.toUpperCase()}_LOCATION_ID`] || "",
    ]),
  ) as Record<Pool, string>;
  if (
    Object.values(map).some(
      (id) => !/^gid:\/\/shopify\/Location\/[1-9][0-9]*$/.test(id),
    ) ||
    new Set(Object.values(map)).size !== 3
  )
    throw new AccessError(503, "distinct_inventory_location_mapping_required");
  return map;
}

// Staff-only diagnostic. Never expose Admin-only merchandise or private stock
// pools to public catalog routes, and never sum pools into pickup availability.
export async function inspectVariantInventory(
  actor: Actor,
  id: string,
  env: Record<string, string | undefined> = process.env,
  dependencies = { catalog: storefront, admin: adminQuery },
) {
  requireCheckoutTester(actor);
  gid(id, "ProductVariant");
  const map = inventoryLocationMap(env);
  const admin = await dependencies.admin();
  const installed = await inspectInstallation(admin);
  if (
    ["read_products", "read_inventory", "read_locations"].some(
      (scope) => !installed.scopes.includes(scope),
    )
  )
    throw new AccessError(503, "inventory_read_permissions_required");
  type Published = Variant & {
    sku: string | null;
    barcode: string | null;
    product: { id: string };
  };
  const published = (
    await dependencies.catalog()<{ node: Published | null }>(
      "query PublishedInventoryVariant($id: ID!) { node(id:$id) { ... on ProductVariant { id sku barcode availableForSale currentlyNotInStock quantityAvailable price { amount currencyCode } product { id } } } }",
      { id },
    )
  ).node;
  if (!published || published.id !== id)
    throw new AccessError(404, "variant_not_published");
  cents(published.price);
  type Level = {
    location: { id: string; name: string; isActive: boolean };
    quantities: { name: string; quantity: number }[];
  };
  const actual = (
    await admin<{
      productVariant: {
        id: string;
        barcode: string | null;
        product: { id: string; status: string };
        inventoryPolicy: string;
        inventoryItem: {
          sku: string | null;
          tracked: boolean;
          inventoryLevels: {
            nodes: Level[];
            pageInfo: { hasNextPage: boolean };
          };
        };
      } | null;
    }>(
      `query VariantInventoryLocations($id: ID!) { productVariant(id:$id) {
      id barcode inventoryPolicy product { id status } inventoryItem { sku tracked inventoryLevels(first:100) {
        nodes { location { id name isActive } quantities(names:["available"]) { name quantity } } pageInfo { hasNextPage }
      } } } }`,
      { id },
    )
  ).productVariant;
  if (
    !actual ||
    actual.id !== id ||
    actual.product.id !== published.product.id ||
    actual.product.status !== "ACTIVE" ||
    actual.barcode !== published.barcode ||
    actual.inventoryItem.sku !== published.sku
  )
    throw new AccessError(409, "catalog_identity_mismatch");
  if (
    !actual.inventoryItem.tracked ||
    actual.inventoryItem.inventoryLevels.pageInfo.hasNextPage
  )
    throw new AccessError(409, "inventory_evidence_incomplete");
  const pools = (Object.keys(map) as Pool[]).map((pool) => {
    const matches = actual.inventoryItem.inventoryLevels.nodes.filter(
      (level) => level.location.id === map[pool],
    );
    const level = matches[0];
    const available = level?.quantities.filter((q) => q.name === "available");
    if (
      matches.length !== 1 ||
      !level.location.isActive ||
      level.location.name !== inventoryPools[pool] ||
      available?.length !== 1 ||
      !Number.isSafeInteger(available[0].quantity)
    )
      throw new AccessError(409, "inventory_location_not_verified");
    return {
      pool,
      locationId: map[pool],
      label: level.location.name,
      available: available[0].quantity,
    };
  });
  return {
    checkedAt: new Date().toISOString(),
    variantId: id,
    productId: published.product.id,
    sku: published.sku,
    barcode: published.barcode,
    barcodeReady: !!published.barcode,
    price: published.price,
    onlineAvailable: published.availableForSale,
    onlineQuantity: published.quantityAvailable,
    inventoryPolicy: actual.inventoryPolicy,
    pools,
    pickupVerified: false as const,
  };
}
