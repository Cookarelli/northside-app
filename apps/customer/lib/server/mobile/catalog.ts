import "server-only";
import { storefront, type Query } from "../storefront";
import { commerceConfig, cents } from "../shopify-config";
import { AccessError } from "../security";
import { liveOnly } from "../providers";
import { transaction, type Sql } from "../db";
import { resolveScan, qrOrigin } from "../store";
import { parseScan, scanCandidates, type ScanResult } from "../../store";
import {
  catalogProductV1Schema,
  type CatalogProductV1,
} from "../../../../../packages/customer-contracts/src/catalog";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import {
  mobileCatalogSchema,
  mobileProductSchema,
  catalogInputSchema,
  type CatalogInput,
} from "../../../../../packages/customer-contracts/src/mvp";

// Read-only Storefront operations. No Admin, cart, reservation or inventory write surface.
const PAGE = "pageInfo {hasNextPage endCursor}";
const VARIANT =
  "id title sku barcode availableForSale currentlyNotInStock price {amount currencyCode}";
const FIELDS =
  "id handle title description productType publishedAt availableForSale featuredImage {url altText} priceRange {minVariantPrice {amount currencyCode}}";
function catalogDocument(name: string, includeArrivalTags = false) {
  return `query ${name}($handle:String!,$after:String,$filters:[ProductFilter!]){collection(handle:$handle){handle products(first:12,after:$after,filters:$filters){nodes{${FIELDS}${includeArrivalTags ? " tags" : ""} collections(first:100){nodes{handle} pageInfo{hasNextPage}} variants(first:1){nodes{${VARIANT}} ${PAGE}}} filters{id values{label input}} ${PAGE}}}}`;
}
export const MOBILE_CATALOG_QUERY = catalogDocument("MobileApprovedCatalog");
// Only this opt-in feed needs unauthenticated_read_product_tags. Existing
// catalog, releases, detail and scanner queries keep their original scopes.
export const MOBILE_SINGLES_QUERY = catalogDocument(
  "MobileSinglesNewArrivals",
  true,
);
export const MOBILE_PRODUCT_QUERY = `query MobileApprovedProduct($handle:String!,$after:String){product(handle:$handle){${FIELDS} collections(first:100){nodes{handle} pageInfo{hasNextPage}} variants(first:100,after:$after){nodes{${VARIANT}} ${PAGE}}}}`;
type RawVariant = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  currentlyNotInStock: boolean;
  price: { amount: string; currencyCode: string };
};
type RawProduct = {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  tags?: string[];
  publishedAt: string;
  availableForSale: boolean;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: {
    nodes: RawVariant[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  collections?: {
    nodes: { handle: string }[];
    pageInfo: { hasNextPage: boolean };
  };
};
type RawPage = {
  collection: {
    handle: string;
    products: {
      nodes: RawProduct[];
      filters: { id: string; values: { label: string; input: string }[] }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
};
export function approvedCollection() {
  liveOnly();
  commerceConfig();
  const value = process.env.NORTHSIDE_MOBILE_APPROVED_COLLECTION;
  if (!value || !/^[a-z0-9-]{1,150}$/.test(value))
    throw new AccessError(503, "not_configured");
  return value;
}
function observed() {
  const now = Date.now();
  return {
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  };
}
export function projectCatalogProduct(
  raw: RawProduct,
  after?: string,
  selected?: string,
): CatalogProductV1 {
  if (
    !raw.publishedAt ||
    !Number.isFinite(Date.parse(raw.publishedAt)) ||
    Date.parse(raw.publishedAt) > Date.now()
  )
    throw new AccessError(404, "not_found");
  const text = (v: string | null) => (v?.trim() ? v : null);
  return catalogProductV1Schema.parse({
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    description: raw.description,
    productType: raw.productType,
    publication: "published",
    availableForSale: raw.availableForSale,
    featuredImage: raw.featuredImage,
    minVariantPrice: {
      amountCents: cents(raw.priceRange.minVariantPrice),
      currencyCode: raw.priceRange.minVariantPrice.currencyCode,
    },
    variants: {
      after: after ?? null,
      pageInfo: raw.variants.pageInfo,
      nodes: raw.variants.nodes.map((v) => ({
        id: v.id,
        productId: raw.id,
        title: v.title,
        identifiers: {
          state: "observed",
          sku: text(v.sku),
          barcode: text(v.barcode),
        },
        price: {
          amountCents: cents(v.price),
          currencyCode: v.price.currencyCode,
        },
        availability: {
          state:
            !v.availableForSale || v.currentlyNotInStock
              ? "unavailable"
              : "unknown",
          availableForSale: v.availableForSale,
          currentlyNotInStock: v.currentlyNotInStock,
          quantityAvailable: null,
        },
      })),
    },
    selectedVariantId: selected ?? null,
    productPath: "/shop/" + raw.handle,
    onlineStoreUrl: null,
  });
}
export async function readCatalog(
  input: CatalogInput,
  query: Query = storefront(),
  approval = approvedCollection(),
  requiredApproval?: string,
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = catalogInputSchema.safeParse(input);
  if (!parsed.success) throw new AccessError(400, "invalid_request");
  input = parsed.data;
  let source = approval;
  let singles: string | undefined;
  if (input.feed === "singles-new-arrivals") {
    source = env.NORTHSIDE_MOBILE_NEW_ARRIVALS_COLLECTION ?? "";
    singles = env.NORTHSIDE_MOBILE_SINGLES_COLLECTION;
    if (
      !/^[a-z0-9-]{1,150}$/.test(source) ||
      !singles ||
      !/^[a-z0-9-]{1,150}$/.test(singles)
    )
      throw new AccessError(503, "not_configured");
    requiredApproval = approval;
  }
  let after = input.after;
  const seen = new Set<string>();
  if (after) seen.add(after);
  let page: RawPage["collection"] = null;
  let products: CatalogProductV1[] = [];
  // Bounded search within the approved collection; never widen to all shop products.
  for (let count = 0; count < 8; count++) {
    const result = await query<RawPage>(
      singles ? MOBILE_SINGLES_QUERY : MOBILE_CATALOG_QUERY,
      {
        handle: source,
        after,
        filters: input.category ? [{ productType: input.category }] : [],
      },
    );
    page = result.collection;
    if (!page || page.handle !== source)
      throw new AccessError(503, "not_configured");
    // Validate progress even for nonempty pages; repeated provider cursors must
    // not trap customers on the same products or conceal a changed selection.
    const next = page.products.pageInfo.endCursor;
    if (page.products.pageInfo.hasNextPage && (!next || seen.has(next)))
      throw new AccessError(503, "invalid_provider_data");
    products = page.products.nodes
      .filter(
        (p) =>
          !requiredApproval ||
          p.collections?.nodes.some((c) => c.handle === requiredApproval),
      )
      .filter(
        (p) =>
          !singles ||
          (p.collections?.nodes.some((c) => c.handle === singles) &&
            Array.isArray(p.tags) &&
            p.tags.includes("ns:merchandising:new-arrival-verified")),
      )
      .filter(
        (p) =>
          !input.q ||
          [p.title, p.description, p.productType]
            .join(" ")
            .toLocaleLowerCase("en-US")
            .includes(input.q.toLocaleLowerCase("en-US")),
      )
      .map((p) => projectCatalogProduct(p));
    if (products.length || !page.products.pageInfo.hasNextPage) break;
    seen.add(next!);
    after = next!;
  }
  const categories: string[] = [];
  for (const filter of page!.products.filters ?? []) {
    if (filter.id !== "filter.p.product_type") continue;
    for (const value of filter.values) {
      try {
        const parsed = JSON.parse(value.input) as { productType?: unknown };
        if (
          typeof parsed.productType === "string" &&
          parsed.productType === value.label
        )
          categories.push(value.label);
      } catch {
        throw new AccessError(503, "invalid_provider_data");
      }
    }
  }
  return mobileCatalogSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "catalog",
    products,
    pageInfo: page!.products.pageInfo,
    categories: requiredApproval
      ? [
          ...new Set(
            products.map((product) => product.productType).filter(Boolean),
          ),
        ]
      : [...new Set(categories)],
    ...observed(),
  });
}
export async function readReleases() {
  const approval = approvedCollection(),
    collection = process.env.NORTHSIDE_MOBILE_RELEASE_COLLECTION;
  if (!collection || !/^[a-z0-9-]{1,150}$/.test(collection))
    throw new AccessError(503, "not_configured");
  return readCatalog({}, storefront(), collection, approval);
}
export async function readProduct(
  handle: string,
  after?: string,
  selected?: string,
  query: Query = storefront(),
  approval = approvedCollection(),
) {
  const raw = (
    await query<{ product: RawProduct | null }>(MOBILE_PRODUCT_QUERY, {
      handle,
      after,
    })
  ).product;
  if (
    !raw ||
    raw.handle !== handle ||
    !raw.collections?.nodes.some((c) => c.handle === approval)
  )
    throw new AccessError(404, "not_found");
  // Missing membership on a truncated collection page is never treated as approval.
  return mobileProductSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "product-detail",
    product: projectCatalogProduct(raw, after, selected),
    ...observed(),
  });
}
export { scanCandidates } from "../../store";
type NativeMatch = { result: ScanResult; barcode: string | null };
export async function nativeScanTargetOn(
  db: Sql,
  code: string,
  origin = qrOrigin("live"),
): Promise<NativeMatch | null> {
  let parsed;
  try {
    parsed = parseScan(code, origin);
  } catch {
    throw new AccessError(400, "invalid_request");
  }
  const targets = (
    await db.query("select * from ns.store_public_target($1,$2,$3)", [
      parsed.kind,
      parsed.value,
      false,
    ])
  ).rows;
  if (targets.length > 1) throw new AccessError(409, "invalid_provider_data");
  if (!targets.length) return null;
  // Once a mapping exists, a failed or changed proof cannot be hidden by an alternate code.
  return {
    result: await resolveScan(db, code, "live"),
    barcode: parsed.kind === "barcode" ? parsed.value : null,
  };
}
export async function resolveNativeCandidates(
  code: string,
  format: string | undefined,
  resolve: (candidate: string) => Promise<NativeMatch | null>,
) {
  const results = await Promise.allSettled(
    scanCandidates(code, format).map(resolve),
  );
  const found: NativeMatch[] = [];
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    if (result.value) found.push(result.value);
  }
  const identities = new Set(
    found.map(
      (match) =>
        match.result.product.product_id +
        "/" +
        (match.result.selected_variant ?? ""),
    ),
  );
  if (identities.size !== 1) throw new AccessError(404, "not_found");
  return found[0];
}
export function verifyScanProduct(
  match: NativeMatch,
  product: CatalogProductV1,
) {
  const resolved = match.result;
  if (product.id !== resolved.product.product_id)
    throw new AccessError(404, "not_found");
  for (const mapping of resolved.product.variants) {
    const current = product.variants.nodes.find(
      (v) => v.id === mapping.variant_id,
    );
    if (current && current.identifiers.sku !== mapping.sku)
      throw new AccessError(409, "invalid_provider_data");
  }
  if (resolved.selected_variant) {
    const selected = product.variants.nodes.find(
      (v) => v.id === resolved.selected_variant,
    );
    if (
      !selected ||
      (match.barcode !== null && selected.identifiers.barcode !== match.barcode)
    )
      throw new AccessError(409, "invalid_provider_data");
    product.selectedVariantId = selected.id;
  } else if (match.barcode !== null)
    throw new AccessError(409, "invalid_provider_data");
}
export async function readScannedProduct(code: string, format?: string) {
  const approval = approvedCollection();
  if (process.env.NORTHSIDE_MOBILE_SCAN_READS_APPROVED !== "true")
    throw new AccessError(503, "not_configured");
  const match = await resolveNativeCandidates(code, format, (candidate) =>
    transaction("runtime", (db) => nativeScanTargetOn(db, candidate)),
  );
  const result = await readProduct(
    match.result.product.handle,
    undefined,
    undefined,
    storefront(),
    approval,
  );
  verifyScanProduct(match, result.product);
  return mobileProductSchema.parse(result);
}
