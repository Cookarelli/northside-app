import "server-only";
import { withSession, type Sql, type Actor, requireCustomer } from "../db";
import { nativeParent } from "./service";
import { AccessError, privateHeaders, uuid } from "../security";
import {
  trackingList,
  trackingDetail,
  acceptServiceTerms,
  trackingService,
} from "../card-tracking";
import { authorizedExamPhoto, verifyStoredPhoto } from "../exam";
import { examPhotoStore } from "../exam-storage";
import { readCardFile } from "../card-files";
import { consignmentDetail } from "../consignment";
import type { TrackingService } from "../../../../../packages/customer-contracts/src/tracking";
export async function withNativeTracking<T>(
  token: string,
  fn: (db: Sql, a: Actor) => Promise<T>,
) {
  const context = await nativeParent(token);
  return withSession(context.parent.parentToken, async (db, a) => {
    if (
      a.customer_id !== context.parent.customerId ||
      a.staff_id !== null ||
      a.staff_role !== null
    )
      throw new AccessError(401, "unauthorized");
    requireCustomer(a);
    return fn(db, a);
  });
}
export function readNativeTracking(
  token: string,
  service: TrackingService,
  id?: string,
) {
  return withNativeTracking(token, async (db, a) =>
    id
      ? await trackingDetail(db, a, service, uuid(id))
      : await trackingList(db, a, service),
  );
}
export function acceptNativeTerms(token: string, b: unknown) {
  if (!b || typeof b !== "object" || Array.isArray(b))
    throw new AccessError(400, "invalid_request");
  return withNativeTracking(token, (db, a) =>
    acceptServiceTerms(db, a, b as Record<string, unknown>),
  );
}
export async function trackingPhoto(
  db: Sql,
  a: Actor,
  serviceValue: unknown,
  id: string,
  photoId: string,
) {
  requireCustomer(a);
  const service = trackingService(serviceValue);
  uuid(id);
  uuid(photoId);
  if (service === "grading") {
    const photo = await authorizedExamPhoto(db, a, id, photoId);
    return {
      bytes: await verifyStoredPhoto(photo, examPhotoStore(false)),
      mime: "image/jpeg",
    };
  }
  const detail = await consignmentDetail(db, a, id);
  if (
    !detail.files.some(
      (p) => p.id === photoId && /^image\/(jpeg|png|webp)$/.test(p.mime_type),
    )
  )
    throw new AccessError(404, "photo_not_found");
  const photo = await readCardFile(db, a, photoId);
  if (photo.cardId !== detail.item.card_id)
    throw new AccessError(404, "photo_not_found");
  return photo;
}
export async function readNativeTrackingPhoto(
  token: string,
  service: TrackingService,
  id: string,
  photo: string,
) {
  return withNativeTracking(token, async (db, a) => {
    const file = await trackingPhoto(db, a, service, id, photo);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        ...privateHeaders(),
        Vary: "Authorization",
        "Content-Type": file.mime,
        "Content-Disposition": 'inline; filename="northside-card.jpg"',
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
