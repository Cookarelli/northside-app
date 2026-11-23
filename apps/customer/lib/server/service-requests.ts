import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { type Actor, type Sql, requireCustomer, requireRole } from "./db";
import { AccessError, hashToken, uuid, validToken } from "./security";
import { createIntake, integer, receivedDate, text } from "./grading";
import { createConsignment } from "./consignment";
import { TENANT } from "./providers";
import {
  requestSchema,
  requestStates,
  type RequestConfig,
  type ServiceRequestView,
} from "../../../../packages/customer-contracts/src/service-requests";

import { verifyRequestPhotos } from "./service-request-photos";

const writers = (a: Actor) => requireRole(a, ["owner", "admin", "operations"]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const digest = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
export async function requestConfig(
  db: Sql,
  a: Actor | null,
): Promise<RequestConfig> {
  const row = (
    await db.query<{
      config: Omit<RequestConfig, "location" | "contractVersion">;
    }>("select ns.service_request_config($1) as config", [
      a?.tenant_id ?? TENANT,
    ])
  ).rows[0];
  return {
    contractVersion: "1",
    ...row.config,
    customerScope: a?.customer_id
      ? hashToken(`service-request:${a.tenant_id}:${a.customer_id}`)
      : null,
    location: {
      address: "6800 Forest Hills Road, Suite 3, Loves Park, Illinois",
      receivingPostalCode: null,
      receivingStartsAt: null,
      receivingActive: false,
    },
  };
}
export async function submitRequest(
  db: Sql,
  a: Actor | null,
  body: unknown,
  source:
    | "shopify_website"
    | "customer_web"
    | "native_ios"
    | "native_android"
    | "staff",
  rateKey?: string,
) {
  const p = requestSchema.safeParse(body);
  if (!p.success) throw new AccessError(400, "invalid_service_request_fields");
  const b = p.data;
  await verifyRequestPhotos(db, a, {
    request_id: b.request_id,
    photo_ids: b.details.photo_ids as string[] | undefined,
  });
  if (a?.staff_id) {
    writers(a);
    if (b.kind !== "inquiry")
      throw new AccessError(
        403,
        "collector_must_accept_service_terms_from_their_own_form",
      );
  }
  const { claim_token, ...snapshot } = b;
  try {
    const { rows } = await db.query<{
      receipt: {
        id: string;
        reference: string;
        state: string;
        duplicate: boolean;
      };
    }>(
      "select ns.submit_service_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as receipt",
      [
        a?.tenant_id ?? TENANT,
        b.request_id,
        digest(snapshot),
        hashToken(claim_token),
        source,
        b.kind,
        b.service,
        JSON.stringify(b.contact),
        JSON.stringify(b.details),
        b.terms_id,
        a?.staff_id
          ? hashToken("staff-inquiry:" + a.staff_id)
          : (rateKey ?? null),
      ],
    );
    return {
      contractVersion: "1",
      requires_claim: !a?.customer_id,
      ...rows[0].receipt,
      next_steps:
        "Saved for Northside staff review. This does not confirm physical receipt, a quote, a payout or submission to a grading provider. " +
        (a?.customer_id
          ? "Track this linked request in My Cards."
          : "Keep your request ID and private claim code for verified account linking."),
    };
  } catch (e) {
    if (e instanceof Error && (e as { code?: unknown }).code === "P0001") {
      if (e.message === "Rate limited")
        throw new AccessError(429, "request_limit_reached");
      if (e.message === "Current approved terms required")
        throw new AccessError(409, "request_terms_changed");
      if (e.message === "Configured service level and declared value required")
        throw new AccessError(409, "request_service_level_changed");
      if (e.message === "Idempotency conflict")
        throw new AccessError(409, "request_conflict");
      if (["Invalid payload", "Inquiry terms invalid"].includes(e.message))
        throw new AccessError(400, "invalid_service_request_fields");
      if (["Tenant mismatch", "Verified customer required"].includes(e.message))
        throw new AccessError(403, "service_request_not_authorized");
    }
    throw new AccessError(503, "service_unavailable");
  }
}
/** Recover a committed receipt by a non-authorizing attempt ID within the signed-in owner scope. */
export async function recoverRequest(db: Sql, a: Actor, submission: unknown) {
  requireCustomer(a);
  const id = uuid(text(submission, 36, true)).toLowerCase();
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    `${a.tenant_id}:request:${id}`,
  ]);
  const row = (
    await db.query<{
      id: string;
      reference: string;
      state: string;
      kind: string;
      service: string;
    }>(
      "select id,reference,state,kind,service from ns.service_requests where tenant_id=$1 and submitted_customer_id=$2 and submission_id=$3",
      [a.tenant_id, a.customer_id, id],
    )
  ).rows[0];
  return {
    receipt: row
      ? {
          contractVersion: "1",
          ...row,
          duplicate: true,
          requires_claim: false,
          next_steps:
            "Saved for Northside staff review. This does not confirm physical receipt, a quote, a payout or submission to a grading provider. Track this linked request in My Cards.",
        }
      : null,
  };
}
async function ownedRequest(db: Sql, a: Actor, id: unknown, lock = false) {
  if (!a.customer_id)
    requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const r = (
    await db.query<ServiceRequestView & { conversion_hash: string | null }>(
      `select * from ns.service_requests where tenant_id=$1 and id=$2 ${a.customer_id ? "and customer_id=$3" : ""} ${lock ? "for update" : ""}`,
      [
        a.tenant_id,
        uuid(text(id, 36, true)),
        ...(a.customer_id ? [a.customer_id] : []),
      ],
    )
  ).rows[0];
  if (!r) throw new AccessError(404, "service_request_not_found");
  return r;
}
export async function listRequests(db: Sql, a: Actor) {
  if (!a.customer_id)
    requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const rows = (
    await db.query<ServiceRequestView>(
      `select id,submission_id,reference,kind,service,source,contact,details,state,version,created_at,updated_at,staff_owner,follow_up_at,received_at,customer_id,terms_id,terms_version,terms_hash,terms_accepted_at,intake_result from ns.service_requests where tenant_id=$1 ${a.customer_id ? "and customer_id=$2" : ""} order by created_at desc,id limit 500`,
      a.customer_id ? [a.tenant_id, a.customer_id] : [a.tenant_id],
    )
  ).rows;
  for (const r of rows) {
    r.history = (
      await db.query<ServiceRequestView["history"][number]>(
        "select state,message,created_at from ns.service_request_events where tenant_id=$1 and request_id=$2 order by created_at,id",
        [a.tenant_id, r.id],
      )
    ).rows;
    if (a.customer_id) r.staff_owner = null;
  }
  return { contractVersion: "1", requests: rows };
}
async function event(
  db: Sql,
  a: Actor,
  id: string,
  state: string,
  message: string,
) {
  await db.query(
    "insert into ns.service_request_events(tenant_id,request_id,state,message,staff_id) values($1,$2,$3,$4,$5)",
    [a.tenant_id, id, state, message, a.staff_id],
  );
}
async function note(
  db: Sql,
  a: Actor,
  id: string,
  reason: string,
  value: string,
) {
  await db.query(
    "insert into ns.service_request_notes(tenant_id,request_id,staff_id,reason,note) values($1,$2,$3,$4,$5)",
    [a.tenant_id, id, a.staff_id, reason, value],
  );
}
export async function staffRequestData(db: Sql, a: Actor) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  return {
    ...(await listRequests(db, a)),
    can_edit: ["owner", "admin", "operations"].includes(a.staff_role ?? ""),
    staff: (
      await db.query(
        "select id,role from ns.staff_memberships where tenant_id=$1 and active and role in ('owner','admin','operations') order by id",
        [a.tenant_id],
      )
    ).rows,
    claims: (
      await db.query(
        "select id,request_id,customer_id,status,created_at from ns.service_request_claims where tenant_id=$1 order by created_at desc limit 500",
        [a.tenant_id],
      )
    ).rows,
    notes: ["owner", "admin", "operations"].includes(a.staff_role ?? "")
      ? (
          await db.query(
            "select request_id,note,reason,created_at from ns.service_request_notes where tenant_id=$1 order by created_at desc limit 1000",
            [a.tenant_id],
          )
        ).rows
      : [],
    outbox: (
      await db.query(
        "select id,request_id,state,attempts,next_attempt_at,last_error from ns.service_request_outbox where tenant_id=$1 order by next_attempt_at limit 500",
        [a.tenant_id],
      )
    ).rows,
  };
}
export async function updateRequest(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  writers(a);
  const r = await ownedRequest(db, a, b.id, true),
    version = integer(b.version, 1, 100000000),
    reason = text(b.reason, 1000, true);
  if (r.version !== version)
    throw new AccessError(409, "request_changed_refresh");
  const state = text(b.state, 30, true);
  if (
    !requestStates.includes(state as (typeof requestStates)[number]) ||
    state === "intake" ||
    (state === "in_progress" && !r.intake_result)
  )
    throw new AccessError(400, "use_physical_intake_conversion");
  const allowed: Record<string, string[]> = {
    new: ["new", "review"],
    review: ["review", "assigned", "follow_up", "in_progress", "completed"],
    assigned: ["assigned", "review", "follow_up", "in_progress", "completed"],
    follow_up: ["follow_up", "review", "assigned", "in_progress", "completed"],
    intake: ["in_progress", "follow_up"],
    in_progress: ["in_progress", "follow_up", "completed"],
    completed: ["review"],
  };
  if (!allowed[r.state]?.includes(state))
    throw new AccessError(409, "invalid_queue_transition");
  const owner =
    b.staff_owner === null ? null : uuid(text(b.staff_owner, 36, true));
  if (
    owner &&
    !(
      await db.query(
        "select id from ns.staff_memberships where tenant_id=$1 and id=$2 and active and role in ('owner','admin','operations')",
        [a.tenant_id, owner],
      )
    ).rows.length
  )
    throw new AccessError(400, "active_operations_owner_required");
  if (state === "assigned" && !owner)
    throw new AccessError(400, "staff_owner_required");
  const follow =
    b.follow_up_at === null ? null : text(b.follow_up_at, 40, true);
  if (follow && (!Number.isFinite(Date.parse(follow)) || !/Z$/.test(follow)))
    throw new AccessError(400, "utc_follow_up_required");
  if (state === "follow_up" && !follow)
    throw new AccessError(400, "follow_up_date_required");
  await db.query(
    "update ns.service_requests set state=$3,staff_owner=$4,follow_up_at=$5,version=version+1,updated_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [a.tenant_id, r.id, state, owner, follow],
  );
  await note(db, a, r.id, reason, text(b.staff_note ?? "", 3000));
  await event(
    db,
    a,
    r.id,
    state,
    text(b.customer_message ?? "", 3000) ||
      `Northside request status: ${state.replaceAll("_", " ")}.`,
  );
  return { updated: true };
}
export async function requestClaim(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  requireCustomer(a);
  if (!validToken(b.claim_token))
    throw new AccessError(400, "private_claim_code_required");
  try {
    return {
      claim_id: (
        await db.query<{ id: string }>(
          "select ns.claim_service_request($1,$2) as id",
          [uuid(text(b.id, 36, true)), hashToken(b.claim_token)],
        )
      ).rows[0].id,
      pending_staff_verification: true,
    };
  } catch {
    throw new AccessError(409, "claim_unavailable_or_already_linked");
  }
}
export async function reviewRequestClaim(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  writers(a);
  if (typeof b.approved !== "boolean")
    throw new AccessError(400, "explicit_claim_decision_required");
  const reason = text(b.reason, 1000, true);
  const claim = (
    await db.query<{ request_id: string }>(
      "select request_id from ns.service_request_claims where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(text(b.claim_id, 36, true))],
    )
  ).rows[0];
  if (!claim) throw new AccessError(404, "claim_not_found");
  await db.query("select ns.review_service_request_claim($1,$2,$3)", [
    b.claim_id,
    b.approved,
    text(b.verification_reference, 1000, true),
  ]);
  await note(
    db,
    a,
    claim.request_id,
    reason,
    "Independent identity review recorded.",
  );
  return { reviewed: true };
}
export async function convertRequest(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  writers(a);
  const r = await ownedRequest(db, a, b.id, true),
    quantity = integer(b.quantity, 1, 50),
    description = text(b.description, 500, true),
    day = receivedDate(b.received_date),
    evidence = text(b.receipt_evidence, 1000, true),
    reason = text(b.reason, 1000, true);
  const fingerprint = digest({ quantity, description, day, evidence, reason });
  if (r.intake_result) {
    if (r.conversion_hash !== fingerprint)
      throw new AccessError(409, "conversion_payload_conflict");
    return { duplicate: true, intake: r.intake_result };
  }
  if (r.version !== integer(b.version, 1, 100000000))
    throw new AccessError(409, "request_changed_refresh");
  if (
    r.kind !== "service_request" ||
    !r.customer_id ||
    !r.terms_id ||
    !["review", "assigned", "follow_up"].includes(r.state)
  )
    throw new AccessError(
      409,
      "review_verified_customer_and_accepted_terms_required",
    );
  let result: Record<string, unknown>;
  if (r.service === "grading")
    result = await createIntake(
      db,
      a,
      { customer_id: r.customer_id, description, quantity, received_date: day },
      r.id,
      reason,
    );
  else {
    const items: string[] = [];
    for (let i = 0; i < quantity; i++) {
      const item = await createConsignment(db, a, {
        customer_id: r.customer_id,
        request_id: randomUUID(),
        description,
        received_date: day,
        currency: "USD",
        reason,
      });
      await db.query(
        "update ns.consignment_items set service_request_id=$3 where tenant_id=$1 and id=$2",
        [a.tenant_id, item.id, r.id],
      );
      items.push(item.id);
    }
    result = { items };
  }
  await db.query(
    "update ns.service_requests set state='intake',received_at=$3,receipt_evidence=$4,intake_result=$5,conversion_hash=$6,version=version+1,updated_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [a.tenant_id, r.id, day, evidence, JSON.stringify(result), fingerprint],
  );
  await note(db, a, r.id, reason, evidence);
  await event(
    db,
    a,
    r.id,
    "intake",
    `Northside recorded physical receipt of ${quantity} card(s) on ${day}. Provider processing has not started. Review individual cards in My Cards.`,
  );
  return { duplicate: false, intake: result };
}
export async function drainRequestOutbox(db: Sql, a: Actor, fail = false) {
  writers(a);
  const jobs = (
    await db.query<{ id: string; reference: string; state: string }>(
      "select o.id,r.reference,e.state from ns.service_request_outbox o join ns.service_requests r on r.tenant_id=o.tenant_id and r.id=o.request_id join ns.service_request_events e on e.tenant_id=o.tenant_id and e.id=o.event_id where o.tenant_id=$1 and o.state in ('pending','failed') and o.next_attempt_at<=clock_timestamp() order by o.next_attempt_at,o.id limit 25 for update of o skip locked",
      [a.tenant_id],
    )
  ).rows;
  for (const job of jobs) {
    if (fail)
      await db.query(
        "update ns.service_request_outbox set state='failed',attempts=attempts+1,last_error='SAMPLE test sink unavailable',next_attempt_at=clock_timestamp()+interval '1 minute' where tenant_id=$1 and id=$2",
        [a.tenant_id, job.id],
      );
    else {
      await db.query(
        "insert into ns.service_request_test_sink(tenant_id,outbox_id,reference,state) values($1,$2,$3,$4) on conflict do nothing",
        [a.tenant_id, job.id, job.reference, job.state],
      );
      await db.query(
        "update ns.service_request_outbox set state='test_delivered',attempts=attempts+1,last_error=null,delivered_at=clock_timestamp() where tenant_id=$1 and id=$2",
        [a.tenant_id, job.id],
      );
    }
  }
  return { processed: jobs.length, sink: "test_only", real_messages_sent: 0 };
}
