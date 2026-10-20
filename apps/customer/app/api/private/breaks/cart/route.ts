import { publicFlags } from "@/lib/policy.mjs";
import { privateRequest, jsonBody } from "@/lib/server/http";
import {
  sameOrigin,
  errorResponse,
  AccessError,
  privateHeaders,
} from "@/lib/server/security";
import { requireCustomer } from "@/lib/server/db";
import { uuid, integer } from "@/lib/server/loyalty";
import { TENANT } from "@/lib/server/providers";
import { withCart } from "@/lib/server/cart-session";
import {
  storefront,
  readCart,
  addLine,
  cartView,
} from "@/lib/server/storefront";
import { buyerIP } from "@/lib/server/shopify-config";
import { validateBreakCart } from "@/lib/server/break-commerce";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!publicFlags.purchases)
      throw new AccessError(503, "purchases_disabled");
    const b = await jsonBody(request),
      id = uuid(b.mapping_id),
      quantity = integer(b.quantity, 1, 99);
    await privateRequest(async (_db, a) => requireCustomer(a));
    const query = storefront(buyerIP(request.headers));
    const cart = await withCart(
      query,
      { create: true, bind: true },
      async (cartId, token, db) => {
        const m = (
          await db.query<{ variant_id: string }>(
            "select variant_id from ns.shopify_spot_mappings where tenant_id=$1 and id=$2",
            [TENANT, id],
          )
        ).rows[0];
        if (!m) throw new AccessError(404, "spot_not_found");
        const current = await readCart(query, cartId);
        await validateBreakCart(
          db,
          [
            ...current.lines.nodes.map((l) => ({
              variantId: l.merchandise.id,
              quantity: l.quantity,
            })),
            { variantId: m.variant_id, quantity },
          ],
          !!token,
        );
        return addLine(query, cartId, m.variant_id, quantity);
      },
    );
    return Response.json(cartView(cart), { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
