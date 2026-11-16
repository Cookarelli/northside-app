import { z } from "zod";
import { MOBILE_CONTRACT_VERSION } from "./mobile";
import {
  catalogProductV1Schema,
  catalogPageInfoV1Schema,
  catalogMoneyV1Schema,
} from "./catalog";
const label = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !!v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
const base = { contractVersion: z.literal(MOBILE_CONTRACT_VERSION) };
const stamp = z.iso.datetime({ precision: 3 });
export const publicLinkSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      !u.search
    );
  });
export const catalogInputSchema = z.strictObject({
  q: label(100).optional(),
  category: label(80).optional(),
  after: label(1500).optional(),
  feed: z.literal("singles-new-arrivals").optional(),
});
export const scanInputSchema = z.strictObject({
  code: label(2048),
  format: z
    .enum(["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"])
    .optional(),
});
export const mobileCatalogSchema = z.strictObject({
  ...base,
  kind: z.literal("catalog"),
  products: z.array(catalogProductV1Schema).max(12),
  pageInfo: catalogPageInfoV1Schema,
  categories: z.array(label(80)).max(100),
  observedAt: stamp,
  expiresAt: stamp,
});
export const mobileProductSchema = z.strictObject({
  ...base,
  kind: z.literal("product-detail"),
  product: catalogProductV1Schema,
  observedAt: stamp,
  expiresAt: stamp,
});
// A barcode may identify active merchandise unavailable through this storefront.
export const activeItemScanSchema = z.strictObject({
  ...base,
  kind: z.literal("active-item"),
  product: z.strictObject({
    id: catalogProductV1Schema.shape.id,
    title: label(255),
    selectedVariantId: catalogProductV1Schema.shape.selectedVariantId.unwrap(),
    variantTitle: label(255),
    barcode: label(255),
    price: catalogMoneyV1Schema,
  }),
  observedAt: stamp,
  expiresAt: stamp,
});
export const mobileScanSchema = z.discriminatedUnion("kind", [
  mobileProductSchema,
  activeItemScanSchema,
]);
export type MobileScan = z.infer<typeof mobileScanSchema>;

export const publicEventSchema = z.strictObject({
  id: z.uuid(),
  title: label(255),
  description: z.string().max(5000),
  startsAt: stamp.nullable(),
  location: label(500).nullable(),
});
export const mobileInfoSchema = z.strictObject({
  ...base,
  kind: z.literal("customer-info"),
  store: z.strictObject({
    name: z.literal("Northside Collectibles"),
    website: publicLinkSchema,
    address: label(500).nullable(),
    hours: z.array(label(200)).max(14),
    phone: label(40).nullable(),
  }),
  links: z.strictObject({
    privacy: publicLinkSchema.nullable(),
    deletion: publicLinkSchema.nullable(),
    support: publicLinkSchema.nullable(),
  }),
  events: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ready"),
      items: z.array(publicEventSchema).max(10),
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
  scanLookupConfigured: z.boolean(),
});
export const mobileWalletSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...base,
    kind: z.literal("wallet"),
    status: z.literal("unavailable"),
    reason: z.enum(["not_launched", "not_enrolled", "disconnected"]),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("wallet"),
    status: z.literal("ready"),
    balance: z.number().int().safe(),
    held: z.number().int().min(0).safe(),
    available: z.number().int().min(0).safe(),
    tier: label(100).nullable(),
    rewards: z
      .array(
        z.strictObject({
          id: z.uuid(),
          title: label(255),
          pointsCost: z.number().int().min(0).safe(),
        }),
      )
      .max(100),
    observedAt: stamp,
  }),
]);
export const mobileBreaksSchema = z.strictObject({
  ...base,
  kind: z.literal("customer-breaks"),
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: label(255),
        status: label(100),
        source: z.enum(["shopify", "legacy"]),
        quantity: z.number().int().min(0).max(100000),
      }),
    )
    .max(100),
});
export type MobileCatalog = z.infer<typeof mobileCatalogSchema>;
export type MobileProduct = z.infer<typeof mobileProductSchema>;
export type MobileInfo = z.infer<typeof mobileInfoSchema>;
export type MobileWallet = z.infer<typeof mobileWalletSchema>;
export type MobileBreaks = z.infer<typeof mobileBreaksSchema>;
export type CatalogInput = z.infer<typeof catalogInputSchema>;
export const deletionInputSchema = z.strictObject({
  confirmation: z.literal("DELETE MY ACCOUNT"),
});
export const mobileDeletionSchema = z.strictObject({
  ...base,
  kind: z.literal("deletion-request"),
  request: z
    .strictObject({
      id: z.uuid(),
      status: z.enum(["requested", "processing", "completed", "rejected"]),
      createdAt: stamp,
    })
    .nullable(),
});
export type MobileDeletion = z.infer<typeof mobileDeletionSchema>;
/** Current observations are deliberately short lived; no offline price/stock fallback. */
export function currentObservation(
  value: { observedAt: string; expiresAt: string },
  now = Date.now(),
) {
  const observed = Date.parse(value.observedAt),
    expires = Date.parse(value.expiresAt);
  return (
    Number.isFinite(observed) &&
    Number.isFinite(expires) &&
    observed <= now + 5000 &&
    expires > now &&
    expires > observed &&
    expires - observed <= 60000
  );
}
