import { storeGate } from "@/lib/server/store";
import { AccessError, errorResponse } from "@/lib/server/security";
// Activation requires the checklist and a reviewed customer API, never a preview actor.
export async function GET(request: Request) {
  try {
    const feature = new URL(request.url).searchParams.get("feature");
    storeGate(
      feature === "aisles"
        ? "aisles"
        : feature === "pickup"
          ? "pickup"
          : "scanner",
    );
    throw new AccessError(503, "store_not_activated");
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
