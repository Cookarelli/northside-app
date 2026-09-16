import { commerceConfig, required } from "@/lib/server/shopify-config";
import { rawBody, verifyDelivery, receiveOn } from "@/lib/server/order-jobs";
import { transaction } from "@/lib/server/db";
import { errorResponse, privateHeaders } from "@/lib/server/security";
export async function POST(request: Request) {
  try {
    commerceConfig();
    const event = verifyDelivery(
      await rawBody(request),
      request.headers,
      required("SHOPIFY_APP_CLIENT_SECRET"),
    );
    await transaction("commerce", (db) => receiveOn(db, event));
    return Response.json({ received: true }, { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
