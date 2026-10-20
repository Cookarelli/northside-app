import { showRead } from "@/lib/server/show-public";
import { approvedPlacement } from "@/lib/server/measurement";
import { campaignParams } from "@/lib/engagement";
import {
  AccessError,
  errorResponse,
  privateHeaders,
  appOrigin,
} from "@/lib/server/security";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  try {
    const { ref } = await params,
      result = await showRead(async (db, sample) => ({
        p: await approvedPlacement(db, ref, sample),
        sample,
      })),
      p = result.p;
    if (
      !p ||
      (p.brand === "hobby_key" &&
        !result.sample &&
        process.env.HOBBY_KEY_INTEREST_ENABLED !== "true")
    )
      throw new AccessError(404, "show_link_unavailable");
    const q = campaignParams(p);
    if (p.brand === "hobby_key") q.set("show", p.slug);
    const path =
      p.brand === "hobby_key"
        ? "/hobby-key/vendor-interest"
        : "/shows/" + p.slug;
    return new Response(null, {
      status: 302,
      headers: {
        ...privateHeaders(),
        Location:
          (result.sample
            ? `http://${request.headers.get("host")}`
            : appOrigin()) +
          path +
          "?" +
          q,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
