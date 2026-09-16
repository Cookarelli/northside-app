import "server-only";
import { AccessError } from "./security";
import { gid } from "./shopify-config";
import { quantity } from "./storefront";
type CartInput =
  | { action: "reset" | "checkout" }
  | { action: "add"; variantId: string; quantity: number }
  | { action: "update"; lineId: string; quantity: number };
export function cartInput(value: unknown): CartInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccessError(400, "invalid_cart_input");
  const v = value as Record<string, unknown>;
  const keys =
    v.action === "add"
      ? ["action", "variantId", "quantity"]
      : v.action === "update"
        ? ["action", "lineId", "quantity"]
        : ["action"];
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw new AccessError(400, "unexpected_cart_input");
  if (v.action === "checkout" || v.action === "reset")
    return { action: v.action };
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
