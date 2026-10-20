import { transaction } from "@/lib/server/db";
import { visitor, metric } from "@/lib/server/measurement";
import { hashToken } from "@/lib/server/security";
import { CAMPAIGN_COOKIE } from "@/lib/server/campaigns";
import { validateBreakCart } from "@/lib/server/break-commerce";
import { cookies } from "next/headers";
import { publicFlags } from "@/lib/policy.mjs";
import {
  storefront,
  addLine,
  updateLine,
  checkout,
  cartView,
  readCart,
  cartCampaigns,
} from "@/lib/server/storefront";
import { withCart, CART_COOKIE } from "@/lib/server/cart-session";
import {
  sameOrigin,
  errorResponse,
  AccessError,
  privateHeaders,
  cookieOptions,
} from "@/lib/server/security";
import { buyerIP, commerceConfig } from "@/lib/server/shopify-config";
import { jsonBody } from "@/lib/server/http";
import { eligibleTouches } from "@/lib/server/campaigns";
import { cartInput } from "@/lib/server/cart-input";
function purchaseGate() {
  if (!publicFlags.purchases) throw new AccessError(503, "purchases_disabled");
  commerceConfig();
}
export async function GET(request: Request) {
  try {
    purchaseGate();
    const query = storefront(buyerIP(request.headers));
    const cart = await withCart(query, { create: false, bind: false }, (id) =>
      readCart(query, id),
    );
    return Response.json(cartView(cart), { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    purchaseGate();
    const body = cartInput(await jsonBody(request));
    if (body.action === "reset") {
      (await cookies()).set(CART_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      return Response.json({ reset: true }, { headers: privateHeaders() });
    }
    const query = storefront(buyerIP(request.headers));
    if (body.action === "checkout") {
      const touches = await eligibleTouches();
      const url = await withCart(
        query,
        { create: false, bind: true },
        async (id, token, db) => {
          const current = await readCart(query, id);
          await validateBreakCart(
            db,
            current.lines.nodes.map((l) => ({
              variantId: l.merchandise.id,
              quantity: l.quantity,
            })),
            !!token,
          );
          await cartCampaigns(query, id, touches?.first_ref, touches?.last_ref);
          return checkout(query, id, token);
        },
      );
      const campaignToken = (await cookies()).get(CAMPAIGN_COOKIE)?.value;
      if (campaignToken)
        await transaction("engagement", async (db) => {
          await metric(
            db,
            await visitor(db, campaignToken),
            "checkout_initiation",
            hashToken(url),
          );
        }).catch(() => {
          /* Analytics availability must not block checkout. */
        });
      return Response.json({ checkoutUrl: url }, { headers: privateHeaders() });
    }
    if (body.action !== "add" && body.action !== "update")
      throw new AccessError(400, "invalid_cart_action");
    const cart = await withCart(
      query,
      { create: body.action === "add", bind: true },
      async (id, token, db) => {
        if (body.action === "update" && body.quantity === 0)
          return updateLine(query, id, body.lineId, 0);
        const current = cartView(await readCart(query, id));
        const proposed = current.lines.nodes.map((l) => ({
          variantId: l.merchandise.id,
          quantity:
            body.action === "update" && l.id === body.lineId
              ? body.quantity
              : l.quantity,
        }));
        if (body.action === "add")
          proposed.push({ variantId: body.variantId, quantity: body.quantity });
        await validateBreakCart(db, proposed, !!token);
        return body.action === "add"
          ? addLine(query, id, body.variantId, body.quantity)
          : updateLine(query, id, body.lineId, body.quantity);
      },
    );
    return Response.json(cartView(cart), { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
