import { privateRequest } from "@/lib/server/http";
import { sameOrigin, errorResponse } from "@/lib/server/security";
import { storeApi } from "@/lib/server/store-api";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (request.method !== "GET") sameOrigin(request);
    return await privateRequest((db, a) => storeApi(request, db, a));
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
