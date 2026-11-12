import "server-only";
import type { Actor, Sql } from "./db";
import { privateRequest } from "./http";
import {
  AccessError,
  errorResponse,
  privateHeaders,
  sameOrigin,
  uuid,
} from "./security";
import { fixturesAllowed } from "../policy.mjs";
import { boundedJson } from "./grading-api";
import {
  trackingCustomers,
  trackingService,
  trackingList,
  trackingDetail,
  serviceTermsState,
  publishServiceTerms,
  acceptServiceTerms,
} from "./card-tracking";

export async function cardTrackingAction(request: Request, db: Sql, a: Actor) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const keys = [...url.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some(
        (k) =>
          !["service", "id", "terms", "actor", "customers", "q"].includes(k),
      )
    )
      throw new AccessError(400, "invalid_request");
    if (url.searchParams.has("customers"))
      return trackingCustomers(db, a, url.searchParams.get("q"));
    const service = trackingService(url.searchParams.get("service"));
    if (url.searchParams.has("terms")) return serviceTermsState(db, a, service);
    return url.searchParams.has("id")
      ? trackingDetail(db, a, service, uuid(url.searchParams.get("id")!))
      : trackingList(db, a, service);
  }
  const b = await boundedJson(request);
  if (b.action === "publish-terms") {
    const { action: _, ...value } = b;
    void _;
    return publishServiceTerms(db, a, value);
  }
  if (b.action === "accept-terms") {
    const { action: _, ...value } = b;
    void _;
    return acceptServiceTerms(db, a, value);
  }
  throw new AccessError(400, "invalid_request");
}
export async function cardTrackingHttp(request: Request, fixture = false) {
  try {
    if (fixture && !fixturesAllowed(process.env))
      throw new AccessError(404, "not_found");
    if (!fixture && request.method !== "GET") sameOrigin(request);
    const run = async (db: Sql, a: Actor) =>
      Response.json(await cardTrackingAction(request, db, a), {
        headers: privateHeaders(),
      });
    if (fixture) {
      const { previewTransaction } = await import("./grading-preview");
      return await previewTransaction(request, run);
    }
    return await privateRequest(run);
  } catch (e) {
    return errorResponse(e);
  }
}
