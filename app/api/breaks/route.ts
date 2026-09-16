import { transaction } from "@/lib/server/db";
import { publicBreaks } from "@/lib/server/breaks";
import { breakCalendar } from "@/lib/server/break-calendar";
import {
  errorResponse,
  privateHeaders,
  AccessError,
} from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const events = await transaction("runtime", (db) =>
      publicBreaks(db, "live", url.searchParams.get("id") || undefined),
    );
    if (url.searchParams.has("calendar")) {
      if (!events[0] || !url.searchParams.get("id"))
        throw new AccessError(404, "break_not_found");
      return new Response(breakCalendar(events[0]), {
        headers: {
          ...privateHeaders(),
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="northside-break.ics"',
        },
      });
    }
    return Response.json({ events }, { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
