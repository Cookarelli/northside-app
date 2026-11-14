import "server-only";
import { matchCatalogScan } from "../../../../../packages/customer-contracts/src/native-scan";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import {
  catalogInputSchema,
  mobileCatalogSchema,
  type CatalogInput,
  mobileProductSchema,
} from "../../../../../packages/customer-contracts/src/mvp";
import { storefront, type Query } from "../storefront";
import { projectCatalogProduct } from "./catalog";
import { AccessError } from "../security";
import { adminQuery } from "../admin-shopify";

// Shopify Storefront publication is the server-managed native catalog. Never
// populate these DTOs from Admin product records, including drafts.
const FIELDS = `id handle title description productType publishedAt availableForSale
  featuredImage {url altText} priceRange {minVariantPrice {amount currencyCode}}`;
const VARIANTS = `variants(first:100,after:$variantAfter) {nodes {
  id title sku barcode availableForSale currentlyNotInStock price {amount currencyCode}
} pageInfo {hasNextPage endCursor}}`;
export const NATIVE_PRODUCTS_QUERY = `query NativePublicScanProducts($after:String) {
  products(first:50,after:$after,sortKey:ID) {nodes {${FIELDS}
    variants(first:100) {nodes {id title sku barcode availableForSale currentlyNotInStock price {amount currencyCode}} pageInfo {hasNextPage endCursor}}
  } pageInfo {hasNextPage endCursor}}
}`;
export const NATIVE_VARIANTS_QUERY = `query NativePublicScanVariants($id:ID!,$variantAfter:String) {
  node(id:$id) {... on Product {${FIELDS} ${VARIANTS}}}
}`;
type Raw = Parameters<typeof projectCatalogProduct>[0];
type Page = { hasNextPage: boolean; endCursor: string | null };
function nextPage(page: Page, seen: Set<string>) {
  if (!page || typeof page.hasNextPage !== "boolean")
    throw new AccessError(503, "invalid_provider_data");
  if (!page.hasNextPage) return null;
  if (!page.endCursor || seen.has(page.endCursor))
    throw new AccessError(503, "invalid_provider_data");
  seen.add(page.endCursor);
  return page.endCursor;
}
async function nativeCatalogRecords(query: Query = storefront()) {
  const products = [],
    productIds = new Set<string>(),
    variantIds = new Set<string>(),
    cursors = new Set<string>();
  let after: string | null = null;
  // Bounds are defensive capacity limits, never a successful partial scan. An
  // incomplete traversal must not hide a conflicting barcode later in the feed.
  for (let page = 0; page < 100; page++) {
    const result = await query<{ products: { nodes: Raw[]; pageInfo: Page } }>(
      NATIVE_PRODUCTS_QUERY,
      { after },
    );
    if (!Array.isArray(result.products?.nodes))
      throw new AccessError(503, "invalid_provider_data");
    for (const initial of result.products.nodes) {
      if (!initial || productIds.has(initial.id) || productIds.size >= 5000)
        throw new AccessError(503, "invalid_provider_data");
      productIds.add(initial.id);
      let raw = initial,
        variantAfter: string | null = null;
      const variantCursors = new Set<string>();
      for (let variantPage = 0; variantPage < 25; variantPage++) {
        if (!Array.isArray(raw.variants?.nodes) || !raw.variants.nodes.length)
          throw new AccessError(503, "invalid_provider_data");
        for (const variant of raw.variants.nodes) {
          if (variantIds.has(variant.id) || variantIds.size >= 50000)
            throw new AccessError(503, "invalid_provider_data");
          variantIds.add(variant.id);
        }
        products.push(projectCatalogProduct(raw, variantAfter ?? undefined));
        const next = nextPage(raw.variants.pageInfo, variantCursors);
        if (!next) break;
        if (variantPage === 24)
          throw new AccessError(503, "invalid_provider_data");
        variantAfter = next;
        const continued = await query<{ node: Raw | null }>(
          NATIVE_VARIANTS_QUERY,
          { id: initial.id, variantAfter },
        );
        if (
          !continued.node ||
          continued.node.id !== initial.id ||
          continued.node.handle !== initial.handle
        )
          throw new AccessError(503, "invalid_provider_data");
        raw = continued.node;
      }
    }
    after = nextPage(result.products.pageInfo, cursors);
    if (!after) return products;
  }
  throw new AccessError(503, "invalid_provider_data");
}
export async function approvedNativeProducts(query?: Query) {
  return nativeCatalogRecords(query);
}
function observation() {
  const now = Date.now();
  return {
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  };
}
export async function readNativeCatalog(input: CatalogInput, query?: Query) {
  input = catalogInputSchema.parse(input);
  if (input.feed) throw new AccessError(503, "not_configured");
  const records = await nativeCatalogRecords(query);
  const products = records.filter((p) => p.variants.after === null);
  const terms = (input.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = products.filter(
    (p) =>
      (!input.category || p.productType === input.category) &&
      terms.every((t) =>
        [
          p.title,
          p.description,
          p.productType,
          ...records
            .filter((r) => r.id === p.id)
            .flatMap((r) =>
              r.variants.nodes.flatMap((v) => [
                v.identifiers.sku,
                v.identifiers.barcode,
              ]),
            ),
        ]
          .join(" ")
          .toLowerCase()
          .includes(t),
      ),
  );
  const offset = input.after
    ? filtered.findIndex((p) => `native:${p.id}` === input.after) + 1
    : 0;
  if (input.after && !offset) throw new AccessError(400, "invalid_request");
  const selected = filtered.slice(offset, offset + 12),
    hasNextPage = offset + selected.length < filtered.length;
  return mobileCatalogSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "catalog",
    products: selected,
    categories: [...new Set(products.map((p) => p.productType).filter(Boolean))]
      .sort()
      .slice(0, 100),
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage ? `native:${selected.at(-1)!.id}` : null,
    },
    ...observation(),
  });
}
export async function readNativeProduct(
  handle: string,
  after?: string,
  query?: Query,
) {
  const records = await nativeCatalogRecords(query);
  const product = records.find(
    (p) => p.handle === handle && p.variants.after === (after ?? null),
  );
  if (!product) throw new AccessError(404, "not_found");
  return mobileProductSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "product-detail",
    product,
    ...observation(),
  });
}
export async function approvedNativeScan(
  code: string,
  format?: string,
  query?: Query,
) {
  // Every published claim, including unavailable variants, participates before
  // eligibility checks. Sold-out duplicates cannot accidentally disambiguate.
  const records = await nativeCatalogRecords(query);
  let product;
  try {
    product = matchCatalogScan(records, code, format);
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
  return mobileProductSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "product-detail",
    product,
    ...observation(),
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
  productId: string,
  query?: Query,
) {
  if (
    !/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,29}$/.test(variantId) ||
    !/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,29}$/.test(productId)
  )
    throw new AccessError(409, "missing_or_unverified_variant");
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
    v.product.id !== productId ||
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
