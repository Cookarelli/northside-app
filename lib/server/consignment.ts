import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, Actor } from "./db";
import { requireRole } from "./db";
import { AccessError, uuid, csvCell } from "./security";
import { text, integer } from "./grading";
import {
  consignmentStates,
  type ConsignmentItem,
  type ConsignmentData,
  type ConsignmentDetail,
  type ConsignmentState,
  type ConsignmentSettlement,
} from "../consignment";
import {
  fanaticsHealth,
  type FanaticsCollectAdapter,
} from "./fanatics-collect";
export const consignmentWriter = (a: Actor) =>
  requireRole(a, ["owner", "admin", "operations"]);
export const consignmentReader = (a: Actor) => {
  if (!a.customer_id)
    requireRole(a, ["owner", "admin", "operations", "read_only"]);
};
export function cents(v: unknown): number | null {
  if (v === null || v === "") return null;
  return integer(v, 0, 100000000);
}
export function pastDate(v: unknown): string {
  const s = text(v, 10, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s ||
    Date.parse(s) > Date.now()
  )
    throw new AccessError(400, "valid_received_or_reference_date_required");
  return s;
}
export function sourceTime(v: unknown): string {
  const s = text(v, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    Date.parse(s) > Date.now()
  )
    throw new AccessError(400, "valid_past_source_timestamp_required");
  pastDate(s.slice(0, 10));
  return new Date(s).toISOString();
}
export async function verifiedConsignor(db: Sql, a: Actor, id: string) {
  const r = (
    await db.query<{ ok: boolean }>(
      "select ns.grading_verified(tenant_id,id) as ok from ns.customers where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(id)],
    )
  ).rows[0];
  if (!r?.ok)
    throw new AccessError(
      400,
      "verified_customer_id_required_no_email_matching",
    );
}
export async function consignmentReason(
  db: Sql,
  reason: unknown,
  source = "northside",
) {
  await db.query(
    "select set_config('ns.consignment_reason',$1,true),set_config('ns.consignment_source',$2,true)",
    [text(reason, 1000, true), source],
  );
}
export async function consignmentAudit(
  db: Sql,
  a: Actor,
  id: string,
  action: string,
  reason: string,
  after: unknown = null,
) {
  await db.query(
    "insert into ns.consignment_audit(tenant_id,object_id,staff_id,action,reason,after_record) values($1,$2,$3,$4,$5,$6)",
    [
      a.tenant_id,
      id,
      a.staff_id,
      action,
      text(reason, 1000, true),
      JSON.stringify(after),
    ],
  );
}
const fields =
  "i.id,i.card_id,i.case_id,i.customer_id,c.description,i.provider_reference,i.submission_reference,i.listing_reference,i.received_date,i.channel,i.asking_cents,i.sale_cents,i.sale_verified_at,i.fees_cents,i.currency,i.state_key,i.payout_status,i.customer_notes,i.version,i.updated_at,i.source_updated_at";
const join =
  "from ns.consignment_items i join ns.card_items c on c.tenant_id=i.tenant_id and c.id=i.card_id";
