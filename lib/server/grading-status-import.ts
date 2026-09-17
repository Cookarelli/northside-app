import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Actor, Sql } from "./db";
import { AccessError, uuid } from "./security";
import { csvRows } from "./grading-import";
import {
  gradingCard,
  lockGradingCustody,
  gradingWriter,
  text,
  updateGradingCard,
  audit,
} from "./grading";
import { recordOutcome, verifyReturnPhotos } from "./grading-fulfillment";
import type { PhotoStore } from "./exam-storage";
import {
  statusImportFields,
  type StatusImportPreview,
  type StatusImportRow,
} from "../grading-fulfillment";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function statusImportHeaders(a: Actor, csv: unknown) {
  gradingWriter(a);
  return csvRows(csv)[0];
}
const allowed = [
  "examining",
  "awaiting_decision",
  "grader_received",
  "grading",
  "returned",
  "ready_for_pickup",
  "on_hold",
  "exception",
  "return_without_grading",
  "cancelled",
];
export async function statusImportPreview(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
): Promise<StatusImportPreview> {
  gradingWriter(a);
  const rows = csvRows(b.csv),
    headers = rows.shift()!,
    source = text(b.source, 80, true);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(source) ||
    !b.mapping ||
    typeof b.mapping !== "object"
  )
    throw new AccessError(400, "source_and_column_mapping_required");
  const mapping = b.mapping as Record<string, string>,
    seen = new Set<string>(),
    seenCards = new Set<string>(),
    out: StatusImportRow[] = [];
  for (const [index, row] of rows.entries()) {
    let external = "";
    try {
      const v: Record<string, string> = {};
      for (const key of statusImportFields) {
        const h = mapping[key];
        if (typeof h !== "string" || (h && !headers.includes(h)))
          throw new AccessError(400, "mapped_header_missing");
        v[key] = h ? (row[headers.indexOf(h)] ?? "") : "";
      }
      external = text(v.external_id, 120, true);
      if (!/^[a-zA-Z0-9_.:-]+$/.test(external) || seen.has(external))
        throw new AccessError(400, "external_id_invalid_or_duplicate");
      seen.add(external);
      const id = uuid(v.card_id);
      if (seenCards.has(id))
        throw new AccessError(400, "one_update_per_physical_card_per_file");
      seenCards.add(id);
      if (!allowed.includes(v.status_key))
        throw new AccessError(
          400,
          "dispatch_approval_and_pickup_cannot_be_imported",
        );
      const input = {
        card_id: id,
        status_key: v.status_key,
        result_kind: text(v.result_kind, 20),
        result: text(v.result, 3000),
        certificate: text(v.certificate, 120),
        reason: text(v.reason, 1000, true),
      };
      if (
        v.status_key === "returned" &&
        (!["graded", "no_grade"].includes(input.result_kind) || !input.result)
      )
        throw new AccessError(400, "actual_grade_or_no_grade_reason_required");
      if (
        v.status_key !== "returned" &&
        (input.result_kind || input.result || input.certificate)
      )
        throw new AccessError(400, "result_fields_only_for_returned_milestone");
      const c = await gradingCard(db, a, id);
      if (c.voided_at) throw new AccessError(409, "card_unavailable");
      const fingerprint = hash(input),
        prior = (
          await db.query<{ fingerprint: string }>(
            "select fingerprint from ns.grading_status_import_rows where tenant_id=$1 and source=$2 and external_id=$3",
            [a.tenant_id, source, external],
          )
        ).rows[0];
      if (prior && prior.fingerprint !== fingerprint)
        throw new AccessError(
          409,
          "external_id_already_used_with_different_values",
        );
      if (!prior && c.custody === "released")
        throw new AccessError(409, "card_already_released");
      if (
        !prior &&
        ["grader_received", "grading", "returned"].includes(input.status_key) &&
        c.custody !== "grader" &&
        !(input.status_key === "returned" && c.last_milestone === "returned")
      )
        throw new AccessError(409, "card_not_with_external_grader");
      if (
        !prior &&
        ["cancelled", "return_without_grading"].includes(input.status_key) &&
        c.custody !== "northside"
      )
        throw new AccessError(
          409,
          "post_dispatch_withdrawal_requires_staff_review",
        );
      out.push({
        line: index + 2,
        external_id: external,
        state: prior ? "duplicate" : "ready",
        message: prior
          ? "Previously committed; no repeat update."
          : "Review the recorded evidence and current physical status.",
        input,
        fingerprint,
        card_version: c.version,
        previous_status: c.status_key,
        description: c.description,
      });
    } catch (e) {
      out.push({
        line: index + 2,
        external_id: external,
        state: "error",
        message: e instanceof AccessError ? e.message : "Invalid row",
      });
    }
  }
  const p = { id: randomUUID(), source, mapping, rows: out };
  await db.query(
    "insert into ns.imports(tenant_id,id,source,actor_id,module,preview) values($1,$2,$3,$4,'grading_status',$5)",
    [a.tenant_id, p.id, source, a.staff_id, JSON.stringify(p)],
  );
  await audit(
    db,
    a,
    p.id,
    "status_import.previewed",
    "Reviewed spreadsheet mapping and validation",
    { source: "import", mapping },
  );
  return p;
}
export async function readStatusImport(db: Sql, a: Actor, id: string) {
  gradingWriter(a);
  const row = (
    await db.query<{ preview: StatusImportPreview; status: string }>(
      "select preview,status from ns.imports where tenant_id=$1 and id=$2 and module='grading_status'",
      [a.tenant_id, uuid(id)],
    )
  ).rows[0];
  if (!row) throw new AccessError(404, "status_import_not_found");
  return { ...row.preview, status: row.status };
}
export async function commitStatusImport(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
  store: PhotoStore,
) {
  gradingWriter(a);
  await lockGradingCustody(db, a);
  const id = uuid(text(b.id, 36, true)),
    why = text(b.reason, 1000, true);
  if (b.confirmed !== true)
    throw new AccessError(400, "review_and_confirm_every_spreadsheet_row");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + ":grading-status-import",
  ]);
  await db.query(
    "select id from ns.imports where tenant_id=$1 and id=$2 for update",
    [a.tenant_id, id],
  );
  const p = await readStatusImport(db, a, id);
  if (p.status === "committed") return { committed: true, duplicate: true };
  if (p.status !== "review" || p.rows.some((r) => r.state === "error"))
    throw new AccessError(409, "resolve_import_errors_first");
  let changed = 0;
  for (const row of [...p.rows].sort((x, y) =>
    String(x.input?.card_id).localeCompare(String(y.input?.card_id)),
  )) {
    if (!row.input || !row.fingerprint)
      throw new AccessError(409, "invalid_saved_review");
    const prior = (
      await db.query<{ fingerprint: string }>(
        "select fingerprint from ns.grading_status_import_rows where tenant_id=$1 and source=$2 and external_id=$3",
        [a.tenant_id, p.source, row.external_id],
      )
    ).rows[0];
    if (prior) {
      if (prior.fingerprint !== row.fingerprint)
        throw new AccessError(409, "import_conflict_create_new_preview");
      continue;
    }
    const c = await gradingCard(db, a, String(row.input.card_id), true);
    if (c.version !== row.card_version || c.voided_at)
      throw new AccessError(
        409,
        "card_changed_since_review_create_new_preview",
      );
    const input: Record<string, unknown> = { ...row.input, version: c.version };
    if (input.status_key === "returned")
      await recordOutcome(db, a, input, "import");
    else {
      // Blank outcome columns are absent evidence, not a replacement result.
      delete input.result_kind;
      delete input.result;
      delete input.certificate;
      if (
        input.status_key === "ready_for_pickup" &&
        c.last_milestone === "returned"
      )
        await verifyReturnPhotos(db, a, c.card_id, store);
      await updateGradingCard(db, a, c.card_id, input, "import");
    }
    await db.query(
      "insert into ns.grading_status_import_rows(tenant_id,source,external_id,fingerprint,import_id,card_id) values($1,$2,$3,$4,$5,$6)",
      [a.tenant_id, p.source, row.external_id, row.fingerprint, id, c.card_id],
    );
    changed++;
  }
  await db.query(
    "update ns.imports set status='committed',committed_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [a.tenant_id, id],
  );
  await audit(db, a, id, "status_import.committed", why, {
    source: "import",
    rows: changed,
  });
  return { committed: true, changed };
}
