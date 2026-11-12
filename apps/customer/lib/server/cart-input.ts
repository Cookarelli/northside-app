import "server-only";
import { AccessError } from "./security";
import { gid } from "./shopify-config";
import { quantity } from "./storefront";
import type { ScanCartInput } from "./scan-cart";
type CartInput =
  | { action: "reset" | "checkout" }
  | ({ action: "scan-add" } & ScanCartInput)
  | { action: "add"; variantId: string; quantity: number }
  | { action: "update"; lineId: string; quantity: number };
export function cartInput(value: unknown): CartInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccessError(400, "invalid_cart_input");
  const v = value as Record<string, unknown>;
  const keys =
    v.action === "scan-add"
      ? ["action", "code", "variantId", "quantity", "reviewedPriceCents"]
      : v.action === "add"
        ? ["action", "variantId", "quantity"]
        : v.action === "update"
          ? ["action", "lineId", "quantity"]
          : ["action"];
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw new AccessError(400, "unexpected_cart_input");
  if (v.action === "checkout" || v.action === "reset")
    return { action: v.action };
  if (v.action === "scan-add") {
    if (
      typeof v.code !== "string" ||
      !v.code.trim() ||
      v.code.length > 2048 ||
      /[\u0000-\u001f\u007f]/.test(v.code) ||
      !Number.isSafeInteger(v.reviewedPriceCents) ||
      (v.reviewedPriceCents as number) < 0
    )
      throw new AccessError(400, "invalid_scan_cart_input");
    return {
      action: "scan-add",
      code: v.code,
      variantId: gid(v.variantId, "ProductVariant"),
      quantity: quantity(v.quantity),
      reviewedPriceCents: v.reviewedPriceCents as number,
    };
  }
  if (v.action === "add")
    return {
      action: "add",
      variantId: gid(v.variantId, "ProductVariant"),
      quantity: quantity(v.quantity),
    };
  if (
    v.action === "update" &&
    typeof v.lineId === "string" &&
    /^[a-f0-9]{64}$/.test(v.lineId)
  )
    return {
      action: "update",
      lineId: v.lineId,
      quantity: quantity(v.quantity, true),
    };
  throw new AccessError(400, "invalid_cart_action");
}
