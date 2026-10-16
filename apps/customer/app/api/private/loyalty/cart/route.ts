import { publicFlags } from "@/lib/policy.mjs";
import { privateRequest, jsonBody } from "@/lib/server/http";
import {
  sameOrigin,
  errorResponse,
  privateHeaders,
  AccessError,
} from "@/lib/server/security";
import { uuid } from "@/lib/server/loyalty";
import { requireCustomer } from "@/lib/server/db";
import { storefront, applyDiscount } from "@/lib/server/storefront";
import { withCart } from "@/lib/server/cart-session";
import { buyerIP } from "@/lib/server/shopify-config";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!publicFlags.purchases || !publicFlags.loyaltyRedemption)
      throw new AccessError(503, "reward_checkout_not_launched");
    const input = await jsonBody(request);
    if (Object.keys(input).some((k) => k !== "voucher_id"))
      throw new AccessError(400, "only_voucher_id_accepted");
    const code = await privateRequest(async (db, a) => {
      requireCustomer(a);
      const r = (
        await db.query<{ code: string }>(
          "select code from ns.shopify_vouchers where tenant_id=$1 and customer_id=$2 and id=$3 and status='issued' and (snapshot->>'ends_at')::timestamptz>now()",
          [a.tenant_id, a.customer_id, uuid(input.voucher_id)],
        )
      ).rows[0];
      if (!r) throw new AccessError(404, "owned_active_voucher_required");
      return r.code;
    });
    const query = storefront(buyerIP(request.headers));
    const result = await withCart(
      query,
      { create: false, bind: true },
      (id, token) => applyDiscount(query, id, code, token || ""),
    );
    return Response.json(result, { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
