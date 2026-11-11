import { z } from "zod";
import { catalogImageV1Schema } from "./catalog";
import { MOBILE_CONTRACT_VERSION, mobileErrorCodeSchema } from "./mobile";
import { scanInputSchema } from "./mvp";

export const SHOPPING_SESSION_HEADER = "X-Northside-Shopping-Session";
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const version = z.number().int().min(1).safe();
const cents = z.number().int().min(0).safe();
const productId = z
  .string()
  .regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,29}$/);
const variantId = z
  .string()
  .regex(/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,29}$/);
const label = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => !!v.trim() && !/[\u0000-\u001f\u007f]/.test(v));

/** Requests cannot assert price, identity, payment or inventory changes. */
export const shoppingActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("read") }),
  z.strictObject({
    action: z.literal("add"),
    version,
    code: scanInputSchema.shape.code,
    format: scanInputSchema.shape.format,
    variantId,
    reviewedPriceCents: cents,
  }),
  z.strictObject({
    action: z.literal("set"),
    version,
    variantId,
    quantity: z.number().int().min(0).max(99),
  }),
  z.strictObject({ action: z.literal("ready"), version }),
  z.strictObject({ action: z.literal("cancel"), version }),
]);
export const shoppingLineSchema = z.strictObject({
  variantId,
  productId,
  title: label,
  variantTitle: label,
  image: catalogImageV1Schema.nullable(),
  quantity: z.number().int().min(1).max(99),
  priceCents: cents,
});
export const shoppingCartSchema = z
  .strictObject({
    version,
    sample: z.boolean(),
    phase: z.enum(["shopping", "ready_for_staff"]),
    lines: z.array(shoppingLineSchema).max(50),
    subtotalCents: cents,
    currency: z.literal("USD"),
    paymentStatus: z.literal("unpaid"),
    handoff: z
      .strictObject({
        reference: token,
        expiresAt: z.number().int().positive().safe(),
      })
      .nullable(),
  })
  .superRefine((cart, ctx) => {
    const ids = cart.lines.map((line) => line.variantId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "duplicate_variant",
      });
    const subtotal = cart.lines.reduce(
      (sum, line) => sum + line.quantity * line.priceCents,
      0,
    );
    if (!Number.isSafeInteger(subtotal) || subtotal !== cart.subtotalCents)
      ctx.addIssue({
        code: "custom",
        path: ["subtotalCents"],
        message: "subtotal_mismatch",
      });
    if (
      (cart.phase === "ready_for_staff") !== (cart.handoff !== null) ||
      (cart.handoff !== null && !cart.lines.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["handoff"],
        message: "handoff_phase_mismatch",
      });
  });
export const shoppingResponseSchema = z
  .strictObject({
    contractVersion: z.literal(MOBILE_CONTRACT_VERSION),
    kind: z.literal("shopping"),
    cart: shoppingCartSchema,
    sessionToken: token.optional(),
    qr: z
      .string()
      .max(100000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .superRefine((response, ctx) => {
    if (response.qr && !response.cart.handoff)
      ctx.addIssue({
        code: "custom",
        path: ["qr"],
        message: "qr_requires_handoff",
      });
  });
export const shoppingErrorCodeSchema = z.enum([
  ...mobileErrorCodeSchema.options,
  "shopping_session_expired",
  "shopping_capacity_reached",
  "cart_owner_mismatch",
  "cart_mode_mismatch",
  "cart_changed_reload",
  "cancel_handoff_before_editing",
  "scanned_variant_mismatch",
  "missing_or_unverified_variant",
  "quantity_unavailable",
  "scan_price_changed_review_required",
  "invalid_quantity",
  "cart_line_limit",
  "cart_line_not_found",
  "cart_empty",
  "handoff_expired_cancel_and_retry",
]);
export const shoppingErrorSchema = z.strictObject({
  contractVersion: z.literal(MOBILE_CONTRACT_VERSION),
  kind: z.literal("error"),
  error: z.strictObject({ code: shoppingErrorCodeSchema }),
  requestId: z.uuid(),
});
export type ShoppingAction = z.infer<typeof shoppingActionSchema>;
export type ShoppingLine = z.infer<typeof shoppingLineSchema>;
export type ShoppingCart = z.infer<typeof shoppingCartSchema>;
export type ShoppingResponse = z.infer<typeof shoppingResponseSchema>;
export type ShoppingErrorCode = z.infer<typeof shoppingErrorCodeSchema>;