function condition(a: Actor) {
  return a.customer_id ? "and i.customer_id=$2" : "";
}
export async function settlementSummary(db: Sql, a: Actor, id: string) {
  const r = (
    await db.query<{ amount: string; active: string }>(
      "select coalesce(sum(s.amount_cents),0)::text as amount,count(*) filter(where s.reverses_id is null and not exists(select from ns.consignment_settlements x where x.tenant_id=s.tenant_id and x.reverses_id=s.id))::text as active from ns.consignment_settlements s where tenant_id=$1 and item_id=$2",
      [a.tenant_id, id],
    )
  ).rows[0];
  return {
    settled_cents: Number(r.amount),
    settlement_count: Number(r.active),
  };
}
async function financial(
  db: Sql,
  a: Actor,
  i: ConsignmentItem,
): Promise<ConsignmentItem> {
  const s = await settlementSummary(db, a, i.id),
    net =
      i.sale_verified_at && i.sale_cents !== null && i.fees_cents !== null
        ? i.sale_cents - i.fees_cents
        : null;
  return {
    ...i,
    ...s,
    net_cents: net,
    payout_status:
      s.settlement_count > 0
        ? net !== null && s.settled_cents === net
          ? "paid"
          : "partial"
        : i.sale_verified_at
          ? "awaiting_settlement"
          : "unknown",
  };
}
export async function consignmentItem(
  db: Sql,
  a: Actor,
  id: string,
  lock = false,
) {
  consignmentReader(a);
  uuid(id);
  const i = (
    await db.query<ConsignmentItem>(
      `select ${fields} ${join} where i.tenant_id=$1 ${condition(a)} and i.id=$${a.customer_id ? 3 : 2} ${lock ? "for update of i" : ""}`,
      a.customer_id ? [a.tenant_id, a.customer_id, id] : [a.tenant_id, id],
    )
  ).rows[0];
  if (!i) throw new AccessError(404, "consignment_item_not_found");
  return financial(db, a, i);
}
export async function consignmentItems(db: Sql, a: Actor) {
  consignmentReader(a);
  const rows = (
    await db.query<ConsignmentItem>(
      `select ${fields} ${join} where i.tenant_id=$1 ${condition(a)} order by i.updated_at desc,i.id limit 300`,
      a.customer_id ? [a.tenant_id, a.customer_id] : [a.tenant_id],
    )
  ).rows;
  const result: ConsignmentItem[] = [];
  for (const i of rows) result.push(await financial(db, a, i));
  return result;
}
export async function consignmentDashboard(
  db: Sql,
  a: Actor,
  adapter?: FanaticsCollectAdapter,
): Promise<ConsignmentData> {
  const items = await consignmentItems(db, a),
    staff = !a.customer_id;
  return {
    items,
    mode: staff ? "staff" : "customer",
    role: a.staff_role,
    customers: staff
      ? (
          await db.query<ConsignmentData["customers"][number]>(
            "select id,display_name,ns.grading_verified(tenant_id,id) as verified from ns.customers where tenant_id=$1 order by display_name,id limit 500",
            [a.tenant_id],
          )
        ).rows
      : [],
    imports: staff
      ? (
          await db.query<ConsignmentData["imports"][number]>(
            "select id,source,status,created_at from ns.imports where tenant_id=$1 and module='consignment' order by created_at desc limit 50",
            [a.tenant_id],
          )
        ).rows
      : [],
    review_count: staff
      ? Number(
          (
            await db.query<{ n: string }>(
              "select count(*)::text n from ns.consignment_import_rows where tenant_id=$1 and state in ('unmatched','conflict','error')",
              [a.tenant_id],
            )
          ).rows[0].n,
        )
      : 0,
    integration: await fanaticsHealth(adapter),
  };
}
export async function consignmentDetail(
  db: Sql,
  a: Actor,
  id: string,
): Promise<ConsignmentDetail> {
  const item = await consignmentItem(db, a, id);
  return {
    item,
    events: (
      await db.query<ConsignmentDetail["events"][number]>(
        "select id,label,source,created_at from ns.consignment_events where tenant_id=$1 and item_id=$2 order by created_at,id",
        [a.tenant_id, id],
      )
    ).rows,
    settlements: (
      await db.query<ConsignmentSettlement>(
        "select id,amount_cents,reference,recorded_date,currency,source,reverses_id,created_at from ns.consignment_settlements where tenant_id=$1 and item_id=$2 order by created_at,id",
        [a.tenant_id, id],
      )
    ).rows,
    files: (
      await db.query<ConsignmentDetail["files"][number]>(
        "select id,mime_type from ns.file_objects where tenant_id=$1 and card_id=$2 and ready",
        [a.tenant_id, item.card_id],
      )
    ).rows,
  };
}
const editableText = [
  "provider_reference",
  "submission_reference",
  "listing_reference",
  "channel",
  "customer_notes",
] as const;
export function itemValues(b: Record<string, unknown>, old?: ConsignmentItem) {
  const value = (k: string, fallback: unknown) =>
    b[k] === undefined ? fallback : b[k];
  if (value("currency", old?.currency) !== "USD")
    throw new AccessError(400, "explicit_usd_currency_required");
  const state = text(
    value("state_key", old?.state_key ?? "received"),
    40,
    true,
  ) as ConsignmentState;
  if (!Object.hasOwn(consignmentStates, state))
    throw new AccessError(400, "unknown_consignment_status");
  const amounts = {
    asking_cents: cents(value("asking_cents", old?.asking_cents ?? null)),
    sale_cents: cents(value("sale_cents", old?.sale_cents ?? null)),
    fees_cents: cents(value("fees_cents", old?.fees_cents ?? null)),
  };
  const saleChanged = amounts.sale_cents !== old?.sale_cents;
  if (amounts.sale_cents !== null && (saleChanged || !old?.sale_verified_at))
    text(b.sale_evidence, 1000, true);
  if (
    ["sold", "awaiting_settlement", "paid"].includes(state) &&
    amounts.sale_cents === null
  )
    throw new AccessError(400, "verified_sale_required_for_status");
  const other = Object.fromEntries(
    editableText.map((k) => [
      k,
      text(value(k, old?.[k] ?? ""), k === "customer_notes" ? 3000 : 200),
    ]),
  ) as Record<(typeof editableText)[number], string>;
  const received = value(
    "received_date",
    old?.received_date
      ? new Date(old.received_date).toISOString().slice(0, 10)
      : undefined,
  );
  return {
    ...other,
    ...amounts,
    state_key: state,
    received_date: received ? pastDate(received) : null,
    sale_verified_at:
      amounts.sale_cents === null
        ? null
        : saleChanged || !old?.sale_verified_at
          ? new Date().toISOString()
          : old.sale_verified_at,
    source_updated_at: b.source_updated_at
      ? sourceTime(b.source_updated_at)
      : (old?.source_updated_at ?? null),
  };
}
export async function createConsignment(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
  source = "northside",
) {
  consignmentWriter(a);
  const customer = uuid(text(b.customer_id, 36, true)),
    request = uuid(text(b.request_id, 36, true));
  await verifiedConsignor(db, a, customer);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + ":consignment-create:" + request,
  ]);
  const old = (
    await db.query<{ id: string; customer_id: string }>(
      "select id,customer_id from ns.consignment_items where tenant_id=$1 and request_id=$2",
      [a.tenant_id, request],
    )
  ).rows[0];
  if (old) {
    if (old.customer_id !== customer)
      throw new AccessError(409, "intake_request_conflict");
    return { id: old.id, duplicate: true };
  }
  const v = itemValues(b);
  if (v.state_key === "paid")
    throw new AccessError(
      400,
      "settlement_reference_required_not_a_status_shortcut",
    );
  const description = text(b.description, 500, true);
  if (!v.received_date) throw new AccessError(400, "received_date_required");
  const id = randomUUID(),
    card = randomUUID(),
    caseId = randomUUID();
  await consignmentReason(db, b.reason, source);
  await db.query(
    "insert into ns.service_cases(tenant_id,id,customer_id,kind) values($1,$2,$3,'consignment')",
    [a.tenant_id, caseId, customer],
  );
  await db.query(
    "insert into ns.card_items(tenant_id,id,customer_id,case_id,description) values($1,$2,$3,$4,$5)",
    [a.tenant_id, card, customer, caseId, description],
  );
  await db.query(
    "insert into ns.consignment_items(tenant_id,id,card_id,case_id,customer_id,request_id,state_key,received_date,channel,asking_cents,sale_cents,sale_verified_at,fees_cents,currency,provider_reference,submission_reference,listing_reference,customer_notes,source_updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'USD',$14,$15,$16,$17,$18)",
    [
      a.tenant_id,
      id,
      card,
      caseId,
      customer,
      request,
      v.state_key,
      v.received_date,
      v.channel,
      v.asking_cents,
      v.sale_cents,
      v.sale_verified_at,
      v.fees_cents,
      v.provider_reference,
      v.submission_reference,
      v.listing_reference,
      v.customer_notes,
      v.source_updated_at,
    ],
  );
  if (b.sale_evidence)
    await consignmentAudit(
      db,
      a,
      id,
      "sale.evidence",
      text(b.sale_evidence, 1000, true),
    );
  return { id, case_id: caseId, duplicate: false };
}
export async function updateConsignment(
  db: Sql,
  a: Actor,
  id: string,
  b: Record<string, unknown>,
  source = "northside",
) {
  consignmentWriter(a);
  const old = await consignmentItem(db, a, id, true);
  if (old.version !== integer(b.version, 1, 100000000))
    throw new AccessError(409, "record_changed_refresh_and_review");
  if (b.customer_id !== undefined && b.customer_id !== old.customer_id)
    throw new AccessError(409, "ownership_cannot_be_reassigned");
  const v = itemValues(b, old);
  if (
    old.settlement_count &&
    (v.sale_cents !== old.sale_cents || v.fees_cents !== old.fees_cents)
  )
    throw new AccessError(
      409,
      "reverse_recorded_settlements_before_financial_correction",
    );
  if (v.state_key === "paid" && old.payout_status !== "paid")
    throw new AccessError(
      409,
      "settlement_reference_required_not_a_status_shortcut",
    );
  if (
    b.source_updated_at &&
    old.source_updated_at &&
    Date.parse(String(v.source_updated_at)) <
      new Date(old.source_updated_at).getTime()
  )
    throw new AccessError(409, "stale_source_record");
  if (b.description !== undefined && b.description !== old.description) {
    const description = text(b.description, 500, true);
    await db.query(
      "update ns.card_items set description=$3 where tenant_id=$1 and id=$2",
      [a.tenant_id, old.card_id, description],
    );
    await consignmentAudit(
      db,
      a,
      id,
      "description.corrected",
      text(b.reason, 1000, true),
      { previous_description: old.description, description },
    );
  }
  await consignmentReason(db, b.reason, source);
  await db.query(
    "update ns.consignment_items set state_key=$3,received_date=$4,channel=$5,asking_cents=$6,sale_cents=$7,sale_verified_at=$8,fees_cents=$9,provider_reference=$10,submission_reference=$11,listing_reference=$12,customer_notes=$13,source_updated_at=$14,version=version+1,updated_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [
      a.tenant_id,
      id,
      v.state_key,
      v.received_date,
      v.channel,
      v.asking_cents,
      v.sale_cents,
      v.sale_verified_at,
      v.fees_cents,
      v.provider_reference,
      v.submission_reference,
      v.listing_reference,
      v.customer_notes,
      v.source_updated_at,
    ],
  );
  if (b.sale_evidence)
    await consignmentAudit(
      db,
      a,
      id,
      "sale.evidence",
      text(b.sale_evidence, 1000, true),
    );
  return { updated: true };
}
export async function recordSettlement(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  consignmentWriter(a);
  const id = uuid(text(b.item_id, 36, true)),
    old = await consignmentItem(db, a, id, true),
    reason = text(b.reason, 1000, true);
  if (old.version !== integer(b.version, 1, 100000000))
    throw new AccessError(409, "record_changed_refresh_and_review");
  if (b.currency !== "USD")
    throw new AccessError(400, "explicit_usd_currency_required");
  const reference = text(b.reference, 200, true),
    date = pastDate(b.recorded_date),
    entry = randomUUID();
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + ":consignment-settlement:" + reference,
  ]);
  if (
    (
      await db.query(
        "select id from ns.consignment_settlements where tenant_id=$1 and reference=$2",
        [a.tenant_id, reference],
      )
    ).rows.length
  )
    throw new AccessError(409, "settlement_reference_already_recorded");
  let amount: number,
    reverses: string | null = null;
  if (b.reverses_id) {
    reverses = uuid(text(b.reverses_id, 36, true));
    const original = (
      await db.query<{ amount_cents: number; reverses_id: string | null }>(
        "select amount_cents,reverses_id from ns.consignment_settlements where tenant_id=$1 and item_id=$2 and id=$3",
        [a.tenant_id, id, reverses],
      )
    ).rows[0];
    if (!original || original.reverses_id)
      throw new AccessError(400, "original_settlement_required");
    if (
      (
        await db.query(
          "select id from ns.consignment_settlements where tenant_id=$1 and reverses_id=$2",
          [a.tenant_id, reverses],
        )
      ).rows.length
    )
      throw new AccessError(409, "settlement_already_reversed");
    amount = -original.amount_cents;
  } else {
    amount = integer(b.amount_cents, 0, 100000000);
    if (old.net_cents === null || old.net_cents < 0)
      throw new AccessError(409, "verified_sale_and_known_fees_required");
    if (
      old.settled_cents + amount > old.net_cents ||
      (amount === 0 && (old.net_cents !== 0 || old.settlement_count))
    )
      throw new AccessError(
        409,
        "settlement_exceeds_remaining_net_or_zero_is_not_due",
      );
  }
  await db.query(
    "insert into ns.consignment_settlements(tenant_id,id,item_id,customer_id,amount_cents,reference,recorded_date,currency,source,reverses_id) values($1,$2,$3,$4,$5,$6,$7,'USD','northside',$8)",
    [
      a.tenant_id,
      entry,
      id,
      old.customer_id,
      amount,
      reference,
      date,
      reverses,
    ],
  );
  const summary = await settlementSummary(db, a, id),
    paid =
      summary.settlement_count > 0 &&
      old.net_cents !== null &&
      summary.settled_cents === old.net_cents;
  await consignmentReason(db, reason);
  await db.query(
    "update ns.consignment_items set state_key=$3,payout_status=$4,version=version+1,updated_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [
      a.tenant_id,
      id,
      paid ? "paid" : "awaiting_settlement",
      paid
        ? "paid"
        : summary.settlement_count
          ? "partial"
          : "awaiting_settlement",
    ],
  );
  await consignmentAudit(
    db,
    a,
    id,
    reverses ? "settlement.reversed" : "settlement.recorded",
    reason,
    { entry_id: entry, reference, reverses_id: reverses },
  );
  return { recorded: true };
}
export async function consignmentExport(db: Sql, a: Actor) {
  const rows = await consignmentItems(db, a);
  return (
    [
      "item_id,intake_id,description,status,currency,asking_cents,verified_sold_cents,fees_cents,estimated_net_cents,settlement_status,recorded_settlement_cents,source,last_updated",
      ...rows.map((i) =>
        [
          i.id,
          i.case_id,
          i.description,
          consignmentStates[i.state_key],
          i.currency,
          i.asking_cents,
          i.sale_verified_at ? i.sale_cents : null,
          i.fees_cents,
          i.net_cents,
          i.payout_status,
          i.settlement_count ? i.settled_cents : null,
          "Northside recorded",
          i.updated_at,
        ]
          .map((v) => csvCell(v === null ? "" : String(v)))
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
