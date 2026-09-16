import { fixturesAllowed } from "@/lib/policy.mjs";
import {
  AccessError,
  errorResponse,
  privateHeaders,
} from "@/lib/server/security";
import { gradingApi } from "@/lib/server/grading-api";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
    const { previewTransaction } = await import("@/lib/server/grading-preview");
    return Response.json(
      await previewTransaction(request, (db, actor) =>
        gradingApi(request, db, actor, true),
      ),
      { headers: privateHeaders() },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
