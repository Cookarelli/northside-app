import { z } from "zod";

export const CATALOG_CONTRACT_VERSION = "northside.catalog.v1" as const;
export const CATALOG_SHOP = "9i3hnb-jw.myshopify.com" as const;
export const CATALOG_SHOPIFY_API_VERSION = "2026-07" as const;

const noControls = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const label = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(noControls)
    .refine((v) => !!v.trim());
const handle = z.string().regex(/^[a-z0-9-]{1,150}$/);
const productId = z
  .string()
  .regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,29}$/);
const variantId = z
  .string()
  .regex(/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,29}$/);
const cursor = z.string().min(1).max(1500).refine(noControls).nullable();
const timestamp = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}, "canonical_utc_timestamp_required");

function publicHttpsUrl(value: string, host: string): URL | null {
  try {
    if (value.length > 2048 || !noControls(value) || value !== value.trim())
      return null;
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === host &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.href === value
      ? url
      : null;
  } catch {
    return null;
  }
}

const imageUrl = z.string().refine((value) => {
  const url = publicHttpsUrl(value, "cdn.shopify.com");
  if (!url || !url.pathname.startsWith("/s/files/")) return false;
  const allowed = new Set(["v", "width", "height", "crop", "format"]);
  const seen = new Set<string>();
  for (const [key, item] of url.searchParams) {
    if (
      !allowed.has(key) ||
      seen.has(key) ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(item)
    )
      return false;
    seen.add(key);
  }
  return true;
}, "approved_public_shopify_image_required");

export const catalogMoneyV1Schema = z.strictObject({
  amountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currencyCode: z.literal("USD"),
});

export const catalogImageV1Schema = z.strictObject({
  url: imageUrl,
  altText: z.string().max(500).refine(noControls).nullable(),
});

export const catalogPageInfoV1Schema = z
  .strictObject({
    hasNextPage: z.boolean(),
    endCursor: cursor,
  })
  .superRefine((page, ctx) => {
    if (page.hasNextPage && page.endCursor === null)
      ctx.addIssue({
        code: "custom",
        path: ["endCursor"],
        message: "next_page_requires_cursor",
      });
  });

/** Current online browse/detail queries do not request SKU or barcode. */
export const catalogIdentifiersV1Schema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("not_provided"),
    sku: z.null(),
    barcode: z.null(),
  }),
  z.strictObject({
    state: z.literal("observed"),
    sku: label(255).nullable(),
    barcode: label(255).nullable(),
  }),
]);

/** Online availability, never proof of retail shelf stock or a reservation. */
export const catalogAvailabilityV1Schema = z
  .strictObject({
    state: z.enum(["in_stock", "unavailable", "unknown"]),
    availableForSale: z.boolean(),
    currentlyNotInStock: z.boolean(),
    quantityAvailable: z.number().int().min(0).max(2_147_483_647).nullable(),
  })
  .superRefine((value, ctx) => {
    const expected =
      !value.availableForSale ||
      value.currentlyNotInStock ||
      value.quantityAvailable === 0
        ? "unavailable"
        : value.quantityAvailable === null
          ? "unknown"
          : "in_stock";
    if (value.state !== expected)
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message: "availability_must_match_provider_evidence",
      });
  });

export const catalogVariantV1Schema = z.strictObject({
  id: variantId,
  productId,
  title: label(255),
  identifiers: catalogIdentifiersV1Schema,
  price: catalogMoneyV1Schema,
  availability: catalogAvailabilityV1Schema,
});

