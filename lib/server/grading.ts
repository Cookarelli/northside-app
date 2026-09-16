import { customerMetric } from "./measurement";
import "server-only";
import { randomUUID } from "node:crypto";
import type {
  GradingCard,
  GradingData,
  GradingDetail,
  IntakeInput,
} from "../grading";
import { type Actor, type Sql, requireCustomer, requireRole } from "./db";
import {
  AccessError,
  uuid,
  opaqueToken,
  hashToken,
  validToken,
  csvCell,
} from "./security";
import { SHOP } from "./providers";
const writers = ["owner", "admin", "operations"] as const;
export function gradingWriter(actor: Actor) {
  requireRole(actor, [...writers]);
}
export function text(value: unknown, max: number, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new AccessError(400, "invalid_text_field");
  return value.trim();
}
export function integer(value: unknown, min = 1, max = 50) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new AccessError(400, "invalid_number");
  return value;
}
export async function reasonOn(db: Sql, value: unknown, source = "northside") {
  await db.query(
    "select set_config('ns.grading_reason',$1,true),set_config('ns.grading_source',$2,true)",
    [text(value, 1000, true), source],
  );
}
export async function audit(
  db: Sql,
  actor: Actor,
  object: string,
  action: string,
  reason: string,
  after: unknown = null,
) {
  await db.query(
    "insert into ns.grading_audit(tenant_id,object_id,staff_id,customer_actor_id,action,reason,after_record) values($1,$2,$3,$4,$5,$6,$7)",
    [
      actor.tenant_id,
      object,
      actor.staff_id,
      actor.customer_id,
      action,
      text(reason, 1000, true),
      JSON.stringify(after),
    ],
  );
}
export function intakeInput(value: unknown): IntakeInput {
  if (!value || typeof value !== "object")
    throw new AccessError(400, "intake_required");
  const v = value as Record<string, unknown>;
  return {
    customer_id: uuid(text(v.customer_id, 36, true)),
    description: text(v.description, 500, true),
    quantity: integer(v.quantity),
    sport: text(v.sport ?? "", 80),
    year: text(v.year ?? "", 12),
    manufacturer: text(v.manufacturer ?? "", 100),
    card_set: text(v.card_set ?? "", 150),
    card_number: text(v.card_number ?? "", 80),
    parallel: text(v.parallel ?? "", 100),
  };
}
export async function gradingSettings(db: Sql, actor: Actor) {
  const value = (
    await db.query<GradingData["settings"]>(
      "select examination_cents,version from ns.grading_settings where tenant_id=$1",
      [actor.tenant_id],
    )
  ).rows[0];
  if (!value) throw new AccessError(503, "grading_not_configured");
  return value;
}
export async function customerExists(db: Sql, actor: Actor, id: string) {
  const row = (
    await db.query("select id from ns.customers where tenant_id=$1 and id=$2", [
      actor.tenant_id,
      uuid(id),
    ])
  ).rows[0];
  if (!row)
    throw new AccessError(400, "customer_id_not_found_no_email_matching");
}
const projection =
  "g.*,c.description,c.batch_id,s.label,i.examination_cents,i.voided_at";
const joins =
  "from ns.grading_cards g join ns.card_items c on c.tenant_id=g.tenant_id and c.id=g.card_id join ns.grading_states s on s.tenant_id=g.tenant_id and s.key=g.status_key join ns.grading_intakes i on i.tenant_id=g.tenant_id and i.case_id=g.case_id";
