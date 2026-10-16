import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type { Sql, Actor } from "./db";
import { AccessError, uuid } from "./security";
import { text, integer } from "./grading";
import { csvRows } from "./grading-import";
import {
  consignmentFields,
  consignmentStates,
  type ConsignmentImportInput,
  type ConsignmentImportRow,
  type ConsignmentImport,
} from "../consignment";
import {
  consignmentWriter,
  consignmentReader,
  verifiedConsignor,
  sourceTime,
  pastDate,
  itemValues,
  consignmentItem,
  createConsignment,
  updateConsignment,
  consignmentAudit,
} from "./consignment";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Link = {
  item_id: string;
  customer_id: string;
  fingerprint: string;
  source_updated_at: string;
};
const getLink = async (db: Sql, a: Actor, source: string, external: string) =>
  (
    await db.query<Link>(
      "select item_id,customer_id,fingerprint,source_updated_at from ns.consignment_external_links where tenant_id=$1 and source=$2 and external_id=$3",
      [a.tenant_id, source, external],
    )
  ).rows[0];
function parseInput(v: Record<string, string>): ConsignmentImportInput {
  const input: Record<string, unknown> = {
    description: text(v.description, 500, true),
    state_key: text(v.state_key, 40, true),
    currency: v.currency,
    source_updated_at: sourceTime(v.source_updated_at),
  };
  if (v.currency !== "USD")
    throw new AccessError(400, "explicit_usd_currency_required");
  if (!Object.hasOwn(consignmentStates, v.state_key) || v.state_key === "paid")
    throw new AccessError(
      400,
      "unknown_status_or_paid_requires_settlement_records",
    );
  for (const k of ["customer_id", "item_id"]) if (v[k]) input[k] = uuid(v[k]);
  for (const k of ["asking_cents", "sale_cents", "fees_cents"])
    if (v[k]) {
      if (!/^[0-9]+$/.test(v[k]))
        throw new AccessError(400, "amounts_must_be_nonnegative_integer_cents");
      input[k] = integer(Number(v[k]), 0, 100000000);
    }
  if (v.received_date) input.received_date = pastDate(v.received_date);
  for (const k of [
    "channel",
    "provider_reference",
    "submission_reference",
    "listing_reference",
    "customer_notes",
  ])
    if (v[k]) input[k] = text(v[k], k === "customer_notes" ? 3000 : 200);
  return input as unknown as ConsignmentImportInput;
}
async function resolveRow(
  db: Sql,
  a: Actor,
  source: string,
  external: string,
  input: ConsignmentImportInput,
  fingerprint: string,
  chosen?: { item_id?: string; customer_id?: string },
) {
  const link = await getLink(db, a, source, external),
    target = link?.item_id || chosen?.item_id || input.item_id;
  if (
    link &&
    ((input.item_id && input.item_id !== link.item_id) ||
      (chosen?.item_id && chosen.item_id !== link.item_id) ||
      (input.customer_id && input.customer_id !== link.customer_id) ||
      (chosen?.customer_id && chosen.customer_id !== link.customer_id))
  )
    throw new AccessError(
      409,
      "approved_external_match_conflicts_no_rematching",
    );
  if (input.item_id && chosen?.item_id && input.item_id !== chosen.item_id)
    throw new AccessError(409, "explicit_item_id_conflict");
  if (
    input.customer_id &&
    chosen?.customer_id &&
    input.customer_id !== chosen.customer_id
  )
    throw new AccessError(409, "explicit_customer_id_conflict");
  if (target) {
    const item = await consignmentItem(db, a, target);
    if (input.customer_id && input.customer_id !== item.customer_id)
      throw new AccessError(409, "customer_and_item_match_conflict");
    if (chosen?.customer_id && chosen.customer_id !== item.customer_id)
      throw new AccessError(409, "customer_and_item_match_conflict");
    const common = {
      target_item_id: item.id,
      customer_id: item.customer_id,
      expected_version: item.version,
      current_snapshot: item,
    };
    if (link?.fingerprint === fingerprint)
      return {
        ...common,
        state: "duplicate",
        message:
          "Identical external record already applied; current corrections stay intact.",
      };
    if (
      (link &&
        Date.parse(input.source_updated_at) <=
          new Date(link.source_updated_at).getTime()) ||
      (item.source_updated_at &&
        Date.parse(input.source_updated_at) <
          new Date(item.source_updated_at).getTime())
    )
      throw new AccessError(409, "stale_or_conflicting_source_timestamp");
    const value = itemValues(
      { ...input, sale_evidence: "Pending staff CSV evidence review" },
      item,
    );
    if (
      item.settlement_count &&
      (value.sale_cents !== item.sale_cents ||
        value.fees_cents !== item.fees_cents)
    )
      throw new AccessError(
        409,
        "financial_correction_requires_settlement_review",
      );
    return {
      ...common,
      state: "ready",
      message:
        "Update this exact item after reviewing current values and changes.",
    };
  }
  const customer = chosen?.customer_id || input.customer_id;
  if (!customer)
    return {
      target_item_id: null,
      customer_id: null,
      expected_version: null,
      current_snapshot: null,
      state: "unmatched",
      message:
        "No approved customer match. Staff must select an exact verified account or existing item.",
    };
  await verifiedConsignor(db, a, customer);
  const value = itemValues({
    ...input,
    sale_evidence: "Pending staff CSV evidence review",
  });
  if (!value.received_date)
    throw new AccessError(400, "received_date_required_for_new_intake");
  return {
    target_item_id: null,
    customer_id: customer,
    expected_version: null,
    current_snapshot: null,
    state: "ready",
    message: "Create one physical item for this exact verified customer.",
  };
}
export async function previewConsignmentImport(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  consignmentWriter(a);
  const rows = csvRows(b.csv),
    headers = rows.shift()!,
    source = text(b.source, 80, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(source))
    throw new AccessError(400, "stable_source_name_required");
  if (!b.mapping || typeof b.mapping !== "object")
    throw new AccessError(400, "mapping_required");
  const mapping = b.mapping as Record<string, unknown>,
    id = randomUUID(),
    seen = new Set<string>();
  await db.query(
    "insert into ns.imports(tenant_id,id,source,actor_id,module) values($1,$2,$3,$4,'consignment')",
    [a.tenant_id, id, source, a.staff_id],
  );
  for (const [index, cells] of rows.entries()) {
    let external = "",
      input: unknown = {},
      fingerprint = "";
    let result: Record<string, unknown> = {
      target_item_id: null,
      customer_id: null,
      expected_version: null,
      current_snapshot: null,
    };
    try {
      const raw: Record<string, string> = {};
      for (const k of consignmentFields) {
        const h = mapping[k];
        if (typeof h !== "string" || (h && !headers.includes(h)))
          throw new AccessError(400, "mapped_column_missing");
        raw[k] = h ? cells[headers.indexOf(h)].trim() : "";
      }
      input = raw;
      external = text(raw.external_id, 120, true);
      if (!/^[a-zA-Z0-9_.:-]+$/.test(external) || seen.has(external))
        throw new AccessError(400, "external_id_invalid_or_repeated");
      seen.add(external);
      input = parseInput(raw);
      fingerprint = digest(input);
      result = await resolveRow(
        db,
        a,
        source,
        external,
        input as ConsignmentImportInput,
        fingerprint,
      );
    } catch (e) {
      result = {
        ...result,
        state:
          e instanceof AccessError && e.status === 409 ? "conflict" : "error",
        message: e instanceof AccessError ? e.code : "Invalid row.",
      };
    }
    await db.query(
      "insert into ns.consignment_import_rows(tenant_id,import_id,row_number,external_id,input,fingerprint,state,message,target_item_id,customer_id,expected_version,current_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        a.tenant_id,
        id,
        index + 2,
        external,
        JSON.stringify(input),
        fingerprint,
        result.state,
        result.message,
        result.target_item_id,
        result.customer_id,
        result.expected_version,
        JSON.stringify(result.current_snapshot),
      ],
    );
  }
  await consignmentAudit(
    db,
    a,
    id,
    "import.previewed",
    "Mapped spreadsheet saved for staff review",
  );
  return readConsignmentImport(db, a, id);
}
export async function readConsignmentImport(
  db: Sql,
  a: Actor,
  id: string,
): Promise<ConsignmentImport> {
  consignmentReader(a);
  if (a.customer_id) throw new AccessError(403, "staff_permission_required");
  const row = (
    await db.query<{ id: string; source: string; status: string }>(
      "select id,source,status from ns.imports where tenant_id=$1 and id=$2 and module='consignment'",
      [a.tenant_id, uuid(id)],
    )
  ).rows[0];
  if (!row) throw new AccessError(404, "import_not_found");
  return {
    ...row,
    rows: (
      await db.query<ConsignmentImportRow>(
        "select row_number,external_id,input,fingerprint,state,message,target_item_id,customer_id,expected_version,current_snapshot from ns.consignment_import_rows where tenant_id=$1 and import_id=$2 order by row_number",
        [a.tenant_id, id],
      )
    ).rows,
  };
}
export async function resolveConsignmentImport(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  consignmentWriter(a);
  const id = uuid(text(b.id, 36, true)),
    number = integer(b.row_number, 2, 101),
    reason = text(b.reason, 1000, true);
  await db.query(
    "select id from ns.imports where tenant_id=$1 and id=$2 and module='consignment' for update",
    [a.tenant_id, id],
  );
  const p = await readConsignmentImport(db, a, id),
    r = p.rows.find((r) => r.row_number === number);
  if (p.status !== "review" || !r || ["applied", "duplicate"].includes(r.state))
    throw new AccessError(409, "row_not_pending_review");
  if (b.reject === true) {
    await db.query(
      "update ns.consignment_import_rows set state='rejected',message='Explicitly rejected by staff; no item changes' where tenant_id=$1 and import_id=$2 and row_number=$3",
      [a.tenant_id, id, number],
    );
  } else {
    if (r.state !== "unmatched")
      throw new AccessError(
        409,
        "conflicting_or_invalid_rows_need_a_corrected_file",
      );
    if (b.confirm !== true)
      throw new AccessError(400, "explicit_match_confirmation_required");
    const chosen = {
      item_id: b.item_id ? uuid(text(b.item_id, 36, true)) : undefined,
      customer_id: b.customer_id
        ? uuid(text(b.customer_id, 36, true))
        : undefined,
    };
    if (!chosen.item_id && !chosen.customer_id)
      throw new AccessError(400, "choose_exact_verified_customer_or_item");
    const match = await resolveRow(
      db,
      a,
      p.source,
      r.external_id,
      r.input,
      r.fingerprint,
      chosen,
    );
    await db.query(
      "update ns.consignment_import_rows set state=$4,message=$5,target_item_id=$6,customer_id=$7,expected_version=$8,current_snapshot=$9 where tenant_id=$1 and import_id=$2 and row_number=$3",
      [
        a.tenant_id,
        id,
        number,
        match.state,
        match.message,
        match.target_item_id,
        match.customer_id,
        match.expected_version,
        JSON.stringify(match.current_snapshot),
      ],
    );
  }
  await consignmentAudit(
    db,
    a,
    id,
    b.reject ? "import.row_rejected" : "import.match_approved",
    reason,
    { row_number: number, customer_id: b.customer_id, item_id: b.item_id },
  );
  return readConsignmentImport(db, a, id);
}
export async function commitConsignmentImport(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  consignmentWriter(a);
  const id = uuid(text(b.id, 36, true)),
    reason = text(b.reason, 1000, true);
  if (b.confirm !== true)
    throw new AccessError(400, "reviewer_confirmation_required");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + ":consignment-import",
  ]);
  await db.query(
    "select id from ns.imports where tenant_id=$1 and id=$2 and module='consignment' for update",
    [a.tenant_id, id],
  );
  const p = await readConsignmentImport(db, a, id);
  if (p.status === "committed") return { committed: true, duplicate: true };
  if (
    p.status !== "review" ||
    p.rows.some((r) => ["unmatched", "conflict", "error"].includes(r.state))
  )
    throw new AccessError(409, "resolve_or_reject_all_review_rows_first");
  for (const row of p.rows) {
    if (["duplicate", "rejected"].includes(row.state)) continue;
    if (!row.customer_id) throw new AccessError(409, "customer_match_required");
    await verifiedConsignor(db, a, row.customer_id);
    const link = await getLink(db, a, p.source, row.external_id);
    if (link?.fingerprint === row.fingerprint) continue;
    let itemId = row.target_item_id;
    if (
      link &&
      (!itemId ||
        link.item_id !== itemId ||
        link.customer_id !== row.customer_id ||
        Date.parse(row.input.source_updated_at) <=
          new Date(link.source_updated_at).getTime())
    )
      throw new AccessError(409, "external_record_changed_build_new_preview");
    const input = {
      ...row.input,
      customer_id: row.customer_id,
      reason,
      sale_evidence: reason,
    };
    if (itemId) {
      const current = await consignmentItem(db, a, itemId, true);
      if (current.version !== row.expected_version)
        throw new AccessError(
          409,
          "item_changed_build_new_preview_and_review_corrections",
        );
      await updateConsignment(
        db,
        a,
        itemId,
        { ...input, version: row.expected_version },
        "reviewed_csv",
      );
    } else
      itemId = (
        await createConsignment(
          db,
          a,
          { ...input, request_id: randomUUID() },
          "reviewed_csv",
        )
      ).id;
    await db.query(
      "insert into ns.consignment_external_links(tenant_id,source,external_id,item_id,customer_id,fingerprint,source_updated_at,staff_id) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(tenant_id,source,external_id) do update set fingerprint=excluded.fingerprint,source_updated_at=excluded.source_updated_at,staff_id=excluded.staff_id",
      [
        a.tenant_id,
        p.source,
        row.external_id,
        itemId,
        row.customer_id,
        row.fingerprint,
        row.input.source_updated_at,
        a.staff_id,
      ],
    );
    await db.query(
      "update ns.consignment_import_rows set state='applied',target_item_id=$4,message='Applied after staff review' where tenant_id=$1 and import_id=$2 and row_number=$3",
      [a.tenant_id, id, row.row_number, itemId],
    );
  }
  await db.query(
    "update ns.imports set status='committed',committed_at=now() where tenant_id=$1 and id=$2",
    [a.tenant_id, id],
  );
  await consignmentAudit(db, a, id, "import.committed", reason);
  return { committed: true };
}
