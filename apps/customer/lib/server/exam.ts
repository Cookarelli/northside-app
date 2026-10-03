import "server-only";
import { randomUUID } from "node:crypto";
import {
  blankExam,
  examProblems,
  photoKinds,
  scoreFields,
  type ExamFields,
  type ExamPhoto,
  type ExamDraft,
  type ExamRevision,
  type ExamWorkspace,
  type PhotoKind,
} from "../exam";
import { type Sql, type Actor } from "./db";
import { gradingCard, gradingWriter, text, integer, audit } from "./grading";
import { AccessError, uuid } from "./security";
import { normalizePhoto, photoHash, type PhotoStore } from "./exam-storage";

const isWriter = (actor: Actor) =>
  ["owner", "admin", "operations"].includes(actor.staff_role || "");
const photoProjection = "id,kind,ready,active,width,height,confirmed_at";
const revisionProjection =
  "id,revision,draft_version,centering,surface,edges,corners,notes,projected_grade,unable_to_estimate,signed_by,signed_at,description";
type StoredPhoto = ExamPhoto & {
  card_id: string;
  object_key: string;
  source_hash: string;
  stored_hash: string | null;
  byte_size: number | null;
  abandoned: boolean;
};
export function examFields(value: unknown): ExamFields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccessError(400, "exam_fields_required");
  const v = value as Record<string, unknown>;
  const fields = { ...blankExam };
  for (const name of scoreFields)
    fields[name] =
      v[name] === null || v[name] === undefined
        ? null
        : integer(v[name], 1, 10);
  if (v.unable_to_estimate !== true && v.unable_to_estimate !== false)
    throw new AccessError(400, "estimate_choice_required");
  fields.notes = text(v.notes ?? "", 10000);
  fields.unable_to_estimate = v.unable_to_estimate;
  fields.projected_grade = text(v.projected_grade ?? "", 80);
  if (fields.unable_to_estimate && fields.projected_grade)
    throw new AccessError(400, "choose_estimate_or_unable_not_both");
  return fields;
}
async function writableCard(db: Sql, actor: Actor, cardId: string) {
  gradingWriter(actor);
  const card = await gradingCard(db, actor, cardId, true);
  if (card.voided_at) throw new AccessError(409, "intake_reversed");
  return card;
}
async function ensureDraft(db: Sql, actor: Actor, cardId: string) {
  await db.query(
    "insert into ns.grading_exam_drafts(tenant_id,card_id,fields,updated_by) values($1,$2,$3,$4) on conflict do nothing",
    [actor.tenant_id, cardId, JSON.stringify(blankExam), actor.staff_id],
  );
}
async function touchDraft(db: Sql, actor: Actor, cardId: string) {
  await ensureDraft(db, actor, cardId);
  await db.query(
    "update ns.grading_exam_drafts set version=version+1,updated_by=$3,updated_at=now() where tenant_id=$1 and card_id=$2",
    [actor.tenant_id, cardId, actor.staff_id],
  );
}
export async function examWorkspace(
  db: Sql,
  actor: Actor,
  cardId: string,
): Promise<ExamWorkspace> {
  const card = await gradingCard(db, actor, cardId);
  const writer = isWriter(actor);
  const revisions = (
    await db.query<ExamRevision>(
      `select ${revisionProjection} from ns.grading_exam_revisions where tenant_id=$1 and card_id=$2 order by revision desc`,
      [actor.tenant_id, cardId],
    )
  ).rows;
  for (const revision of revisions)
    revision.photos = (
      await db.query<ExamPhoto>(
        `select ${photoProjection
          .split(",")
          .map((c) => "p." + c)
          .join(
            ",",
          )} from ns.grading_photos p join ns.grading_exam_revision_photos r on r.tenant_id=p.tenant_id and r.photo_id=p.id where r.tenant_id=$1 and r.revision_id=$2 and p.kind<>'paper' order by p.created_at,p.id`,
        [actor.tenant_id, revision.id],
      )
    ).rows;
  const draft = writer
    ? ((
        await db.query<ExamDraft>(
          "select version,fields,internal_notes,updated_at,updated_by from ns.grading_exam_drafts where tenant_id=$1 and card_id=$2",
          [actor.tenant_id, cardId],
        )
      ).rows[0] ?? {
        version: 0,
        fields: { ...blankExam },
        internal_notes: "",
        updated_at: null,
        updated_by: null,
      })
    : null;
  const photos = actor.customer_id
    ? (revisions[0]?.photos ?? [])
    : (
        await db.query<ExamPhoto>(
          `select ${photoProjection} from ns.grading_photos where tenant_id=$1 and card_id=$2 and (active or (not ready and not abandoned)) order by created_at,id`,
          [actor.tenant_id, cardId],
        )
      ).rows;
  return {
    card_id: cardId,
    description: card.description,
    writer,
    examiner_id: writer ? actor.staff_id : null,
    voided: !!card.voided_at,
    draft,
    photos,
    revisions,
    ...(writer
      ? {
          revision_reasons: Object.fromEntries(
            (
              await db.query<{ revision_id: string; reason: string }>(
                "select p.revision_id,p.reason from ns.grading_exam_revision_private p join ns.grading_exam_revisions r on r.tenant_id=p.tenant_id and r.id=p.revision_id where r.tenant_id=$1 and r.card_id=$2",
                [actor.tenant_id, cardId],
              )
            ).rows.map((r) => [r.revision_id, r.reason]),
          ),
        }
      : {}),
    photos_complete: ["front", "back"].every((k) =>
      photos.some(
        (p) => p.kind === k && p.ready && (actor.customer_id || p.active),
      ),
    ),
  };
}
export async function saveExamDraft(
  db: Sql,
  actor: Actor,
  cardId: string,
  body: Record<string, unknown>,
) {
  await writableCard(db, actor, cardId);
  const fields = examFields(body.fields),
    version = integer(body.version, 0, 2147483646),
    notes = text(body.internal_notes ?? "", 10000);
  await ensureDraft(db, actor, cardId);
  const saved = (
    await db.query<{ version: number }>(
      "update ns.grading_exam_drafts set fields=$4,internal_notes=$5,updated_by=$6,updated_at=now(),version=version+1 where tenant_id=$1 and card_id=$2 and version=$3 returning version",
      [
        actor.tenant_id,
        cardId,
        version,
        JSON.stringify(fields),
        notes,
        actor.staff_id,
      ],
    )
  ).rows[0];
  if (!saved) throw new AccessError(409, "exam_changed_reload_before_saving");
  await audit(db, actor, cardId, "exam.draft_saved", "Exam draft saved", {
    version: saved.version,
  });
  return saved;
}
export async function prepareExamPhoto(
  db: Sql,
  actor: Actor,
  cardId: string,
  body: Record<string, unknown>,
) {
  const card = await writableCard(db, actor, cardId);
  const kind = body.kind as PhotoKind,
    requestId = uuid(text(body.request_id, 36, true)),
    hash = text(body.source_hash, 64, true);
  if (
    String(kind).startsWith("returned_") &&
    (card.custody !== "northside" ||
      !["returned", "ready_for_pickup"].includes(card.last_milestone))
  )
    throw new AccessError(
      409,
      "returned_photos_require_physical_return_before_release",
    );
  if (!photoKinds.includes(kind) || !/^[a-f0-9]{64}$/.test(hash))
    throw new AccessError(400, "invalid_photo_request");
  const existing = (
    await db.query<{ id: string; kind: string; source_hash: string }>(
      "select id,kind,source_hash from ns.grading_photos where tenant_id=$1 and card_id=$2 and request_id=$3",
      [actor.tenant_id, cardId, requestId],
    )
  ).rows[0];
  if (existing) {
    if (existing.kind !== kind || existing.source_hash !== hash)
      throw new AccessError(409, "photo_request_conflict");
    return { id: existing.id };
  }
  // File re-selection after refresh resumes the same pending upload. Identical
  // completed active images also survive an acknowledgement lost on the wire.
  const same = (
    await db.query<{ id: string }>(
      "select id from ns.grading_photos where tenant_id=$1 and card_id=$2 and kind=$3 and source_hash=$4 and (active or (not ready and not abandoned)) order by created_at desc limit 1",
      [actor.tenant_id, cardId, kind, hash],
    )
  ).rows[0];
  if (same) return same;
  const count = (
    await db.query<{ count: number }>(
      "select count(*)::int as count from ns.grading_photos where tenant_id=$1 and card_id=$2 and not ready and not abandoned",
      [actor.tenant_id, cardId],
    )
  ).rows[0].count;
  if (count >= 20)
    throw new AccessError(
      409,
      "too_many_pending_photos_remove_unused_attempts",
    );
  const id = randomUUID(),
    key = `${actor.tenant_id}/grading/${cardId}/${id}.jpg`;
  await db.query(
    "insert into ns.grading_photos(tenant_id,id,card_id,request_id,kind,object_key,source_hash,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [actor.tenant_id, id, cardId, requestId, kind, key, hash, actor.staff_id],
  );
  return { id };
}
export async function authorizedExamPhoto(
  db: Sql,
  actor: Actor,
  cardId: string,
  id: string,
  write = false,
): Promise<StoredPhoto> {
  if (write) await writableCard(db, actor, cardId);
  else await gradingCard(db, actor, cardId);
  const photo = (
    await db.query<StoredPhoto>(
      "select * from ns.grading_photos where tenant_id=$1 and card_id=$2 and id=$3",
      [actor.tenant_id, cardId, uuid(id)],
    )
  ).rows[0];
  if (!photo || (write && photo.abandoned) || (!write && !photo.ready))
    throw new AccessError(404, "photo_not_found");
  // RLS limits customers to owned received photos or owned published evidence.
  if (actor.customer_id && photo.kind === "paper")
    throw new AccessError(404, "photo_not_found");
  return photo;
}
export async function verifyStoredPhoto(
  photo: Pick<StoredPhoto, "object_key" | "stored_hash" | "byte_size">,
  store: PhotoStore,
) {
  const bytes = await store.read(photo.object_key);
  if (
    photoHash(bytes) !== photo.stored_hash ||
    bytes.length !== photo.byte_size
  )
    throw new AccessError(503, "stored_photo_verification_failed_retry");
  return bytes;
}
export async function completeExamPhoto(
  db: Sql,
  actor: Actor,
  cardId: string,
  id: string,
  bytes: Uint8Array,
  mime: string,
  store: PhotoStore,
) {
  const photo = await authorizedExamPhoto(db, actor, cardId, id, true);
  if (
    photo.kind.startsWith("returned_") &&
    (await gradingCard(db, actor, cardId)).custody !== "northside"
  )
    throw new AccessError(
      409,
      "returned_photo_upload_not_available_after_release",
    );
  if (photoHash(bytes) !== photo.source_hash)
    throw new AccessError(
      409,
      "photo_changed_choose_retake_for_a_different_file",
    );
  if (photo.ready) {
    await verifyStoredPhoto(photo, store);
    return { id: photo.id, confirmed: true, duplicate: true };
  }
  if (
    photo.kind.endsWith("closeup") &&
    (
      await db.query<{ count: number }>(
        "select count(*)::int as count from ns.grading_photos where tenant_id=$1 and card_id=$2 and kind in ('closeup','returned_closeup') and active",
        [actor.tenant_id, cardId],
      )
    ).rows[0].count >= 6
  )
    throw new AccessError(409, "six_closeups_maximum_remove_one_first");
  const image = await normalizePhoto(bytes, mime);
  await store.put(photo.object_key, image.bytes);
  await verifyStoredPhoto(
    {
      object_key: photo.object_key,
      stored_hash: image.hash,
      byte_size: image.bytes.length,
    },
    store,
  );
  if (!photo.kind.endsWith("closeup"))
    await db.query(
      "update ns.grading_photos set active=false where tenant_id=$1 and card_id=$2 and kind=$3 and active",
      [actor.tenant_id, cardId, photo.kind],
    );
  await db.query(
    "update ns.grading_photos set ready=true,active=true,stored_hash=$3,byte_size=$4,width=$5,height=$6,confirmed_at=now() where tenant_id=$1 and id=$2",
    [
      actor.tenant_id,
      id,
      image.hash,
      image.bytes.length,
      image.width,
      image.height,
    ],
  );
  await touchDraft(db, actor, cardId);
  await audit(
    db,
    actor,
    cardId,
    "exam.photo_confirmed",
    "Private photo uploaded and read back successfully",
    { photo_id: id, kind: photo.kind },
  );
  return { id, confirmed: true };
}
export async function removeExamPhoto(
  db: Sql,
  actor: Actor,
  cardId: string,
  id: string,
) {
  const photo = await authorizedExamPhoto(db, actor, cardId, id, true);
  if ((await gradingCard(db, actor, cardId)).custody === "released")
    throw new AccessError(409, "released_card_photo_evidence_is_preserved");
  if (!photo.ready) {
    // Keep attempted identity for idempotency; deleting pending records could
    // turn a delayed request into a new photo. Hiding uses a separate flag.
    await db.query(
      "update ns.grading_photos set abandoned=true where tenant_id=$1 and id=$2",
      [actor.tenant_id, id],
    );
  } else if (photo.active) {
    await db.query(
      "update ns.grading_photos set active=false where tenant_id=$1 and id=$2",
      [actor.tenant_id, id],
    );
    await touchDraft(db, actor, cardId);
  }
  await audit(
    db,
    actor,
    cardId,
    "exam.photo_removed_from_draft",
    "Removed from current draft; published image retained",
    { photo_id: id },
  );
  return { removed: true };
}
export async function publishExam(
  db: Sql,
  actor: Actor,
  cardId: string,
  body: Record<string, unknown>,
  store: PhotoStore,
) {
  const card = await writableCard(db, actor, cardId);
  if (body.signoff !== true)
    throw new AccessError(400, "authenticated_examiner_signoff_required");
  const version = integer(body.version, 0, 2147483646),
    reason = text(body.reason, 1000, true);
  const previous = (
    await db.query<{ id: string; revision: number }>(
      "select id,revision from ns.grading_exam_revisions where tenant_id=$1 and card_id=$2 and draft_version=$3",
      [actor.tenant_id, cardId, version],
    )
  ).rows[0];
  if (previous) return { ...previous, duplicate: true };
  const data = await examWorkspace(db, actor, cardId),
    draft = data.draft!;
  if (draft.version !== version)
    throw new AccessError(409, "exam_changed_reload_before_publishing");
  const fields = examFields(draft.fields);
  if (examProblems(fields, data.photos).length)
    throw new AccessError(
      409,
      "publication_requires_front_back_four_scores_and_estimate",
    );
  const photos = (
    await db.query<StoredPhoto>(
      "select * from ns.grading_photos where tenant_id=$1 and card_id=$2 and active and ready and kind in ('front','back','closeup','paper')",
      [actor.tenant_id, cardId],
    )
  ).rows;
  for (const photo of photos) await verifyStoredPhoto(photo, store);
  const id = randomUUID(),
    revision = (data.revisions[0]?.revision ?? 0) + 1;
  await db.query(
    "insert into ns.grading_exam_revisions(tenant_id,id,card_id,case_id,revision,draft_version,centering,surface,edges,corners,notes,projected_grade,unable_to_estimate,description,signed_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [
      actor.tenant_id,
      id,
      cardId,
      card.case_id,
      revision,
      version,
      fields.centering,
      fields.surface,
      fields.edges,
      fields.corners,
      fields.notes,
      fields.projected_grade,
      fields.unable_to_estimate,
      card.description,
      actor.staff_id,
    ],
  );
  await db.query(
    "insert into ns.grading_exam_revision_private(tenant_id,revision_id,internal_notes,reason) values($1,$2,$3,$4)",
    [actor.tenant_id, id, draft.internal_notes, reason],
  );
  await audit(db, actor, cardId, "exam.published", reason, {
    revision_id: id,
    revision,
  });
  return { id, revision };
}
