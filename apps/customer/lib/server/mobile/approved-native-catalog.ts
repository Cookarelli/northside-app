import "server-only";
import {
  NORTHSIDE_NATIVE_SELECTION,
  matchCatalogScan,
} from "../../../../../packages/customer-contracts/src/native-scan";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import { mobileProductSchema } from "../../../../../packages/customer-contracts/src/mvp";
import { storefront, type Query } from "../storefront";
import { projectCatalogProduct } from "./catalog";
import { AccessError } from "../security";
import { adminQuery } from "../admin-shopify";

export const NATIVE_PRODUCTS_QUERY = `query NativeApprovedScanProducts($ids:[ID!]!) {
  nodes(ids:$ids) { ... on Product {
    id handle title description productType publishedAt availableForSale
    featuredImage {url altText} priceRange {minVariantPrice {amount currencyCode}}
    variants(first:2) {nodes {id title sku barcode availableForSale currentlyNotInStock price {amount currencyCode}} pageInfo {hasNextPage endCursor}}
  } }
}`;
async function nativeCatalogRecords(query: Query = storefront()) {
  type Raw = Parameters<typeof projectCatalogProduct>[0];
  const result = await query<{ nodes: (Raw | null)[] }>(NATIVE_PRODUCTS_QUERY, {
    ids: NORTHSIDE_NATIVE_SELECTION.map((p) => p.id),
  });
  if (
    !Array.isArray(result.nodes) ||
    result.nodes.length !== NORTHSIDE_NATIVE_SELECTION.length
  )
    throw new AccessError(503, "invalid_provider_data");
  return result.nodes.flatMap((p, i) => {
    if (!p) return [];
    const expected = NORTHSIDE_NATIVE_SELECTION[i];
    if (
      p.id !== expected.id ||
      p.handle !== expected.handle ||
      p.variants?.pageInfo?.hasNextPage !== false ||
      p.variants.nodes.length !== 1 ||
      p.variants.nodes[0].id !== expected.variantId
    )
      throw new AccessError(503, "invalid_provider_data");
    return [
      {
        product: projectCatalogProduct(p),
        verified: p.variants.nodes[0].barcode === expected.barcode,
      },
    ];
  });
}
export async function approvedNativeProducts(query?: Query) {
  return (await nativeCatalogRecords(query))
    .filter((record) => record.verified)
    .map((record) => record.product);
}
export async function approvedNativeScan(
  code: string,
  format?: string,
  query?: Query,
) {
  const records = await nativeCatalogRecords(query);
  let product;
  try {
    // Include quarantined records in matching so their live barcode claims
    // still reject collisions. Only the uniquely matched, verified record is usable.
    product = matchCatalogScan(
      records.map((record) => record.product),
      code,
      format,
    );
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "not_found",
        "invalid_request",
        "unsupported_qr",
        "ambiguous_scan",
      ].includes(error.message)
        ? error.message
        : "invalid_provider_data";
    throw new AccessError(code === "not_found" ? 404 : 400, code);
  }
  if (
    !records.some(
      (record) => record.verified && record.product.id === product.id,
    )
  )
    throw new AccessError(503, "invalid_provider_data");
  const now = Date.now();
  return mobileProductSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "product-detail",
    product,
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  });
}

export const NATIVE_RETAIL_STOCK_QUERY = `query NativeRetailStock($id:ID!) {
  productVariant(id:$id) { id product {id status} inventoryItem {tracked sku inventoryLevels(first:50) {
    nodes {location {id name isActive} quantities(names:["available"]) {name quantity}} pageInfo {hasNextPage}
  }} }
}`;
/** Admin-only location proof. Never return backstock, raw levels or totals to a phone. */
export async function nativeRetailQuantity(
  variantId: string,
  sku: string | null,
  query?: Query,
) {
  const expected = NORTHSIDE_NATIVE_SELECTION.find(
    (p) => p.variantId === variantId,
  );
  if (!expected) throw new AccessError(409, "missing_or_unverified_variant");
  const result = await (query ?? (await adminQuery()))<{
    productVariant: {
      id: string;
      product: { id: string; status: string };
      inventoryItem: {
        tracked: boolean;
        sku: string | null;
        inventoryLevels: {
          nodes: {
            location: { id: string; name: string; isActive: boolean };
            quantities: { name: string; quantity: number }[];
          }[];
          pageInfo: { hasNextPage: boolean };
        };
      };
    } | null;
  }>(NATIVE_RETAIL_STOCK_QUERY, { id: variantId });
  const v = result.productVariant;
  if (
    !v ||
    v.id !== variantId ||
    v.product.id !== expected.id ||
    v.product.status !== "ACTIVE" ||
    !v.inventoryItem.tracked ||
    v.inventoryItem.sku !== sku ||
    v.inventoryItem.inventoryLevels.pageInfo.hasNextPage
  )
    throw new AccessError(503, "invalid_provider_data");
  const levels = v.inventoryItem.inventoryLevels.nodes.filter(
    (l) => l.location.id === "gid://shopify/Location/121087263089",
  );
  if (
    levels.length !== 1 ||
    !levels[0].location.isActive ||
    levels[0].location.name !== "Northside Retail Floor"
  )
    throw new AccessError(503, "invalid_provider_data");
  const counts = levels[0].quantities.filter((q) => q.name === "available");
  if (counts.length !== 1 || !Number.isSafeInteger(counts[0].quantity))
    throw new AccessError(503, "invalid_provider_data");
  return Math.max(0, counts[0].quantity);
}
