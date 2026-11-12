import { privateRoute, jsonBody } from "@/lib/server/http";
import { buyerIP } from "@/lib/server/shopify-config";
import {
  checkoutTestConfig,
  requireCheckoutTester,
  startTestCheckout,
} from "@/lib/server/checkout-test";

export async function POST(request: Request) {
  return privateRoute(request, async (_db, actor) => {
    requireCheckoutTester(actor);
    checkoutTestConfig();
    return startTestCheckout(
      actor,
      await jsonBody(request),
      buyerIP(request.headers),
    );
  });
}
