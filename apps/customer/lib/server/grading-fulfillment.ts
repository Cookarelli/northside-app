import "server-only";
import { randomUUID } from "node:crypto";
import type { Actor, Sql } from "./db";
import { requireRole } from "./db";
import { AccessError, csvCell, uuid } from "./security";
import {
  audit,
  lockGradingCustody,
  gradingCard,
  gradingDashboard,
  gradingWriter,
  integer,
  text,
  updateGradingCard,
} from "./grading";
import { cardQuotes } from "./grading-portal";
import { verifyStoredPhoto } from "./exam";
import type { PhotoStore } from "./exam-storage";
import {
  parseGradingLabel,
  scanMethods,
  type BatchWorkspace,
  type OperationsCard,
  type OperationsData,
  type ScannedCard,
} from "../grading-fulfillment";
import type { GradingData } from "../grading";
const reader = (a: Actor) =>
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
function method(v: unknown) {
  if (!scanMethods.includes(v as never))
    throw new AccessError(400, "record_how_the_card_was_scanned");
  return String(v);
}
function code(v: unknown) {
  try {
    return parseGradingLabel(text(v, 100, true));
  } catch (e) {
    throw new AccessError(
      400,
      e instanceof Error ? e.message : "invalid_card_label",
    );
  }
}
export async function scanGradingCard(
  db: Sql,
  a: Actor,
  value: unknown,
  lock = false,
): Promise<ScannedCard> {
  reader(a);
  const card = await gradingCard(db, a, code(value), lock);
  const details = (
    await db.query<{
      collector_id: string;
      collector_name: string;
      approval_current: boolean;
    }>(
      `select coalesce(r.verified_customer_id,c.id) collector_id,coalesce(cl.display_name,c.display_name) collector_name,ns.grading_approval_current($1,$2) approval_current from ns.customers c left join ns.grading_claim_requests r on r.tenant_id=c.tenant_id and r.case_id=$3 and r.status='approved' left join ns.customers cl on cl.tenant_id=r.tenant_id and cl.id=r.verified_customer_id where c.tenant_id=$1 and c.id=$4`,
      [a.tenant_id, card.card_id, card.case_id, card.customer_id],
    )
  ).rows[0];
  return { ...card, ...details };
}
export async function operationsOverview(
  db: Sql,
  a: Actor,
): Promise<OperationsData> {
  reader(a);
  const base = await gradingDashboard(db, a);
  return {
    ...base,
    withdrawals: (
      await db.query<OperationsData["withdrawals"][number]>(
        `select w.id,w.card_id,w.customer_id,w.created_at,coalesce((select r.resolution from ns.grading_withdrawal_reviews r where r.tenant_id=w.tenant_id and r.withdrawal_id=w.id order by r.created_at desc limit 1),'pending') resolution from ns.grading_withdrawals w where w.tenant_id=$1 order by w.created_at desc limit 100`,
        [a.tenant_id],
      )
    ).rows,
    notices: (
      await db.query<OperationsData["notices"][number]>(
        `select j.id,j.channel,j.state,j.attempts,j.last_error,j.created_at from ns.notification_jobs j join ns.notifications n on n.tenant_id=j.tenant_id and n.id=j.notification_id where j.tenant_id=$1 and n.kind='grading' order by j.created_at desc limit 100`,
        [a.tenant_id],
      )
    ).rows,
    pickups: (
      await db.query<OperationsData["pickups"][number]>(
        `select p.id,p.customer_id,p.recipient_name,p.recipient_kind,p.staff_id,p.created_at,array(select card_id from ns.grading_pickup_cards c where c.tenant_id=p.tenant_id and c.pickup_id=p.id order by card_id) card_ids from ns.grading_pickups p where p.tenant_id=$1 order by p.created_at desc limit 50`,
        [a.tenant_id],
      )
    ).rows,
    status_imports: (
      await db.query<OperationsData["status_imports"][number]>(
        "select id,source,status,created_at from ns.imports where tenant_id=$1 and module='grading_status' order by created_at desc limit 50",
        [a.tenant_id],
      )
    ).rows,
  };
}
export async function operationsCard(
  db: Sql,
  a: Actor,
  id: string,
): Promise<OperationsCard> {
  reader(a);
  const card = await scanGradingCard(db, a, id);
  return {
    card,
    photos: (
      await db.query<OperationsCard["photos"][number]>(
        "select id,kind,ready,active,width,height,confirmed_at from ns.grading_photos where tenant_id=$1 and card_id=$2 and active and ready and kind like 'returned_%' order by created_at",
        [a.tenant_id, id],
      )
    ).rows,
    outcomes: (
      await db.query<OperationsCard["outcomes"][number]>(
        "select revision,kind,result,certificate,staff_id,source,reason,created_at from ns.grading_outcomes where tenant_id=$1 and card_id=$2 order by revision desc",
        [a.tenant_id, id],
      )
    ).rows,
    audit: (
      await db.query<OperationsCard["audit"][number]>(
        "select action,staff_id,customer_actor_id,reason,coalesce(source,'legacy source not recorded') source,created_at from ns.grading_audit where tenant_id=$1 and object_id=$2 order by created_at desc limit 100",
        [a.tenant_id, id],
      )
    ).rows,
  };
}
export async function batchWorkspace(
  db: Sql,
  a: Actor,
  id: string,
): Promise<BatchWorkspace> {
  reader(a);
  uuid(id);
  const batch = (
    await db.query<GradingData["batches"][number]>(
      "select id,reference,provider,service,carrier,tracking,version,phase from ns.grading_batches where tenant_id=$1 and id=$2",
      [a.tenant_id, id],
    )
  ).rows[0];
  if (!batch) throw new AccessError(404, "batch_not_found");
  const rows = (
    await db.query<{
      card_id: string;
      scan_id: string | null;
      scan_method: string | null;
    }>(
      "select c.id card_id,s.id scan_id,s.method scan_method from ns.card_items c left join ns.grading_batch_scans s on s.tenant_id=c.tenant_id and s.card_id=c.id and s.batch_id=c.batch_id and s.removed_at is null where c.tenant_id=$1 and c.batch_id=$2 order by c.id",
      [a.tenant_id, id],
    )
  ).rows;
  const cards = [];
  for (const row of rows)
    cards.push({ ...(await scanGradingCard(db, a, row.card_id)), ...row });
  const dispatch =
    (
      await db.query<NonNullable<BatchWorkspace["dispatch"]>>(
        "select reference,provider,service,carrier,tracking,staff_id,reason,source,dispatched_at from ns.grading_dispatches where tenant_id=$1 and batch_id=$2",
        [a.tenant_id, id],
      )
    ).rows[0] ?? null;
  const manifest = (
    await db.query<BatchWorkspace["manifest"][number]>(
      "select card_id,customer_id,description,card_version,approval_request_id,quote_id,exam_revision_id from ns.grading_manifest_cards where tenant_id=$1 and batch_id=$2 order by card_id",
      [a.tenant_id, id],
    )
  ).rows;
  return { batch, cards, dispatch, manifest };
}
export async function manifestCsv(db: Sql, a: Actor, id: string) {
  const w = await batchWorkspace(db, a, id);
  if (!w.dispatch)
    throw new AccessError(409, "no_preserved_manifest_for_this_batch");
  const d = w.dispatch;
  return (
    [
      "batch_id,submission_reference,provider,service,carrier,tracking,dispatched_at,staff_id,card_id,owner_id,description,approval_request_id,quote_id,exam_revision_id",
      ...w.manifest.map((c) =>
        [
          id,
          d.reference,
          d.provider,
          d.service,
          d.carrier,
          d.tracking,
          d.dispatched_at,
          d.staff_id,
          c.card_id,
          c.customer_id,
          c.description,
          c.approval_request_id,
          c.quote_id,
          c.exam_revision_id,
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
async function batchLock(db: Sql, a: Actor, b: Record<string, unknown>) {
  const id = uuid(text(b.batch_id, 36, true));
  const row = (
    await db.query<GradingData["batches"][number]>(
      "select id,reference,provider,service,carrier,tracking,version,phase from ns.grading_batches where tenant_id=$1 and id=$2 for update",
      [a.tenant_id, id],
    )
  ).rows[0];
  if (!row || row.version !== integer(b.batch_version, 1, 100000000))
    throw new AccessError(409, "batch_changed_reload_before_proceeding");
  if (row.phase !== "draft")
    throw new AccessError(409, "batch_is_not_an_open_outbound_submission");
  return row;
}
async function compatible(
  db: Sql,
  a: Actor,
  id: string,
  b: GradingData["batches"][number],
) {
  const c = await scanGradingCard(db, a, id, true),
    q = (await cardQuotes(db, a, id))[0];
  if (
    c.voided_at ||
    c.custody !== "northside" ||
    c.status_key !== "ready_to_submit" ||
    !c.approval_current
  )
    throw new AccessError(
      409,
      "card_requires_current_approval_and_physically_ready_status",
    );
  if (
    !q?.provider_confirmed ||
    !b.service ||
    q.provider !== b.provider ||
    q.service !== b.service
  )
    throw new AccessError(
      409,
      "approved_provider_and_service_must_match_batch",
    );
  if (c.batch_id && c.batch_id !== b.id)
    throw new AccessError(409, "card_already_in_another_outbound_submission");
  return c;
}
function selections(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new AccessError(400, "scan_between_1_and_100_cards");
  const out = value
    .map((v) => {
      if (!v || typeof v !== "object")
        throw new AccessError(400, "invalid_card_selection");
      const i = v as Record<string, unknown>;
      return {
        card_id: uuid(text(i.card_id, 36, true)),
        version: integer(i.version, 1, 100000000),
        method: i.method === undefined ? undefined : method(i.method),
        code: i.code === undefined ? undefined : code(i.code),
      };
    })
    .sort((a, b) => a.card_id.localeCompare(b.card_id));
  if (new Set(out.map((i) => i.card_id)).size !== out.length)
    throw new AccessError(400, "duplicate_card_selection");
  return out;
}
export async function verifyReturnPhotos(
  db: Sql,
  a: Actor,
  id: string,
  store: PhotoStore,
) {
  const rows = (
    await db.query<{
      id: string;
      kind: string;
      object_key: string;
      stored_hash: string;
      byte_size: number;
    }>(
      "select id,kind,object_key,stored_hash,byte_size from ns.grading_photos where tenant_id=$1 and card_id=$2 and active and ready and kind like 'returned_%'",
      [a.tenant_id, id],
    )
  ).rows;
  if (
    !["returned_front", "returned_back"].every((k) =>
      rows.some((p) => p.kind === k),
    )
  )
    throw new AccessError(
      409,
      "confirmed_returned_front_and_back_photos_required",
    );
  for (const p of rows) await verifyStoredPhoto(p, store);
  return rows.map((p) => p.id);
}
export async function recordOutcome(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
  source = "northside",
) {
  gradingWriter(a);
  await lockGradingCustody(db, a);
  const c = await gradingCard(db, a, uuid(text(b.card_id, 36, true)), true);
  if (
    c.version !== integer(b.version, 1, 100000000) ||
    c.voided_at ||
    !["northside", "grader"].includes(c.custody)
  )
    throw new AccessError(409, "card_changed_reload");
  if (
    c.custody === "northside" &&
    !["returned", "ready_for_pickup"].includes(c.last_milestone)
  )
    throw new AccessError(
      409,
      "external_outcome_requires_a_dispatched_returned_card",
    );
  if (!["graded", "no_grade"].includes(String(b.result_kind)))
    throw new AccessError(400, "select_actual_grade_or_no_grade");
  const result = text(b.result, 3000, true),
    certificate = text(b.certificate ?? "", 120),
    reason = text(b.reason, 1000, true);
  const n = (
    await db.query<{ revision: number }>(
      "select coalesce(max(revision),0)+1 revision from ns.grading_outcomes where tenant_id=$1 and card_id=$2",
      [a.tenant_id, c.card_id],
    )
  ).rows[0].revision;
  await db.query(
    "insert into ns.grading_outcomes(tenant_id,id,card_id,revision,kind,result,certificate,staff_id,source,reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      a.tenant_id,
      randomUUID(),
      c.card_id,
      n,
      b.result_kind,
      result,
      certificate,
      a.staff_id,
      source,
      reason,
    ],
  );
  await updateGradingCard(
    db,
    a,
    c.card_id,
    {
      version: c.version,
      status_key: c.custody === "grader" ? "returned" : c.status_key,
      result_kind: b.result_kind,
      result,
      certificate,
      reason,
    },
    source,
  );
  await db.query(
    "update ns.grading_batch_scans set removed_at=clock_timestamp() where tenant_id=$1 and card_id=$2 and removed_at is null",
    [a.tenant_id, c.card_id],
  );
  return { recorded: true, revision: n };
}
export async function operationsAction(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
  store: PhotoStore,
): Promise<Record<string, unknown>> {
  if (b.action === "scan_card")
    return { card: await scanGradingCard(db, a, b.code) };
  gradingWriter(a);
  await lockGradingCustody(db, a);
  const request = uuid(text(b.request_id, 36, true)),
    why = text(b.reason, 1000, true);
  // Replay is tied to exact normalized JSON and the authenticated staff actor.
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + ":grading-operation:" + request,
  ]);
  const prior = (
    await db.query<{ same: boolean; result: Record<string, unknown> }>(
      "select (staff_id=$3 and payload=$4::jsonb) same,result from ns.grading_operation_requests where tenant_id=$1 and id=$2",
      [a.tenant_id, request, a.staff_id, JSON.stringify(b)],
    )
  ).rows[0];
  if (prior) {
    if (!prior.same)
      throw new AccessError(409, "operation_retry_must_match_original_request");
    return { ...prior.result, duplicate: true };
  }
  let result: Record<string, unknown> = { saved: true };
  switch (b.action) {
    case "batch_create":
    case "batch_tracking": {
      const { batch } = await import("./grading-operations");
      result = await batch(db, a, {
        ...b,
        operation: b.action === "batch_create" ? "create" : "tracking",
      });
      break;
    }
    case "scan_batch": {
      const batch = await batchLock(db, a, b),
        id = code(b.code),
        scanMethod = method(b.method);
      const c = await compatible(db, a, id, batch);
      const existing = (
        await db.query<{ batch_id: string }>(
          "select batch_id from ns.grading_batch_scans where tenant_id=$1 and card_id=$2 and removed_at is null",
          [a.tenant_id, id],
        )
      ).rows[0];
      if (existing && existing.batch_id !== batch.id)
        throw new AccessError(
          409,
          "card_already_in_another_outbound_submission",
        );
      if (!existing) {
        await db.query(
          "insert into ns.grading_batch_scans(tenant_id,id,batch_id,card_id,method,staff_id) values($1,$2,$3,$4,$5,$6)",
          [a.tenant_id, randomUUID(), batch.id, id, scanMethod, a.staff_id],
        );
        await db.query(
          "update ns.card_items set batch_id=$3 where tenant_id=$1 and id=$2",
          [a.tenant_id, id, batch.id],
        );
        await db.query(
          "update ns.grading_batches set version=version+1 where tenant_id=$1 and id=$2",
          [a.tenant_id, batch.id],
        );
        await audit(db, a, id, "batch.scanned", why, {
          batch_id: batch.id,
          method: scanMethod,
          source: "northside",
        });
      }
      result = {
        scanned: true,
        card_id: c.card_id,
        already_scanned: !!existing,
      };
      break;
    }
    case "remove_batch_card": {
      const batch = await batchLock(db, a, b),
        c = await gradingCard(db, a, uuid(text(b.card_id, 36, true)), true);
      if (c.batch_id !== batch.id || c.custody !== "northside")
        throw new AccessError(409, "card_not_in_open_batch");
      await db.query(
        "update ns.grading_batch_scans set removed_at=clock_timestamp() where tenant_id=$1 and batch_id=$2 and card_id=$3 and removed_at is null",
        [a.tenant_id, batch.id, c.card_id],
      );
      await db.query(
        "update ns.card_items set batch_id=null where tenant_id=$1 and id=$2",
        [a.tenant_id, c.card_id],
      );
      await db.query(
        "update ns.grading_batches set version=version+1 where tenant_id=$1 and id=$2",
        [a.tenant_id, batch.id],
      );
      await audit(db, a, c.card_id, "batch.removed_before_dispatch", why, {
        batch_id: batch.id,
        source: "northside",
      });
      break;
    }
    case "dispatch": {
      if (b.confirmed !== true)
        throw new AccessError(400, "confirm_physical_dispatch");
      const batch = await batchLock(db, a, b),
        items = selections(b.cards);
      if (
        !batch.reference.trim() ||
        !batch.carrier.trim() ||
        !batch.tracking.trim()
      )
        throw new AccessError(
          400,
          "submission_reference_carrier_and_tracking_required",
        );
      const staged = (
        await db.query<{ card_id: string }>(
          "select card_id from ns.grading_batch_scans where tenant_id=$1 and batch_id=$2 and removed_at is null order by card_id",
          [a.tenant_id, batch.id],
        )
      ).rows;
      const assigned = (
        await db.query<{ id: string }>(
          "select id from ns.card_items where tenant_id=$1 and batch_id=$2 order by id",
          [a.tenant_id, batch.id],
        )
      ).rows;
      if (
        JSON.stringify(staged.map((x) => x.card_id)) !==
          JSON.stringify(items.map((x) => x.card_id)) ||
        JSON.stringify(assigned.map((x) => x.id)) !==
          JSON.stringify(items.map((x) => x.card_id))
      )
        throw new AccessError(
          409,
          "review_and_scan_every_card_in_the_dispatch_manifest",
        );
      const cards = [];
      for (const i of items) {
        const c = await compatible(db, a, i.card_id, batch);
        if (c.version !== i.version)
          throw new AccessError(409, "card_changed_review_dispatch_again");
        cards.push(c);
      }
      await db.query(
        "insert into ns.grading_dispatches(tenant_id,batch_id,request_id,payload,reference,provider,service,carrier,tracking,staff_id,reason,source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'northside')",
        [
          a.tenant_id,
          batch.id,
          request,
          JSON.stringify(b),
          batch.reference,
          batch.provider,
          batch.service,
          batch.carrier,
          batch.tracking,
          a.staff_id,
          why,
        ],
      );
      for (const c of cards) {
        const evidence = (
          await db.query<{
            request_id: string;
            quote_id: string;
            exam_revision_id: string;
          }>(
            "select p.request_id,p.quote_id,p.exam_revision_id from ns.grading_approval_cards p join ns.grading_approval_requests r on r.tenant_id=p.tenant_id and r.id=p.request_id where p.tenant_id=$1 and p.card_id=$2 order by r.sequence desc limit 1",
            [a.tenant_id, c.card_id],
          )
        ).rows[0];
        await db.query(
          "insert into ns.grading_manifest_cards(tenant_id,batch_id,card_id,customer_id,description,card_version,approval_request_id,quote_id,exam_revision_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            a.tenant_id,
            batch.id,
            c.card_id,
            c.customer_id,
            c.description,
            c.version,
            evidence.request_id,
            evidence.quote_id,
            evidence.exam_revision_id,
          ],
        );
        await updateGradingCard(db, a, c.card_id, {
          version: c.version,
          status_key: "sent_to_grader",
          reason: why,
        });
      }
      await db.query(
        "update ns.grading_batches set phase='dispatched',version=version+1 where tenant_id=$1 and id=$2",
        [a.tenant_id, batch.id],
      );
      await audit(db, a, batch.id, "batch.dispatched", why, {
        cards: items,
        source: "northside",
      });
      result = { dispatched: true, batch_id: batch.id };
      break;
    }
    case "cancel_batch": {
      const batch = await batchLock(db, a, b);
      const cards = (
        await db.query<{ id: string }>(
          "select id from ns.card_items where tenant_id=$1 and batch_id=$2 order by id",
          [a.tenant_id, batch.id],
        )
      ).rows;
      for (const row of cards) {
        const c = await gradingCard(db, a, row.id, true);
        if (c.custody !== "northside")
          throw new AccessError(409, "post_dispatch_cancellation_not_allowed");
        await db.query(
          "update ns.card_items set batch_id=null where tenant_id=$1 and id=$2",
          [a.tenant_id, row.id],
        );
      }
      await db.query(
        "update ns.grading_batch_scans set removed_at=clock_timestamp() where tenant_id=$1 and batch_id=$2 and removed_at is null",
        [a.tenant_id, batch.id],
      );
      await db.query(
        "update ns.grading_batches set phase='cancelled',version=version+1 where tenant_id=$1 and id=$2",
        [a.tenant_id, batch.id],
      );
      await audit(db, a, batch.id, "batch.cancelled_before_dispatch", why, {
        source: "northside",
      });
      break;
    }
    case "milestone": {
      const items = selections(b.cards),
        status = text(b.status_key, 40, true);
      if (["sent_to_grader", "returned", "completed"].includes(status))
        throw new AccessError(
          409,
          "use_dispatch_returns_or_verified_pickup_workflow",
        );
      for (const i of items) {
        const c = await gradingCard(db, a, i.card_id, true);
        if (c.version !== i.version)
          throw new AccessError(409, "card_changed_reload");
        if (status === "ready_for_pickup" && c.result_kind)
          await verifyReturnPhotos(db, a, c.card_id, store);
        await updateGradingCard(db, a, c.card_id, {
          version: i.version,
          status_key: status,
          reason: why,
        });
      }
      break;
    }
    case "return_card": {
      if (b.physically_received !== true)
        throw new AccessError(
          400,
          "confirm_card_is_physically_back_at_northside",
        );
      result = await recordOutcome(db, a, b);
      break;
    }
    case "release": {
      if (b.identity_verified !== true || b.recipient_acknowledged !== true)
        throw new AccessError(
          400,
          "identity_verification_and_recipient_acknowledgment_required",
        );
      const customer = uuid(text(b.customer_id, 36, true)),
        name = text(b.recipient_name, 120, true),
        kind = text(b.recipient_kind, 30, true),
        verification = text(b.verification_method, 60, true),
        evidence = text(b.verification_evidence, 1000, true),
        authorization = text(b.authorization_evidence ?? "", 1000),
        ack = text(b.acknowledgment, 500, true),
        items = selections(b.cards);
      if (
        !["collector", "representative"].includes(kind) ||
        ![
          "photo_id_in_person",
          "verified_account_and_receipt",
          "independent_callback_and_receipt",
        ].includes(verification) ||
        (kind === "representative" && !authorization)
      )
        throw new AccessError(
          400,
          "independent_recipient_and_representative_authorization_required",
        );
      const saved = [];
      for (const i of items) {
        if (!i.method || i.code !== i.card_id)
          throw new AccessError(400, "scan_every_released_card");
        const c = await scanGradingCard(db, a, i.card_id, true);
        if (
          c.collector_id !== customer ||
          c.version !== i.version ||
          c.voided_at ||
          c.custody !== "northside" ||
          c.status_key !== "ready_for_pickup"
        )
          throw new AccessError(
            409,
            "collector_card_or_pickup_readiness_mismatch",
          );
        const dispatched =
          (
            await db.query(
              "select id from ns.grading_audit where tenant_id=$1 and object_id=$2 and after_record->>'status_key' in ('sent_to_grader','grader_received','grading') limit 1",
              [a.tenant_id, c.card_id],
            )
          ).rows.length > 0;
        if (dispatched && !c.result_kind)
          throw new AccessError(
            409,
            "actual_external_outcome_required_before_release",
          );
        const photoIds = dispatched
          ? await verifyReturnPhotos(db, a, c.card_id, store)
          : [];
        saved.push({ i, photoIds });
      }
      await db.query(
        "insert into ns.grading_pickups(tenant_id,id,customer_id,recipient_name,recipient_kind,verification_method,verification_evidence,authorization_evidence,acknowledgment,staff_id,reason,source,payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'northside',$12)",
        [
          a.tenant_id,
          request,
          customer,
          name,
          kind,
          verification,
          evidence,
          authorization,
          ack,
          a.staff_id,
          why,
          JSON.stringify(b),
        ],
      );
      for (const { i, photoIds } of saved) {
        await db.query(
          "insert into ns.grading_pickup_cards(tenant_id,pickup_id,card_id,card_version,scan_method,photo_ids) values($1,$2,$3,$4,$5,$6)",
          [a.tenant_id, request, i.card_id, i.version, i.method, photoIds],
        );
        await updateGradingCard(db, a, i.card_id, {
          version: i.version,
          status_key: "completed",
          reason: why,
        });
      }
      await audit(db, a, request, "pickup.verified_release", why, {
        card_ids: items.map((i) => i.card_id),
        source: "northside",
      });
      result = { released: true, pickup_id: request, count: items.length };
      break;
    }
    case "withdrawal_review": {
      const id = uuid(text(b.withdrawal_id, 36, true)),
        resolution = text(b.resolution, 40, true);
      if (
        ![
          "reviewing_with_grader",
          "return_when_received",
          "unable_to_withdraw",
          "closed",
        ].includes(resolution)
      )
        throw new AccessError(400, "invalid_withdrawal_review");
      const w = (
        await db.query<{ card_id: string; customer_id: string }>(
          "select card_id,customer_id from ns.grading_withdrawals where tenant_id=$1 and id=$2",
          [a.tenant_id, id],
        )
      ).rows[0];
      if (!w) throw new AccessError(404, "withdrawal_not_found");
      await db.query(
        "insert into ns.grading_withdrawal_reviews(tenant_id,id,withdrawal_id,staff_id,resolution,reason) values($1,$2,$3,$4,$5,$6)",
        [a.tenant_id, request, id, a.staff_id, resolution, why],
      );
      await audit(db, a, w.card_id, "withdrawal.staff_review", why, {
        withdrawal_id: id,
        resolution,
        source: "northside",
      });
      break;
    }
    default:
      throw new AccessError(400, "unknown_grading_operation");
  }
  await db.query(
    "insert into ns.grading_operation_requests(tenant_id,id,staff_id,payload,result) values($1,$2,$3,$4,$5)",
    [
      a.tenant_id,
      request,
      a.staff_id,
      JSON.stringify(b),
      JSON.stringify(result),
    ],
  );
  return result;
}
