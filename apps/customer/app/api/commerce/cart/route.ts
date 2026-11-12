import { transaction } from "@/lib/server/db";
import { visitor, metric } from "@/lib/server/measurement";
import { hashToken } from "@/lib/server/security";
import { CAMPAIGN_COOKIE } from "@/lib/server/campaigns";
import { validateBreakCart } from "@/lib/server/break-commerce";
import { cookies } from "next/headers";
import { basketballCartEnabled } from "@/lib/approved-basketball-sales";
import { basketballSalePolicy } from "@/lib/server/basketball-sale-policy";
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
import { addScannedLine } from "@/lib/server/scan-cart";
import { resolveScan, storeGate } from "@/lib/server/store";
function purchaseGate() {
  if (!basketballCartEnabled) throw new AccessError(503, "purchases_disabled");
  commerceConfig();
}
export async function GET(request: Request) {
  try {
    purchaseGate();
    const query = storefront(buyerIP(request.headers));
    const cart = await withCart(
      query,
      {
        create: false,
        bind: false,
        salePolicy: basketballSalePolicy,
      },
      (id) => readCart(query, id, false, basketballSalePolicy),
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
    if (body.action === "add" || body.action === "scan-add")
      basketballSalePolicy.assertVariant(body.variantId);
    if (body.action === "scan-add") storeGate("scanner");
    if (body.action === "reset") {
      (await cookies()).set(CART_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      return Response.json({ reset: true }, { headers: privateHeaders() });
    }
    const query = storefront(buyerIP(request.headers));
    if (body.action === "checkout") {
      const touches = await eligibleTouches();
      const url = await withCart(
        query,
        { create: false, bind: true, salePolicy: basketballSalePolicy },
        async (id, token, db) => {
          const current = await readCart(
            query,
            id,
            false,
            basketballSalePolicy,
          );
          await validateBreakCart(
            db,
            current.lines.nodes.map((l) => ({
              variantId: l.merchandise.id,
              quantity: l.quantity,
            })),
            !!token,
          );
          await cartCampaigns(
            query,
            id,
            touches?.first_ref,
            touches?.last_ref,
            basketballSalePolicy,
          );
          return checkout(query, id, token, undefined, basketballSalePolicy);
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
    if (
      body.action !== "add" &&
      body.action !== "update" &&
      body.action !== "scan-add"
    )
      throw new AccessError(400, "invalid_cart_action");
    const cart = await withCart(
      query,
      {
        create: body.action === "add" || body.action === "scan-add",
        bind: true,
        salePolicy: basketballSalePolicy,
      },
      async (id, token, db) => {
        const current = cartView(
          await readCart(query, id, false, basketballSalePolicy),
        );
        if (body.action === "scan-add") {
          const cart = await addScannedLine(
            query,
            id,
            body,
            (code) =>
              transaction("runtime", (registry) =>
                resolveScan(registry, code, "live", query),
              ),
            (lines) => validateBreakCart(db, lines, !!token),
          );
          basketballSalePolicy.assertCart(cart);
          return cart;
        }
        if (body.action === "update" && body.quantity === 0)
          return updateLine(query, id, body.lineId, 0, basketballSalePolicy);
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
          ? addLine(
              query,
              id,
              body.variantId,
              body.quantity,
              undefined,
              basketballSalePolicy,
            )
          : updateLine(
              query,
              id,
              body.lineId,
              body.quantity,
              basketballSalePolicy,
            );
      },
    );
    return Response.json(cartView(cart), { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
