import { privateRoute } from "@/lib/server/http";
import { gradingApi } from "@/lib/server/grading-api";
export const runtime = "nodejs";
export const GET = (request: Request) =>
  privateRoute(request, (db, actor) => gradingApi(request, db, actor));
export const POST = GET;
