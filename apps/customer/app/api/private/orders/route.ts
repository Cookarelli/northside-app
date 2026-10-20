import { privateRoute } from "@/lib/server/http";
import { ownedOrders } from "@/lib/server/customer-commerce";
export async function GET(request: Request) {
  return privateRoute(request, ownedOrders);
}
