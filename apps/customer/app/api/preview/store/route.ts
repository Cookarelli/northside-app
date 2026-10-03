import { fixturesAllowed } from "@/lib/policy.mjs";
import { AccessError, errorResponse } from "@/lib/server/security";
import { storeApi } from "@/lib/server/store-api";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
    const { storePreview } = await import("@/lib/server/store-preview");
    const { who, f } = await storePreview(request);
    return await f.run(who, (db, a) => storeApi(request, db, a, "sample"));
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
