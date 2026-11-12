import "server-only";
import type { ScanResult } from "../store";
import { AccessError } from "./security";
import { cents } from "./shopify-config";
import { addLine, readCart, type Query } from "./storefront";

export type ScanCartInput = {
  code: string;
  variantId: string;
  quantity: number;
  reviewedPriceCents: number;
};

// The route supplies a fresh, restricted-runtime registry lookup, never a
// browser-supplied ScanResult. The existing saved-cart lock surrounds this flow.
// No fixture fallback, URL fetch, inventory write or checkout is performed here.
export async function addScannedLine(
  query: Query,
  cartId: string,
  input: ScanCartInput,
  resolve: (code: string) => Promise<ScanResult>,
  validate: (lines: { variantId: string; quantity: number }[]) => Promise<void>,
) {
  const scan = await resolve(input.code);
  if (scan.product.fixture || scan.availability.source !== "shopify")
    throw new AccessError(409, "sample_cannot_enter_shopify_cart");
  if (scan.selected_variant && scan.selected_variant !== input.variantId)
    throw new AccessError(409, "scanned_variant_mismatch");
  const registered = scan.product.variants.find(
    (v) => v.variant_id === input.variantId,
  );
  const current = scan.availability.variants.find(
    (v) => v.id === input.variantId,
  );
  if (!registered || !current)
    throw new AccessError(409, "missing_or_unverified_variant");
  if (!registered.locations.length)
    throw new AccessError(409, "approved_retail_location_required");
  if (
    !current.available ||
    !Number.isSafeInteger(current.quantity) ||
    current.quantity === null ||
    current.quantity < input.quantity
  )
    throw new AccessError(409, "quantity_unavailable");
  // A review amount is a comparison only. Shopify remains the price authority.
  if (cents(current.price) !== input.reviewedPriceCents)
    throw new AccessError(409, "scan_price_changed_review_required");
  const cart = await readCart(query, cartId);
  await validate([
    ...cart.lines.nodes.map((line) => ({
      variantId: line.merchandise.id,
      quantity: line.quantity,
    })),
    { variantId: input.variantId, quantity: input.quantity },
  ]);
  // Existing addLine rechecks aggregate quantity, including split cart lines.
  return addLine(
    query,
    cartId,
    input.variantId,
    input.quantity,
    input.reviewedPriceCents,
  );
}
