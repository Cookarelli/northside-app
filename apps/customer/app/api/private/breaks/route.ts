import { privateRoute } from "@/lib/server/http";
import { breakApi } from "@/lib/server/break-api";
export const runtime = "nodejs";
export function GET(request: Request) {
  return privateRoute(request, (db, a) => breakApi(request, db, a));
}
export const POST = GET;
