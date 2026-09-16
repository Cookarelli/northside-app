import { privateRoute } from "@/lib/server/http";
import { loyaltyApi } from "@/lib/server/loyalty-api";
export const runtime = "nodejs";
export function GET(request: Request) {
  return privateRoute(request, (db, a) => loyaltyApi(request, db, a));
}
export const POST = GET;
