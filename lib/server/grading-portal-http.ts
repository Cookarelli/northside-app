import "server-only";
import { privateRequest } from "./http";
import {
  AccessError,
  privateHeaders,
  errorResponse,
  sameOrigin,
  uuid,
} from "./security";
import { fixturesAllowed } from "../policy.mjs";
import { boundedJson } from "./grading-api";
import {
  portalData,
  portalDetail,
  portalExport,
  recordPortalDecision,
} from "./grading-portal";
import { gradingReceipt } from "./grading-receipt";
import type { Sql, Actor } from "./db";
export async function gradingPortalHttp(request: Request, fixture: boolean) {
  try {
    if (fixture && !fixturesAllowed(process.env))
      throw new AccessError(404, "not_found");
    if (!fixture && request.method !== "GET") sameOrigin(request);
    const run = async (db: Sql, a: Actor) => {
      const url = new URL(request.url);
      if (request.method === "GET") {
        if (url.searchParams.has("receipt")) {
          const d = await portalDetail(
            db,
            a,
            uuid(url.searchParams.get("card") || ""),
          );
          return new Response(gradingReceipt(d.receipt, fixture), {
            headers: {
              ...privateHeaders(),
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy":
                "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        if (url.searchParams.has("export"))
          return new Response(await portalExport(db, a), {
            headers: {
              ...privateHeaders(),
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="northside-my-grading.csv"',
            },
          });
        const data = url.searchParams.has("card")
          ? await portalDetail(db, a, uuid(url.searchParams.get("card")!))
          : await portalData(db, a);
        return Response.json(
          { ...data, fixture },
          { headers: privateHeaders() },
        );
      }
      return Response.json(
        await recordPortalDecision(db, a, await boundedJson(request)),
        { headers: privateHeaders() },
      );
    };
    if (fixture) {
      const { previewTransaction } = await import("./grading-preview");
      return await previewTransaction(request, run);
    }
    return await privateRequest(run);
  } catch (e) {
    return errorResponse(e);
  }
}