export const catalogProductV1Schema = z
  .strictObject({
    id: productId,
    handle,
    title: label(255),
    description: z
      .string()
      .max(20_000)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)),
    productType: z.string().max(80).refine(noControls),
    // A producer may assert this only after a trusted, published Storefront read.
    // This literal is a fail-closed contract guard, not cryptographic proof.
    publication: z.literal("published"),
    availableForSale: z.boolean(),
    featuredImage: catalogImageV1Schema.nullable(),
    minVariantPrice: catalogMoneyV1Schema,
    variants: z.strictObject({
      nodes: z.array(catalogVariantV1Schema).max(100),
      pageInfo: catalogPageInfoV1Schema,
      after: cursor,
    }),
    selectedVariantId: variantId.nullable(),
    productPath: z.string().max(156),
    // Null unless an approved provider read actually supplied this destination.
    onlineStoreUrl: z.string().nullable(),
  })
  .superRefine((product, ctx) => {
    if (
      !product.variants.nodes.length &&
      (product.variants.after === null ||
        product.variants.pageInfo.hasNextPage ||
        product.variants.pageInfo.endCursor !== null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: "empty_variants_require_exhausted_continuation",
      });
    if (
      !product.availableForSale &&
      product.variants.nodes.some((v) => v.availability.availableForSale)
    )
      ctx.addIssue({
        code: "custom",
        path: ["availableForSale"],
        message: "unavailable_product_cannot_have_sellable_variant",
      });
    if (product.productPath !== `/shop/${product.handle}`)
      ctx.addIssue({
        code: "custom",
        path: ["productPath"],
        message: "product_path_mismatch",
      });
    if (product.onlineStoreUrl !== null) {
      const url = publicHttpsUrl(product.onlineStoreUrl, CATALOG_SHOP);
      if (!url || url.pathname !== `/products/${product.handle}` || url.search)
        ctx.addIssue({
          code: "custom",
          path: ["onlineStoreUrl"],
          message: "unverified_product_destination",
        });
    }
    const ids = new Set<string>();
    for (const [index, variant] of product.variants.nodes.entries()) {
      if (variant.productId !== product.id || ids.has(variant.id))
        ctx.addIssue({
          code: "custom",
          path: ["variants", "nodes", index, "id"],
          message: "variant_parent_or_duplicate_mismatch",
        });
      ids.add(variant.id);
    }
    if (
      product.selectedVariantId !== null &&
      !ids.has(product.selectedVariantId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["selectedVariantId"],
        message: "selected_variant_not_in_returned_page",
      });
    // A variant page may be partial. Do not infer the product-wide minimum
    // price or aggregate availability from only that page.
  });

const source = z.strictObject({
  provider: z.literal("shopify_storefront"),
  shop: z.literal(CATALOG_SHOP),
  apiVersion: z.literal(CATALOG_SHOPIFY_API_VERSION),
});

const freshness = z
  .strictObject({ observedAt: timestamp, expiresAt: timestamp })
  .superRefine((value, ctx) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt))
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiry_must_follow_observation",
      });
  });

const collection = z.strictObject({ handle, title: label(255) });
const collections = z
  .strictObject({
    nodes: z.array(collection).max(12),
    pageInfo: catalogPageInfoV1Schema,
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.nodes.map((v) => v.handle)).size !== value.nodes.length ||
      (!value.nodes.length &&
        (value.pageInfo.hasNextPage || value.pageInfo.endCursor !== null))
    )
      ctx.addIssue({ code: "custom", message: "invalid_collection_page" });
  });

const base = { contractVersion: z.literal(CATALOG_CONTRACT_VERSION) };
const observed = { source, freshness };
const unavailable = {
  ...base,
  status: z.literal("unavailable"),
  code: z.enum([
    "not_found",
    "not_published",
    "provider_unavailable",
    "invalid_data",
    "unsupported_currency",
    "unsupported_api_version",
    "variant_mismatch",
  ]),
};
const stale = {
  ...base,
  status: z.literal("stale"),
  code: z.literal("refresh_required"),
};

export const catalogProductResponseV1Schema = z.discriminatedUnion("status", [
  z.strictObject({
    ...base,
    ...observed,
    kind: z.literal("product"),
    status: z.literal("ready"),
    product: catalogProductV1Schema,
  }),
  z.strictObject({ ...unavailable, kind: z.literal("product") }),
  z.strictObject({ ...stale, kind: z.literal("product") }),
]);

