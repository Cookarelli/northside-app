import "server-only";
import type { Actor, Sql } from "./db";
import { requireCustomer, requireRole } from "./db";
import { AccessError, uuid } from "./security";
import { MAX_PHOTO_BYTES } from "../exam";
import { normalizePhoto, photoHash, type PhotoStore } from "./exam-storage";
import { supabase } from "./providers";

type RequestPhoto = {
  id: string;
  customer_id: string;
  submission_id: string;
  object_key: string;
  content_sha256: string;
  byte_length: number;
  ready: boolean;
};
type PhotoInput = { request_id: string; photo_ids?: readonly string[] };
const fields =
  "id,customer_id,submission_id,object_key,content_sha256,byte_length,ready";
const keyFor = (
  tenant: string,
  customer: string,
  submission: string,
  id: string,
) => `${tenant}/${customer}/requests/${submission}/${id}.jpg`;
const lockSubmission = (db: Sql, tenant: string, submission: string) =>
  db.query("select pg_advisory_xact_lock(hashtext($1))", [
    `${tenant}:request:${submission}`,
  ]);

function requestPhotoStore(): PhotoStore {
  const storage = supabase(true, 10000).storage.from("northside-private");
  return {
    async put(key, bytes) {
      const { error } = await storage.upload(key, bytes, {
        contentType: "image/jpeg",
        cacheControl: "0",
        upsert: false,
      });
      // Existing objects can be recovery after a lost response or SQL rollback.
      // The caller must read and hash the stored bytes before confirming them.
      if (error && !["400", "409"].includes(String(error.statusCode)))
        throw new AccessError(503, "request_photo_upload_unconfirmed_retry");
    },
    async read(key) {
      const { data, error } = await storage.download(key);
      if (error || !data || data.size > MAX_PHOTO_BYTES)
        throw new AccessError(503, "request_photo_storage_unavailable_retry");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
async function confirmedBytes(photo: RequestPhoto, store: PhotoStore) {
  let bytes: Uint8Array;
  try {
    bytes = await store.read(photo.object_key);
  } catch {
    throw new AccessError(503, "request_photo_storage_unavailable_retry");
  }
  if (
    bytes.length !== photo.byte_length ||
    bytes.length > MAX_PHOTO_BYTES ||
    photoHash(bytes) !== photo.content_sha256
  )
    throw new AccessError(503, "request_photo_storage_verification_failed");
  return bytes;
}

/** The caller supplies the existing authenticated runtime transaction. */
export async function uploadRequestPhoto(
  db: Sql,
  actor: Actor,
  submissionId: string,
  photoId: string,
  bytes: Uint8Array,
  mime: string,
  store?: PhotoStore,
): Promise<{ id: string }> {
  requireCustomer(actor);
  if (actor.staff_id) throw new AccessError(403, "customer_account_required");
  const submission = uuid(submissionId).toLowerCase(),
    id = uuid(photoId).toLowerCase(),
    customer = actor.customer_id!;
  const image = await normalizePhoto(bytes, mime);
  // Serialize the customer quota before the shared submission lock. Retried
  // identities remain recoverable even when the new-upload quota is exhausted.
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    `${actor.tenant_id}:request-photo-customer:${customer}`,
  ]);
  await lockSubmission(db, actor.tenant_id, submission);
  const old = (
    await db.query<RequestPhoto>(
      `select ${fields} from ns.service_request_photos where tenant_id=$1 and id=$2 for update`,
      [actor.tenant_id, id],
    )
  ).rows[0];
  const key = keyFor(actor.tenant_id, customer, submission, id);
  if (
    old &&
    (old.customer_id !== customer ||
      old.submission_id !== submission ||
      old.object_key !== key ||
      old.content_sha256 !== image.hash ||
      old.byte_length !== image.bytes.length)
  )
    throw new AccessError(409, "request_photo_conflict");
  if (!old) {
    const recent = (
      await db.query<{ n: number }>(
        "select count(*)::int as n from ns.service_request_photos where tenant_id=$1 and customer_id=$2 and created_at>=now()-interval '24 hours'",
        [actor.tenant_id, customer],
      )
    ).rows[0].n;
    if (recent >= 100) throw new AccessError(429, "upload_limit_reached");
    const submitted = await db.query(
      "select id from ns.service_requests where tenant_id=$1 and submission_id=$2",
      [actor.tenant_id, submission],
    );
    if (submitted.rows.length)
      throw new AccessError(409, "request_already_submitted");
    const count = (
      await db.query<{ n: number }>(
        "select count(*)::int as n from ns.service_request_photos where tenant_id=$1 and customer_id=$2 and submission_id=$3",
        [actor.tenant_id, customer, submission],
      )
    ).rows[0].n;
    if (count >= 10) throw new AccessError(400, "request_photo_limit_reached");
    try {
      await db.query(
        "insert into ns.service_request_photos(tenant_id,id,customer_id,submission_id,object_key,content_sha256,byte_length) values($1,$2,$3,$4,$5,$6,$7)",
        [
          actor.tenant_id,
          id,
          customer,
          submission,
          key,
          image.hash,
          image.bytes.length,
        ],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw new AccessError(409, "request_photo_conflict");
      throw e;
    }
  }
  const photo: RequestPhoto = old ?? {
    id,
    customer_id: customer,
    submission_id: submission,
    object_key: key,
    content_sha256: image.hash,
    byte_length: image.bytes.length,
    ready: false,
  };
  const storage = store ?? requestPhotoStore();
  if (!photo.ready) {
    try {
      await storage.put(key, image.bytes);
    } catch {
      throw new AccessError(503, "request_photo_upload_unconfirmed_retry");
    }
  }
  await confirmedBytes(photo, storage);
  if (!photo.ready) {
    const confirmed = await db.query<{ id: string }>(
      "update ns.service_request_photos set ready=true where tenant_id=$1 and id=$2 and customer_id=$3 and submission_id=$4 returning id",
      [actor.tenant_id, id, customer, submission],
    );
    if (!confirmed.rows.length)
      throw new AccessError(409, "request_photo_confirmation_failed");
  }
  return { id };
}

export async function readRequestPhoto(
  db: Sql,
  actor: Actor,
  id: string,
  store?: PhotoStore,
): Promise<{ bytes: Uint8Array; mime: "image/jpeg" }> {
  if (!actor.customer_id)
    requireRole(actor, ["owner", "admin", "operations", "read_only"]);
  const photo = (
    await db.query<RequestPhoto>(
      `select ${fields
        .split(",")
        .map((field) => "p." + field)
        .join(
          ",",
        )} from ns.service_request_photos p where p.tenant_id=$1 and p.id=$2 and p.ready ${
        actor.customer_id
          ? "and p.customer_id=$3"
          : "and exists(select from ns.service_requests r where r.tenant_id=p.tenant_id and r.submission_id=p.submission_id and r.submitted_customer_id=p.customer_id and r.details->'photo_ids' ? p.id::text)"
      }`,
      [
        actor.tenant_id,
        uuid(id).toLowerCase(),
        ...(actor.customer_id ? [actor.customer_id] : []),
      ],
    )
  ).rows[0];
  if (!photo) throw new AccessError(404, "request_photo_not_found");
  if (
    photo.object_key !==
    keyFor(actor.tenant_id, photo.customer_id, photo.submission_id, photo.id)
  )
    throw new AccessError(503, "request_photo_storage_verification_failed");
  return {
    bytes: await confirmedBytes(photo, store ?? requestPhotoStore()),
    mime: "image/jpeg",
  };
}

export async function verifyRequestPhotos(
  db: Sql,
  actor: Actor | null,
  input: PhotoInput,
): Promise<void> {
  const ids = input.photo_ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 10 ||
    new Set(ids).size !== ids.length
  )
    throw new AccessError(400, "invalid_request_photos");
  if (!ids.length) return;
  if (!actor?.customer_id || actor.staff_id)
    throw new AccessError(403, "customer_account_required_for_photos");
  const submission = uuid(input.request_id).toLowerCase();
  const checked = ids.map((id) => uuid(id).toLowerCase());
  await lockSubmission(db, actor.tenant_id, submission);
  const photos = await db.query<{ id: string }>(
    "select id from ns.service_request_photos where tenant_id=$1 and customer_id=$2 and submission_id=$3 and ready and id=any($4::uuid[])",
    [actor.tenant_id, actor.customer_id, submission, checked],
  );
  if (photos.rows.length !== ids.length)
    throw new AccessError(400, "request_photos_unavailable");
}
