import { fixturesAllowed } from "@/lib/policy.mjs";
import {
  AccessError,
  errorResponse,
  privateHeaders,
} from "@/lib/server/security";
import { consignmentApi } from "@/lib/server/consignment-api";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
    const { consignmentPreviewTransaction } =
      await import("@/lib/server/consignment-preview");
    return Response.json(
      await consignmentPreviewTransaction(request, (db, a) =>
        consignmentApi(request, db, a, true),
      ),
      { headers: privateHeaders() },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