const readyPage = z
  .strictObject({
    ...base,
    ...observed,
    kind: z.literal("catalog-page"),
    status: z.literal("ready"),
    products: z.array(catalogProductV1Schema).min(1).max(12),
    pageInfo: catalogPageInfoV1Schema,
    collections,
  })
  .superRefine((page, ctx) => {
    const ids = new Set<string>();
    const handles = new Set<string>();
    const variants = new Set<string>();
    for (const [index, product] of page.products.entries()) {
      if (ids.has(product.id) || handles.has(product.handle))
        ctx.addIssue({
          code: "custom",
          path: ["products", index],
          message: "duplicate_product",
        });
      ids.add(product.id);
      handles.add(product.handle);
      for (const variant of product.variants.nodes) {
        if (variants.has(variant.id))
          ctx.addIssue({
            code: "custom",
            path: ["products", index, "variants"],
            message: "variant_reused_across_products",
          });
        variants.add(variant.id);
      }
    }
  });

export const catalogPageResponseV1Schema = z.discriminatedUnion("status", [
  readyPage,
  z.strictObject({
    ...base,
    ...observed,
    kind: z.literal("catalog-page"),
    status: z.literal("empty"),
    products: z.tuple([]),
    pageInfo: z.strictObject({
      hasNextPage: z.literal(false),
      endCursor: z.null(),
    }),
    collections,
  }),
  z.strictObject({ ...unavailable, kind: z.literal("catalog-page") }),
  z.strictObject({ ...stale, kind: z.literal("catalog-page") }),
]);

/** Structural wire validation only; use validateCatalogResponseV1 for freshness. */
export const catalogResponseV1Schema = z.union([
  catalogProductResponseV1Schema,
  catalogPageResponseV1Schema,
]);

export type CatalogMoneyV1 = z.infer<typeof catalogMoneyV1Schema>;
export type CatalogImageV1 = z.infer<typeof catalogImageV1Schema>;
export type CatalogPageInfoV1 = z.infer<typeof catalogPageInfoV1Schema>;
export type CatalogIdentifiersV1 = z.infer<typeof catalogIdentifiersV1Schema>;
export type CatalogAvailabilityV1 = z.infer<typeof catalogAvailabilityV1Schema>;
export type CatalogVariantV1 = z.infer<typeof catalogVariantV1Schema>;
export type CatalogProductV1 = z.infer<typeof catalogProductV1Schema>;
export type CatalogProductResponseV1 = z.infer<
  typeof catalogProductResponseV1Schema
>;
export type CatalogPageResponseV1 = z.infer<typeof catalogPageResponseV1Schema>;
export type CatalogResponseV1 = z.infer<typeof catalogResponseV1Schema>;

export type CatalogFreshnessPolicy = {
  nowMs: number;
  maxAgeMs: number;
};
export type CatalogValidationCode =
  | "invalid_payload"
  | "unsupported_contract_version"
  | "invalid_freshness_policy"
  | "future_snapshot"
  | "stale_snapshot";
export type CatalogValidationResult =
  | { success: true; data: CatalogResponseV1 }
  | { success: false; error: { code: CatalogValidationCode } };

/** Pure and portable: no network, env, storage, global clock or authorization. */
export function validateCatalogResponseV1(
  input: unknown,
  policy: CatalogFreshnessPolicy,
): CatalogValidationResult {
  const invalid = (code: CatalogValidationCode): CatalogValidationResult => ({
    success: false,
    error: { code },
  });
  if (
    !policy ||
    !Number.isSafeInteger(policy.nowMs) ||
    policy.nowMs < 0 ||
    policy.nowMs > 8_640_000_000_000_000 ||
    !Number.isSafeInteger(policy.maxAgeMs) ||
    policy.maxAgeMs <= 0
  )
    return invalid("invalid_freshness_policy");
  if (
    input !== null &&
    typeof input === "object" &&
    "contractVersion" in input &&
    input.contractVersion !== CATALOG_CONTRACT_VERSION
  )
    return invalid("unsupported_contract_version");
  const parsed = catalogResponseV1Schema.safeParse(input);
  if (!parsed.success) return invalid("invalid_payload");
  const data = parsed.data;
  if (data.status === "ready" || data.status === "empty") {
    const observedAt = Date.parse(data.freshness.observedAt);
    if (observedAt > policy.nowMs) return invalid("future_snapshot");
    if (
      policy.nowMs >= Date.parse(data.freshness.expiresAt) ||
      policy.nowMs - observedAt >= policy.maxAgeMs
    )
      return invalid("stale_snapshot");
  }
  // Never return Zod errors, unknown input properties or rejected product data.
  return { success: true, data };
}
