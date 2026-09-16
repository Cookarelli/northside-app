import {
  setMeasurementContext,
  measurementTokenFrom,
} from "@/lib/server/measurement";
import { fixturesAllowed } from "@/lib/policy.mjs";
import {
  errorResponse,
  privateHeaders,
  AccessError,
} from "@/lib/server/security";
import { publicBreaks } from "@/lib/server/breaks";
import { breakCalendar } from "@/lib/server/break-calendar";
import { breakApi } from "@/lib/server/break-api";
import { boundedJson } from "@/lib/server/grading-api";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
    const { breaksPreview, simulateBreak } =
      await import("@/lib/server/break-preview");
    const { who, f } = await breaksPreview(request),
      url = new URL(request.url);
    if (request.method === "POST") {
      const b = await boundedJson(request.clone());
      if (["sample-paid", "sample-refund"].includes(String(b.action)))
        return Response.json(
          await simulateBreak(request, String(b.action), Number(b.customer)),
          { headers: privateHeaders() },
        );
    }
    if (request.method === "GET" && url.searchParams.has("public")) {
      const events = await f.run(who, (db) =>
        publicBreaks(db, "sample", url.searchParams.get("id") || undefined),
      );
      if (url.searchParams.has("calendar")) {
        if (!events[0] || !url.searchParams.get("id"))
          throw new AccessError(404, "break_not_found");
        return new Response(breakCalendar(events[0]), {
          headers: {
            ...privateHeaders(),
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="SAMPLE-northside-break.ics"',
          },
        });
      }
      return Response.json({ events }, { headers: privateHeaders() });
    }
    return Response.json(
      await f.run(who, async (db, a) => {
        await setMeasurementContext(db, measurementTokenFrom(request, true));
        return breakApi(request, db, a, "sample");
      }),
      { headers: privateHeaders() },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const POST = GET;
