import { fixturesAllowed } from "@/lib/policy.mjs";
import {
  AccessError,
  errorResponse,
  privateHeaders,
} from "@/lib/server/security";
import { boundedJson } from "@/lib/server/grading-api";
import { loyaltyApi } from "@/lib/server/loyalty-api";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
    const { loyaltyPreview, processSampleRewards } =
      await import("@/lib/server/loyalty-preview");
    const { who, f } = await loyaltyPreview(request);
    if (request.method === "POST") {
      const b = await boundedJson(request.clone());
      if (b.action === "sample-process")
        return Response.json(
          await processSampleRewards(
            request,
            b.reservation_id as string | undefined,
            b.timeout === true,
          ),
          { headers: privateHeaders() },
        );
    }
    return Response.json(
      await f.run(who, (db, a) => loyaltyApi(request, db, a, "sample")),
      { headers: privateHeaders() },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
