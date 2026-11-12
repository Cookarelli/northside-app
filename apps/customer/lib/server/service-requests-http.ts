import "server-only";
import { type Actor, type Sql, transaction, requireRole } from "./db";
import { privateRequest } from "./http";
import { fixturesAllowed } from "../policy.mjs";
import {
  AccessError,
  errorResponse,
  hashToken,
  privateHeaders,
  sameOrigin,
} from "./security";
import { boundedJson } from "./grading-api";
import {
  requestConfig,
  submitRequest,
  listRequests,
  staffRequestData,
  updateRequest,
  requestClaim,
  reviewRequestClaim,
  convertRequest,
  drainRequestOutbox,
} from "./service-requests";

export async function serviceRequestAction(
  request: Request,
  db: Sql,
  a: Actor,
) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    if (u.searchParams.has("config")) return requestConfig(db, a);
    if (u.searchParams.has("staff")) return staffRequestData(db, a);
    return listRequests(db, a);
  }
  const b = await boundedJson(request);
  switch (b.action) {
    case "submit": {
      if (a.staff_id) {
        requireRole(a, ["owner", "admin", "operations"]);
        if ((b.input as { kind?: unknown } | null)?.kind !== "inquiry")
          throw new AccessError(
            403,
            "collector_must_accept_service_terms_from_their_own_form",
          );
        return submitRequest(
          db,
          a,
          b.input,
          "staff",
          hashToken("staff-inquiry:" + a.staff_id),
        );
      }
      return submitRequest(db, a, b.input, "customer_web");
    }
    case "update":
      return updateRequest(db, a, b);
    case "claim":
      return requestClaim(db, a, b);
    case "review-claim":
      return reviewRequestClaim(db, a, b);
    case "convert":
      return convertRequest(db, a, b);
    case "test-outbox":
      return drainRequestOutbox(db, a);
    default:
      throw new AccessError(400, "invalid_request_action");
  }
}
export async function serviceRequestHttp(request: Request, fixture = false) {
  try {
    if (fixture && !fixturesAllowed(process.env))
      throw new AccessError(404, "not_found");
    if (!fixture && request.method !== "GET") sameOrigin(request);
    const run = async (db: Sql, a: Actor) =>
      Response.json(await serviceRequestAction(request, db, a), {
        headers: privateHeaders(),
      });
    if (fixture)
      return (await import("./grading-preview")).previewTransaction(
        request,
        run,
      );
    return await privateRequest(run);
  } catch (e) {
    return errorResponse(e);
  }
}
export function serviceRequestOrigin(request: Request) {
  const origin =
    request.headers.get("origin") ??
    (request.method === "GET" ? new URL(request.url).origin : null);
  if (!origin) throw new AccessError(403, "approved_website_origin_required");
  const allowed = (process.env.SERVICE_REQUEST_ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter(Boolean);
  if (!allowed.length)
    throw new AccessError(503, "public_service_origin_not_configured");
  if (
    !allowed.includes(origin) ||
    new URL(origin).origin !== origin ||
    !origin.startsWith("https://")
  )
    throw new AccessError(403, "approved_website_origin_required");
  return origin;
}
export async function publicServiceRequestHttp(request: Request) {
  let origin: string | undefined;
  try {
    origin = serviceRequestOrigin(request);
    const headers = {
      ...privateHeaders(),
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    if (request.headers.has("authorization") || request.headers.has("cookie"))
      throw new AccessError(400, "guest_transport_required");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    const value = await transaction("runtime", async (db) => {
      if (request.method === "GET") return requestConfig(db, null);
      if (request.method !== "POST")
        throw new AccessError(405, "method_not_allowed");
      // Durable global per-origin ceiling. Spoofed IP headers cannot bypass it.
      return submitRequest(
        db,
        null,
        await boundedJson(request),
        new URL(request.url).origin === origin
          ? "customer_web"
          : "shopify_website",
        hashToken(origin!),
      );
    });
    return Response.json(value, { headers });
  } catch (e) {
    const result = errorResponse(e);
    if (origin) {
      result.headers.set("Access-Control-Allow-Origin", origin);
      result.headers.set("Vary", "Origin");
    }
    return result;
  }
}
