import { privateRoute } from "@/lib/server/http";
import { consignmentApi } from "@/lib/server/consignment-api";
export const runtime = "nodejs";
export const GET = (request: Request) =>
  privateRoute(request, (db, a) => consignmentApi(request, db, a));
export const POST = GET;
