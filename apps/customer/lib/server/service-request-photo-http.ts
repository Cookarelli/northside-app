import "server-only";
import { type Actor, type Sql } from "./db";
import { privateRequest } from "./http";
import {
  AccessError,
  errorResponse,
  privateHeaders,
  sameOrigin,
  uuid,
} from "./security";
import type { PhotoStore } from "./exam-storage";
import { localRequestPhotoStore } from "./service-request-photo-local";
import { photoBytes } from "./exam-storage";
import { uploadRequestPhoto, readRequestPhoto } from "./service-request-photos";
import { cardFileResponse } from "./card-files";
export async function requestPhotoAction(
  request: Request,
  db: Sql,
  actor: Actor,
  store?: PhotoStore,
) {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const allowed =
    request.method === "POST" ? ["request_id", "photo_id"] : ["photo_id"];
  if (url.pathname.startsWith("/api/preview/")) allowed.push("actor");
  if (
    new Set(keys).size !== keys.length ||
    keys.some((k) => !allowed.includes(k))
  )
    throw new AccessError(400, "invalid_request");
  const id = uuid(url.searchParams.get("photo_id") ?? "");
  if (request.method === "GET")
    return cardFileResponse(await readRequestPhoto(db, actor, id, store));
  if (request.method !== "POST")
    throw new AccessError(405, "method_not_allowed");
  const submission = uuid(url.searchParams.get("request_id") ?? "");
  return Response.json(
    await uploadRequestPhoto(
      db,
      actor,
      submission,
      id,
      await photoBytes(request),
      request.headers.get("content-type") ?? "",
      store,
    ),
    { headers: privateHeaders() },
  );
}
export async function requestPhotoHttp(request: Request, fixture = false) {
  try {
    if (fixture)
      return await (
        await import("./grading-preview")
      ).previewTransaction(request, (db, a) =>
        requestPhotoAction(request, db, a, localRequestPhotoStore()),
      );
    if (request.method !== "GET") sameOrigin(request);
    return await privateRequest((db, a) => requestPhotoAction(request, db, a));
  } catch (e) {
    return errorResponse(e);
  }
}