function scope(actor: Actor) {
  return actor.customer_id
    ? "and (g.customer_id=$2 or exists(select from ns.grading_claim_requests r where r.tenant_id=g.tenant_id and r.case_id=g.case_id and r.verified_customer_id=$2 and r.status='approved'))"
    : "";
}
export async function gradingCards(db: Sql, actor: Actor) {
  if (!actor.customer_id) requireRole(actor, [...writers, "read_only"]);
  return (
    await db.query<GradingCard>(
      `select ${projection} ${joins} where g.tenant_id=$1 ${scope(actor)} order by c.created_at desc,c.id limit 500`,
      actor.customer_id
        ? [actor.tenant_id, actor.customer_id]
        : [actor.tenant_id],
    )
  ).rows;
}
export async function gradingCard(
  db: Sql,
  actor: Actor,
  id: string,
  lock = false,
) {
  uuid(id);
  if (!actor.customer_id) requireRole(actor, [...writers, "read_only"]);
  const row = (
    await db.query<GradingCard>(
      `select ${projection} ${joins} where g.tenant_id=$1 ${scope(actor)} and g.card_id=$${actor.customer_id ? 3 : 2} ${lock ? "for update of g" : ""}`,
      actor.customer_id
        ? [actor.tenant_id, actor.customer_id, id]
        : [actor.tenant_id, id],
    )
  ).rows[0];
  if (!row) throw new AccessError(404, "grading_card_not_found");
  return row;
}
export async function gradingDashboard(
  db: Sql,
  actor: Actor,
): Promise<GradingData> {
  const cards = await gradingCards(db, actor),
    staff = !actor.customer_id;
  return {
    cards,
    mode: staff ? "staff" : "customer",
    role: actor.staff_role,
    settings: await gradingSettings(db, actor),
    states: (
      await db.query<GradingData["states"][number]>(
        "select key,label,enabled from ns.grading_states where tenant_id=$1 order by position",
        [actor.tenant_id],
      )
    ).rows,
    providers: staff
      ? (
          await db.query<GradingData["providers"][number]>(
            "select key,label,confirmed from ns.grading_providers where tenant_id=$1 order by key",
            [actor.tenant_id],
          )
        ).rows
      : [],
    customers: staff
      ? (
          await db.query<GradingData["customers"][number]>(
            "select id,display_name,ns.grading_verified(tenant_id,id) as verified from ns.customers where tenant_id=$1 order by display_name,id limit 500",
            [actor.tenant_id],
          )
        ).rows
      : [],
    batches: staff
      ? (
          await db.query<GradingData["batches"][number]>(
            "select id,reference,provider,carrier,tracking,version from ns.grading_batches where tenant_id=$1 order by created_at desc limit 100",
            [actor.tenant_id],
          )
        ).rows
      : [],
    imports: staff
      ? (
          await db.query<GradingData["imports"][number]>(
            "select id,source,status,created_at from ns.imports where tenant_id=$1 and module='grading' order by created_at desc limit 50",
            [actor.tenant_id],
          )
        ).rows
      : [],
    claims: (
      await db.query<GradingData["claims"][number]>(
        `select id,case_id,verified_customer_id,status from ns.grading_claim_requests where tenant_id=$1 ${staff ? "" : "and verified_customer_id=$2"} order by created_at desc limit 100`,
        staff ? [actor.tenant_id] : [actor.tenant_id, actor.customer_id],
      )
    ).rows,
  };
}
export async function gradingDetail(
  db: Sql,
  actor: Actor,
  id: string,
): Promise<GradingDetail> {
  const card = await gradingCard(db, actor, id);
  if (actor.customer_id === card.customer_id)
    await customerMetric(db, actor, "grading_status_view", id);
  return {
    card,
    intake_card_count: Number(
      (
        await db.query<{ count: string }>(
          "select count(*) from ns.grading_cards where tenant_id=$1 and case_id=$2",
          [actor.tenant_id, card.case_id],
        )
      ).rows[0].count,
    ),
    events: (
      await db.query<GradingDetail["events"][number]>(
        "select id,label,source,created_at from ns.grading_events where tenant_id=$1 and card_id=$2 order by created_at,id",
        [actor.tenant_id, id],
      )
    ).rows,
    files: (
      await db.query<GradingDetail["files"][number]>(
        "select id,mime_type from ns.file_objects where tenant_id=$1 and card_id=$2 and ready",
        [actor.tenant_id, id],
      )
    ).rows,
    payments: (
      await db.query<GradingDetail["payments"][number]>(
        `select id,source,recorded_date,amount_cents${actor.customer_id ? "" : ",reference"} from ns.grading_payments where tenant_id=$1 and case_id=$2 order by created_at`,
        [actor.tenant_id, card.case_id],
      )
    ).rows,
  };
}
export async function createIntake(
  db: Sql,
  actor: Actor,
  value: unknown,
  requestId: string,
  reason: string,
  importId: string | null = null,
) {
  gradingWriter(actor);
  uuid(requestId);
  const input = intakeInput(value);
  await customerExists(db, actor, input.customer_id);
  const prior = (
    await db.query<{ case_id: string; customer_id: string }>(
      "select case_id,customer_id from ns.grading_intakes where tenant_id=$1 and request_id=$2",
      [actor.tenant_id, requestId],
    )
  ).rows[0];
  if (prior) {
    if (prior.customer_id !== input.customer_id)
      throw new AccessError(409, "intake_request_conflict");
    return { case_id: prior.case_id, duplicate: true };
  }
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    actor.tenant_id + ":grading-settings",
  ]);
  const settings = await gradingSettings(db, actor),
    caseId = randomUUID();
  await reasonOn(db, reason, importId ? "import" : "northside");
  await db.query(
    "insert into ns.service_cases(tenant_id,id,customer_id,kind) values($1,$2,$3,'grading')",
    [actor.tenant_id, caseId, input.customer_id],
  );
  await db.query(
    "insert into ns.grading_intakes(tenant_id,case_id,customer_id,examination_cents,settings_version,request_id,import_id) values($1,$2,$3,$4,$5,$6,$7)",
    [
      actor.tenant_id,
      caseId,
      input.customer_id,
      settings.examination_cents,
      settings.version,
      requestId,
      importId,
    ],
  );
  for (let n = 0; n < input.quantity; n++) {
    const cardId = randomUUID();
    await db.query(
      "insert into ns.card_items(tenant_id,id,customer_id,case_id,description) values($1,$2,$3,$4,$5)",
      [actor.tenant_id, cardId, input.customer_id, caseId, input.description],
    );
    await db.query(
      "insert into ns.grading_cards(tenant_id,card_id,case_id,customer_id,sport,year,manufacturer,card_set,card_number,parallel) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        actor.tenant_id,
        cardId,
        caseId,
        input.customer_id,
        input.sport,
        input.year,
        input.manufacturer,
        input.card_set,
        input.card_number,
        input.parallel,
      ],
    );
  }
  return {
    case_id: caseId,
    duplicate: false,
    subtotal_cents: settings.examination_cents * input.quantity,
  };
}
export async function updateGradingCard(
  db: Sql,
  actor: Actor,
  id: string,
  body: Record<string, unknown>,
  source = "northside",
) {
  gradingWriter(actor);
  const card = await gradingCard(db, actor, id, true);
  if (card.voided_at || card.version !== integer(body.version, 1, 100000000))
    throw new AccessError(409, "record_changed_refresh_required");
  const status = text(body.status_key, 40, true);
  if (
    !(
      await db.query(
        "select key from ns.grading_states where tenant_id=$1 and key=$2 and enabled",
        [actor.tenant_id, status],
      )
    ).rows[0]
  )
    throw new AccessError(409, "status_disabled_or_unknown");
  const fields = [
    "findings",
    "customer_notes",
    "result",
    "certificate",
  ] as const;
  const values = fields.map((k) =>
    body[k] === undefined
      ? card[k]
      : text(body[k], k === "certificate" ? 120 : 3000),
  );
  await reasonOn(db, body.reason, source);
  await db.query(
    "update ns.grading_cards set status_key=$3,findings=$4,customer_notes=$5,result=$6,certificate=$7,version=version+1,updated_at=clock_timestamp() where tenant_id=$1 and card_id=$2",
    [actor.tenant_id, id, status, ...values],
  );
  return { updated: true };
}
export async function decide(
  db: Sql,
  actor: Actor,
  id: string,
  body: Record<string, unknown>,
) {
  requireCustomer(actor);
  await gradingCard(db, actor, id);
  const choice = body.choice;
  if (choice !== "submit" && choice !== "return")
    throw new AccessError(400, "invalid_decision");
  await db.query("select ns.grading_decide($1,$2,$3,$4)", [
    uuid(id),
    integer(body.version, 1, 100000000),
    choice,
    uuid(text(body.request_id, 36, true)),
  ]);
  return { recorded: true };
}
export async function claimCode(
  db: Sql,
  actor: Actor,
  caseId: string,
  reason: string,
) {
  gradingWriter(actor);
  uuid(caseId);
  const intake = (
    await db.query(
      "select case_id from ns.grading_intakes where tenant_id=$1 and case_id=$2 and voided_at is null and not ns.grading_verified(tenant_id,customer_id) for update",
      [actor.tenant_id, caseId],
    )
  ).rows[0];
  if (!intake) throw new AccessError(409, "claim_not_available_for_intake");
  const token = opaqueToken();
  await db.query(
    "insert into ns.grading_claim_tokens(tenant_id,case_id,token_hash,expires_at) values($1,$2,$3,now()+interval '7 days') on conflict(tenant_id,case_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at",
    [actor.tenant_id, caseId, hashToken(token)],
  );
  await audit(db, actor, caseId, "claim.code_issued", reason);
  return { code: token };
}
export async function requestClaim(db: Sql, actor: Actor, token: unknown) {
  requireCustomer(actor);
  if (!validToken(token)) throw new AccessError(400, "claim_code_invalid");
  await db.query("select ns.grading_request_claim($1)", [hashToken(token)]);
  return {
    requested: true,
    message:
      "Staff must independently verify the intake receipt and your identity before granting access.",
  };
}
export async function reviewClaim(
  db: Sql,
  actor: Actor,
  body: Record<string, unknown>,
) {
  gradingWriter(actor);
  const id = uuid(text(body.id, 36, true)),
    why = text(body.reason, 1000, true);
  const r = (
    await db.query<{
      case_id: string;
      verified_customer_id: string;
      status: string;
    }>(
      "select case_id,verified_customer_id,status from ns.grading_claim_requests where tenant_id=$1 and id=$2 for update",
      [actor.tenant_id, id],
    )
  ).rows[0];
  if (!r || r.status !== "pending")
    throw new AccessError(409, "claim_already_reviewed_or_missing");
  if (
    !(
      await db.query(
        "select case_id from ns.grading_intakes where tenant_id=$1 and case_id=$2 and voided_at is null and not ns.grading_verified(tenant_id,customer_id) for update",
        [actor.tenant_id, r.case_id],
      )
    ).rows[0]
  )
    throw new AccessError(409, "claim_not_available");
  if (body.approve === true) {
    if (
      ![
        "receipt_and_in_person_identity",
        "receipt_and_verified_callback",
      ].includes(String(body.evidence))
    )
      throw new AccessError(400, "independent_identity_evidence_required");
    if (
      !(
        await db.query<{ ok: boolean }>(
          "select ns.grading_verified($1,$2) as ok",
          [actor.tenant_id, r.verified_customer_id],
        )
      ).rows[0]?.ok
    )
      throw new AccessError(409, "customer_not_verified");
  }
  await db.query(
    "update ns.grading_claim_requests set status=$3,evidence=$4 where tenant_id=$1 and id=$2",
    [
      actor.tenant_id,
      id,
      body.approve === true ? "approved" : "denied",
      String(body.evidence || "denied"),
    ],
  );
  await audit(db, actor, r.case_id, "claim.reviewed", why, {
    request_id: id,
    approved: body.approve === true,
  });
  return { reviewed: true };
}
export async function gradingExport(db: Sql, actor: Actor) {
  const rows = await gradingCards(db, actor);
  return (
    [
      "card_id,case_id,description,sport,year,manufacturer,set,card_number,parallel,status,examination_cents,currency,recorded_source",
      ...rows.map((c) =>
        [
          c.card_id,
          c.case_id,
          c.description,
          c.sport,
          c.year,
          c.manufacturer,
          c.card_set,
          c.card_number,
          c.parallel,
          c.label,
          c.examination_cents,
          "USD",
          "Northside recorded",
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export async function payment(
  db: Sql,
  actor: Actor,
  body: Record<string, unknown>,
) {
  gradingWriter(actor);
  const card = await gradingCard(
    db,
    actor,
    uuid(text(body.card_id, 36, true)),
    true,
  );
  if (card.voided_at) throw new AccessError(409, "intake_reversed");
  const source = body.source,
    reference = text(body.reference, 200, true),
    date = text(body.recorded_date, 10, true),
    why = text(body.reason, 1000, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    Date.parse(date) > Date.now()
  )
    throw new AccessError(400, "valid_past_payment_date_required");
  let amount: number | null = null;
  if (source === "shopify_order_link") {
    if (!/^gid:\/\/shopify\/Order\/[0-9]+$/.test(reference))
      throw new AccessError(400, "shopify_order_id_required");
    const owned = (
      await db.query(
        "select o.order_id from ns.shopify_orders o join ns.shopify_customers c on c.tenant_id=o.tenant_id and c.shop=o.shop and c.shopify_id=o.shopify_customer_id where o.tenant_id=$1 and (c.customer_id=$2 or exists(select from ns.grading_claim_requests r where r.tenant_id=o.tenant_id and r.case_id=$5 and r.verified_customer_id=c.customer_id and r.status='approved')) and o.shop=$3 and o.order_id=$4",
        [actor.tenant_id, card.customer_id, SHOP, reference, card.case_id],
      )
    ).rows[0];
    if (!owned)
      throw new AccessError(409, "verified_owned_shopify_order_required");
    // An order link is not an examination payment allocation and never copies the entire order total into fees.
  } else if (source === "external_staff_record")
    amount = integer(body.amount_cents, 0, 100000000);
  else throw new AccessError(400, "invalid_payment_source");
  const id = randomUUID();
  await db.query(
    "insert into ns.grading_payments(tenant_id,id,case_id,source,reference,recorded_date,amount_cents,staff_id,reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      actor.tenant_id,
      id,
      card.case_id,
      source,
      reference,
      date,
      amount,
      actor.staff_id,
      why,
    ],
  );
  await audit(db, actor, card.case_id, "examination.payment_reference", why, {
    id,
    source,
  });
  return { recorded: true };
}
