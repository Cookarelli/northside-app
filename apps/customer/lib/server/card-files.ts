import "server-only";
import type { Sql, Actor } from "./db";
import { requireRole } from "./db";
import { prepareUpload, authorizedFile, readCard } from "./records";
import { normalizePhoto, photoHash } from "./exam-storage";
import { supabase } from "./providers";
import { AccessError, matchesFileType, privateHeaders } from "./security";
import { gradingCard, audit } from "./grading";
import { consignmentAudit } from "./consignment";
export type CardFileStore = {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
};
export function cardFileStore(): CardFileStore {
  const storage = supabase(true, 10000).storage.from("northside-private");
  return {
    async put(key, bytes, mime) {
      const r = await storage.upload(key, bytes, {
        contentType: mime,
        upsert: false,
        cacheControl: "0",
      });
      if (r.error) throw new AccessError(503, "upload_failed");
    },
    async read(key) {
      const r = await storage.download(key);
      if (r.error || !r.data || r.data.size > 5242880)
        throw new AccessError(503, "file_unavailable");
      return new Uint8Array(await r.data.arrayBuffer());
    },
  };
}
export async function uploadCardFile(
  db: Sql,
  a: Actor,
  cardId: string,
  bytes: Uint8Array,
  mime: string,
  store?: CardFileStore,
) {
  requireRole(a, ["owner", "admin", "operations"]);
  await readCard(db, a, cardId);
  const grading = (
    await db.query(
      "select card_id from ns.grading_cards where tenant_id=$1 and card_id=$2",
      [a.tenant_id, cardId],
    )
  ).rows[0];
  if (grading && (await gradingCard(db, a, cardId, true)).voided_at)
    throw new AccessError(409, "intake_reversed");
  if (!bytes.length || bytes.length > 5242880)
    throw new AccessError(413, "file_too_large");
  if (mime.startsWith("image/")) {
    bytes = (await normalizePhoto(bytes, mime, 5242880)).bytes;
    mime = "image/jpeg";
  } else if (mime !== "application/pdf" || !matchesFileType(bytes, mime))
    throw new AccessError(415, "unsupported_file");
  const file = await prepareUpload(db, a, cardId, mime),
    storage = store ?? cardFileStore();
  await storage.put(file.key, bytes, mime);
  const saved = await storage.read(file.key),
    hash = photoHash(bytes);
  if (saved.length !== bytes.length || photoHash(saved) !== hash)
    throw new AccessError(503, "upload_not_confirmed_retry");
  await db.query(
    "update ns.file_objects set ready=true,content_sha256=$3,byte_length=$4 where tenant_id=$1 and id=$2",
    [a.tenant_id, file.id, hash, bytes.length],
  );
  if (grading)
    await audit(
      db,
      a,
      cardId,
      "card.image_uploaded",
      "Staff confirmed private attachment storage",
      { file_id: file.id },
    );
  const consignment = (
    await db.query<{ id: string }>(
      "select id from ns.consignment_items where tenant_id=$1 and card_id=$2",
      [a.tenant_id, cardId],
    )
  ).rows[0];
  if (consignment)
    await consignmentAudit(
      db,
      a,
      consignment.id,
      "image.uploaded",
      "Staff confirmed private attachment storage",
      { file_id: file.id },
    );
  return { id: file.id };
}
export async function readCardFile(
  db: Sql,
  a: Actor,
  id: string,
  store?: CardFileStore,
) {
  const file = await authorizedFile(db, a, id),
    bytes = await (store ?? cardFileStore()).read(file.object_key);
  if (
    !bytes.length ||
    bytes.length > 5242880 ||
    !matchesFileType(bytes, file.mime_type) ||
    (file.content_sha256 && photoHash(bytes) !== file.content_sha256) ||
    (file.byte_length !== null &&
      file.byte_length !== undefined &&
      bytes.length !== file.byte_length)
  )
    throw new AccessError(503, "file_unavailable");
  if (file.mime_type.startsWith("image/") && !file.content_sha256) {
    const normalized = await normalizePhoto(bytes, file.mime_type, 5242880);
    return {
      bytes: normalized.bytes,
      mime: "image/jpeg",
      cardId: file.card_id,
    };
  }
  return { bytes, mime: file.mime_type, cardId: file.card_id };
}
export function cardFileResponse(file: { bytes: Uint8Array; mime: string }) {
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      ...privateHeaders(),
      "Content-Type": file.mime,
      "Content-Disposition":
        file.mime === "application/pdf"
          ? 'attachment; filename="northside-card.pdf"'
          : 'inline; filename="northside-card.jpg"',
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}
