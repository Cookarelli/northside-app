import "server-only";
import {
  barcodeCandidates,
  isProductBarcode,
} from "../../../../../packages/customer-contracts/src/native-scan";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import {
  activeItemScanSchema,
  mobileProductSchema,
} from "../../../../../packages/customer-contracts/src/mvp";
import { adminQuery, type AdminScanDiagnostic } from "../admin-shopify";
import { cents } from "../shopify-config";
import { AccessError } from "../security";
import { storefront, type Query } from "../storefront";
import { projectCatalogProduct } from "./catalog";
import { approvedNativeScan } from "./approved-native-catalog";

const SCAN_VARIANTS = `query ActiveScanVariants($search:String!,$after:String) {
  shop {currencyCode}
  productVariants(first:25,query:$search,after:$after) {
    nodes {id title price product {id title status}
      barcodes(first:20) {nodes {value} pageInfo {hasNextPage}}}
    pageInfo {hasNextPage endCursor}
  }
}`;
const VISIBLE_VARIANT = `query NativeScannedVariant($id:ID!) {
  node(id:$id) {... on ProductVariant {
    id title sku barcode availableForSale currentlyNotInStock price {amount currencyCode}
    product {id handle title description productType publishedAt availableForSale
      featuredImage {url altText} priceRange {minVariantPrice {amount currencyCode}}}
  }}
}`;

type Claim = {
  id: string;
  title: string;
  price: string;
  product: { id: string; title: string; status: string };
  barcodes: { nodes: { value: string }[]; pageInfo: { hasNextPage: boolean } };
};
type ClaimsPage = {
  shop: { currencyCode: string };
  productVariants: {
    nodes: Claim[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};
type RawProduct = Parameters<typeof projectCatalogProduct>[0];
type StorefrontVariant = RawProduct["variants"]["nodes"][number] & {
  product: Omit<RawProduct, "variants">;
};

async function activeClaim(candidates: string[], query: Query) {
  const terms = candidates.map((value) => {
    const literal = value.replace(/(["\\:()])/g, "\\$1");
    return `barcode:"${literal}"`;
  });
  const search = `product_status:active AND (${terms.join(" OR ")})`;
  const seen = new Set<string>();
  let after: string | null = null;
  let match: { claim: Claim; barcode: string; currency: string } | undefined;
  do {
    const page: ClaimsPage = await query<ClaimsPage>(SCAN_VARIANTS, {
      search,
      after,
    });
    const { nodes, pageInfo } = page.productVariants;
    if (!Array.isArray(nodes) || typeof pageInfo?.hasNextPage !== "boolean")
      throw new AccessError(503, "invalid_provider_data");
    for (const claim of nodes) {
      if (claim.product.status !== "ACTIVE") continue;
      if (
        !Array.isArray(claim.barcodes?.nodes) ||
        claim.barcodes.pageInfo?.hasNextPage !== false
      )
        throw new AccessError(503, "invalid_provider_data");
      const barcode = candidates.find((value) =>
        claim.barcodes.nodes.some((b) => b.value === value),
      );
      if (!barcode) continue;
      if (match && match.claim.id !== claim.id)
        throw new AccessError(400, "ambiguous_scan");
      match = { claim, barcode, currency: page.shop.currencyCode };
    }
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
    if (!after || seen.has(after))
      throw new AccessError(503, "invalid_provider_data");
    seen.add(after);
  } while (after);
  if (!match) throw new AccessError(404, "not_found");
  return match;
}

export async function lookupActiveScan(
  code: string,
  format?: string,
  publicQuery?: Query,
  admin?: Query,
  observe?: AdminScanDiagnostic,
) {
  if (format === "qr" || /^https?:/i.test(code))
    return approvedNativeScan(code, format, publicQuery);
  if (!isProductBarcode(code)) throw new AccessError(400, "invalid_request");
  let candidates: string[];
  try {
    candidates = barcodeCandidates(code, format);
  } catch {
    throw new AccessError(400, "invalid_request");
  }
  const { claim, barcode, currency } = await activeClaim(
    candidates,
    admin ?? (await adminQuery("2026-10", observe)),
  );
  const { node } = await (publicQuery ?? storefront())<{
    node: StorefrontVariant | null;
  }>(VISIBLE_VARIANT, { id: claim.id });
  const now = Date.now();
  const envelope = {
    contractVersion: MOBILE_CONTRACT_VERSION,
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  };
  if (
    node &&
    (node.id !== claim.id ||
      node.product.id !== claim.product.id ||
      (node.barcode !== null &&
        !claim.barcodes.nodes.some((b) => b.value === node.barcode)))
  )
    throw new AccessError(503, "invalid_provider_data");
  const publishedAt = node?.product.publishedAt;
  if (
    node &&
    publishedAt !== null &&
    !Number.isFinite(Date.parse(publishedAt ?? ""))
  )
    throw new AccessError(503, "invalid_provider_data");
  if (!node || publishedAt === null || Date.parse(publishedAt!) > now) {
    return activeItemScanSchema.parse({
      ...envelope,
      kind: "active-item",
      product: {
        id: claim.product.id,
        title: claim.product.title,
        selectedVariantId: claim.id,
        variantTitle: claim.title,
        barcode,
        price: {
          amountCents: cents({ amount: claim.price, currencyCode: currency }),
          currencyCode: currency,
        },
      },
    });
  }
  // This projection describes the scanned variant. Price and app availability
  // come from Storefront; the exact matching barcode may be a Shopify alternate.
  const product = projectCatalogProduct(
    {
      ...node.product,
      variants: {
        nodes: [{ ...node, barcode }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    undefined,
    claim.id,
  );
  return mobileProductSchema.parse({
    ...envelope,
    kind: "product-detail",
    product,
  });
}

export async function lookupCartScan(
  code: string,
  format?: string,
  query?: Query,
  admin?: Query,
) {
  const result = await lookupActiveScan(code, format, query, admin);
  if (result.kind === "active-item")
    throw new AccessError(409, "quantity_unavailable");
  return result;
}
