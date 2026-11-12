import "server-only";
import { liveOnly } from "../providers";
import { commerceConfig } from "../shopify-config";
import { AccessError } from "../security";

export function nativeScanCartSelected() {
  return process.env.NORTHSIDE_MOBILE_SCAN_CART_APPROVED === "true";
}
/** Separate opt-in for the requested six-product native staging workflow. No web/public gates are changed. */
export function nativeScanCartGate() {
  liveOnly();
  commerceConfig();
  if (
    !nativeScanCartSelected() ||
    process.env.NORTHSIDE_MOBILE_ENVIRONMENT !== "staging"
  )
    throw new AccessError(503, "not_configured");
}
