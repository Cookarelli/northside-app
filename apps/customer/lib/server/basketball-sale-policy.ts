import "server-only";
import { publicFlags } from "../policy.mjs";
import {
  approvedBasketballSale,
  variantPurchasesEnabled,
} from "../approved-basketball-sales";
import { AccessError } from "./security";
import { cents } from "./shopify-config";
import type { CartPolicy } from "./storefront";

function assertVariant(variantId: string) {
  if (!variantPurchasesEnabled(variantId))
    throw new AccessError(403, "variant_not_approved_for_sale");
}

// A client can request an ID or quantity, never an authorization or price.
export const basketballSalePolicy: CartPolicy = {
  assertVariant,
  reviewedPriceCents: (variantId) =>
    publicFlags.purchases
      ? undefined
      : approvedBasketballSale(variantId)?.priceCents,
  assertCart(cart) {
    for (const line of cart.lines.nodes) {
      assertVariant(line.merchandise.id);
      const approval = approvedBasketballSale(line.merchandise.id);
      if (
        !publicFlags.purchases &&
        approval &&
        cents(line.merchandise.price) !== approval.priceCents
      )
        throw new AccessError(409, "sale_price_changed_review_required");
    }
  },
};
