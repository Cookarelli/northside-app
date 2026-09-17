import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, Actor } from "./db";
import { requireCustomer } from "./db";
import { AccessError, uuid, csvCell } from "./security";
import {
  gradingCards,
  lockGradingCustody,
  gradingCard,
  gradingDetail,
  gradingWriter,
  text,
  integer,
  audit,
} from "./grading";
import { examWorkspace } from "./exam";
import type { ExamPhoto } from "../exam";
import {
  quoteCharges,
  type GradingQuote,
  type PortalCard,
  type PortalData,
  type PortalDetail,
} from "../grading-portal";
const quoteProjection =
  "q.id,q.card_id,q.revision,q.provider,p.label as provider_label,p.confirmed as provider_confirmed,q.service,q.grading_cents,q.shipping_cents,q.insurance_cents,q.other_cents,q.other_label,q.terms,q.created_at";
export async function cardQuotes(db: Sql, a: Actor, cardId: string) {
  await gradingCard(db, a, cardId);
  return (
    await db.query<GradingQuote>(
      `select ${quoteProjection} from ns.grading_quotes q join ns.grading_providers p on p.tenant_id=q.tenant_id and p.key=q.provider where q.tenant_id=$1 and q.card_id=$2 and (p.confirmed or $3) order by q.revision desc`,
      [a.tenant_id, cardId, !!a.staff_id],
    )
  ).rows;
}
export async function quoteWorkspace(db: Sql, a: Actor, cardId: string) {
  const card = await gradingCard(db, a, cardId);
  const quotes = await cardQuotes(db, a, cardId);
  return {
    quotes,
    examination_cents: card.examination_cents,
    approval_current: (
      await db.query<{ current: boolean }>(
        "select ns.grading_approval_current($1,$2) as current",
        [a.tenant_id, cardId],
      )
    ).rows[0].current,
  };
}
export async function saveQuote(db: Sql, a: Actor, b: Record<string, unknown>) {
  gradingWriter(a);
  const card = await gradingCard(db, a, uuid(text(b.card_id, 36, true)), true);
  const why = text(b.reason, 1000, true),
    requestId = uuid(text(b.request_id, 36, true));
  const provider = text(b.provider, 40, true),
    service = text(b.service ?? "", 120);
  const charges = quoteCharges.map((k) =>
    b[k] === null ? null : integer(b[k], 0, 10000000),
  );
  const other = text(b.other_label ?? "", 160),
    terms = text(b.terms ?? "", 3000);
  if (charges[3] !== null && charges[3] > 0 && !other)
    throw new AccessError(400, "describe_other_charges");
  const prior = (
    await db.query<{ id: string; card_id: string }>(
      "select id,card_id from ns.grading_quotes where tenant_id=$1 and request_id=$2",
      [a.tenant_id, requestId],
    )
  ).rows[0];
  if (prior) {
    const matched = (
      await db.query(
        "select id from ns.grading_quotes where tenant_id=$1 and request_id=$2 and card_id=$3 and provider=$4 and service=$5 and grading_cents is not distinct from $6::integer and shipping_cents is not distinct from $7::integer and insurance_cents is not distinct from $8::integer and other_cents is not distinct from $9::integer and other_label=$10 and terms=$11",
        [
          a.tenant_id,
          requestId,
          card.card_id,
          provider,
          service,
          ...charges,
          other,
          terms,
        ],
      )
    ).rows[0];
    if (!matched) throw new AccessError(409, "quote_request_conflict");
    return { id: prior.id };
  }
  const current = (await cardQuotes(db, a, card.card_id))[0];
  if ((current?.id ?? null) !== (b.previous_id ?? null))
    throw new AccessError(409, "quote_changed_reload");
  if (
    !(
      await db.query(
        "select key from ns.grading_providers where tenant_id=$1 and key=$2 and confirmed",
        [a.tenant_id, provider],
      )
    ).rows.length
  )
    throw new AccessError(400, "confirmed_provider_required");
  if (card.voided_at) throw new AccessError(409, "intake_reversed");
  if (
    card.custody !== "northside" ||
    ["returned", "ready_for_pickup", "completed"].includes(card.last_milestone)
  )
    throw new AccessError(
      409,
      "quote_changes_require_a_card_awaiting_submission",
    );
  if (
    ![
      "received",
      "examining",
      "awaiting_decision",
      "ready_to_submit",
      "return_requested",
      "on_hold",
      "exception",
    ].includes(card.status_key)
  )
    throw new AccessError(409, "quote_cannot_change_at_this_stage");
  const id = randomUUID();
  await db.query(
    "insert into ns.grading_quotes(tenant_id,id,card_id,revision,request_id,provider,service,grading_cents,shipping_cents,insurance_cents,other_cents,other_label,terms,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [
      a.tenant_id,
      id,
      card.card_id,
      (current?.revision ?? 0) + 1,
      requestId,
      provider,
      service,
      ...charges,
      other,
      terms,
      a.staff_id,
    ],
  );
  await audit(db, a, card.card_id, "quote.published", why, {
    quote_id: id,
    revision: (current?.revision ?? 0) + 1,
  });
  return { id };
}
export async function recordPortalDecision(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  requireCustomer(a);
  await lockGradingCustody(db, a);
  if (b.confirmed !== true)
    throw new AccessError(400, "explicit_decision_confirmation_required");
  if (b.choice === "withdraw") {
    const id = uuid(text(b.card_id, 36, true)),
      request = uuid(text(b.request_id, 36, true));
    await gradingCard(db, a, id);
    try {
      await db.query("select ns.request_grading_withdrawal($1,$2,$3)", [
        request,
        id,
        integer(b.version, 1, 2147483646),
      ]);
    } catch (e) {
      if (
        e instanceof Error &&
        /Withdrawal|Card unavailable|Verified collector/i.test(e.message)
      )
        throw new AccessError(409, e.message);
      throw e;
    }
    return { id: request };
  }
  if (!["submit", "return"].includes(String(b.choice)))
    throw new AccessError(400, "invalid_decision");
  if (!Array.isArray(b.cards) || !b.cards.length || b.cards.length > 100)
    throw new AccessError(400, "select_1_to_100_cards");
  const items = b.cards
    .map((v) => {
      if (!v || typeof v !== "object")
        throw new AccessError(400, "invalid_card_selection");
      return {
        card_id: uuid(text(v.card_id, 36, true)),
        version: integer(v.version, 1, 2147483646),
        quote_id: v.quote_id === null ? null : uuid(text(v.quote_id, 36, true)),
        exam_revision_id:
          v.exam_revision_id === null
            ? null
            : uuid(text(v.exam_revision_id, 36, true)),
      };
    })
    .sort((a, b) => a.card_id.localeCompare(b.card_id));
  if (new Set(items.map((v) => v.card_id)).size !== items.length)
    throw new AccessError(400, "duplicate_card_selection");
  // Same explicit ownership check on initial requests and uncertain replays.
  for (const item of items) await gradingCard(db, a, item.card_id);
  const requestId = uuid(text(b.request_id, 36, true));
  try {
    await db.query("select ns.grading_approve($1,$2,$3::jsonb)", [
      requestId,
      b.choice,
      JSON.stringify(items),
    ]);
  } catch (e) {
    if (
      e instanceof Error &&
      /changed|unavailable|conflict|current revisions|complete quote|sign-in|Invalid decision|Invalid customer|Post-dispatch/i.test(
        e.message,
      )
    )
      throw new AccessError(
        409,
        "decision_unavailable_or_changed_review_current_cards_exam_and_quote",
      );
    throw e;
  }
  return { id: requestId, recorded: true };
}
export async function portalData(
  db: Sql,
  a: Actor,
  onlyCard?: string,
): Promise<PortalData> {
  requireCustomer(a);
  const cards = onlyCard
    ? [await gradingCard(db, a, onlyCard)]
    : await gradingCards(db, a);
  if (!cards.length) return { cards: [] };
  const ids = cards.map((c) => c.card_id),
    params = [a.tenant_id, ids];
  const quotes = (
    await db.query<GradingQuote>(
      `select distinct on(q.card_id) ${quoteProjection} from ns.grading_quotes q join ns.grading_providers p on p.tenant_id=q.tenant_id and p.key=q.provider where q.tenant_id=$1 and q.card_id=any($2::uuid[]) and p.confirmed order by q.card_id,q.revision desc`,
      params,
    )
  ).rows;
  const photos = (
    await db.query<ExamPhoto & { card_id: string }>(
      "select card_id,id,kind,ready,active,width,height,confirmed_at from ns.grading_photos where tenant_id=$1 and card_id=any($2::uuid[]) and ready and active and kind<>'paper' order by created_at,id",
      params,
    )
  ).rows;
  const exams = (
    await db.query<{
      card_id: string;
      id: string;
      revision: number;
      signed_at: string;
    }>(
      "select distinct on(card_id) card_id,id,revision,signed_at from ns.grading_exam_revisions where tenant_id=$1 and card_id=any($2::uuid[]) order by card_id,revision desc",
      params,
    )
  ).rows;
  const receipts = (
    await db.query<{
      card_id: string;
      received_at: string;
      approval_current: boolean;
    }>(
      "select c.id as card_id,c.created_at as received_at,ns.grading_approval_current(c.tenant_id,c.id) as approval_current from ns.card_items c where c.tenant_id=$1 and c.id=any($2::uuid[])",
      params,
    )
  ).rows;
  const decisions = (
    await db.query<NonNullable<PortalCard["decision"]> & { card_id: string }>(
      "select distinct on(p.card_id) p.card_id,a.choice,a.created_at,p.request_id,p.quote_id,p.exam_revision_id from ns.grading_approval_cards p join ns.grading_approval_requests a on a.tenant_id=p.tenant_id and a.id=p.request_id where p.tenant_id=$1 and p.card_id=any($2::uuid[]) order by p.card_id,a.sequence desc",
      params,
    )
  ).rows;
  const withdrawals = (
    await db.query<{
      card_id: string;
      id: string;
      created_at: string;
      resolution: string;
    }>(
      `select distinct on(w.card_id) w.card_id,w.id,w.created_at,coalesce((select resolution from ns.grading_withdrawal_reviews r where r.tenant_id=w.tenant_id and r.withdrawal_id=w.id order by created_at desc limit 1),'pending') resolution from ns.grading_withdrawals w where w.tenant_id=$1 and w.customer_id=$2 order by w.card_id,w.created_at desc`,
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  return {
    cards: cards.map((c) => {
      // Deliberately list customer fields; never spread tenant/owner/batch records.
      const rec = receipts.find((r) => r.card_id === c.card_id)!;
      return {
        card_id: c.card_id,
        case_id: c.case_id,
        description: c.description,
        status_key: c.status_key,
        custody: c.custody,
        last_milestone: c.last_milestone,
        result_kind: c.result_kind,
        label: c.label,
        sport: c.sport,
        year: c.year,
        manufacturer: c.manufacturer,
        card_set: c.card_set,
        card_number: c.card_number,
        parallel: c.parallel,
        findings: c.findings,
        customer_notes: c.customer_notes,
        result: c.result,
        certificate: c.certificate,
        version: c.version,
        updated_at: new Date(
          Math.max(
            new Date(c.updated_at).valueOf(),
            ...photos
              .filter((p) => p.card_id === c.card_id)
              .map((p) => new Date(p.confirmed_at!).valueOf()),
            ...quotes
              .filter((q) => q.card_id === c.card_id)
              .map((q) => new Date(q.created_at).valueOf()),
            ...exams
              .filter((e) => e.card_id === c.card_id)
              .map((e) => new Date(e.signed_at).valueOf()),
          ),
        ).toISOString(),
        examination_cents: c.examination_cents,
        voided_at: c.voided_at,
        photos_complete: c.photos_complete,
        received_at: rec.received_at,
        approval_current: rec.approval_current,
        withdrawal: withdrawals.find((w) => w.card_id === c.card_id) ?? null,
        photos: photos.filter((p) => p.card_id === c.card_id),
        exam: exams.find((e) => e.card_id === c.card_id) ?? null,
        quote: quotes.find((q) => q.card_id === c.card_id) ?? null,
        decision: decisions.find((d) => d.card_id === c.card_id) ?? null,
      };
    }),
  };
}
export async function portalDetail(
  db: Sql,
  a: Actor,
  id: string,
): Promise<PortalDetail> {
  const card = (await portalData(db, a, uuid(id))).cards[0];
  const detail = await gradingDetail(db, a, id),
    exams = await examWorkspace(db, a, id),
    quotes = await cardQuotes(db, a, id);
  const receipt = (
    await db.query<{ received_at: string; voided_at: string | null }>(
      "select s.created_at as received_at,i.voided_at from ns.grading_intakes i join ns.service_cases s on s.tenant_id=i.tenant_id and s.id=i.case_id where i.tenant_id=$1 and i.case_id=$2",
      [a.tenant_id, card.case_id],
    )
  ).rows[0];
  const receiptCards = (
    await db.query<{
      card_id: string;
      description: string;
      examination_cents: number;
    }>(
      "select g.card_id,c.description,i.examination_cents from ns.grading_cards g join ns.card_items c on c.tenant_id=g.tenant_id and c.id=g.card_id join ns.grading_intakes i on i.tenant_id=g.tenant_id and i.case_id=g.case_id where g.tenant_id=$1 and g.case_id=$2 order by c.created_at,c.id",
      [a.tenant_id, card.case_id],
    )
  ).rows;
  const decisions = (
    await db.query<PortalDetail["decisions"][number]>(
      "select a.choice,a.created_at,p.request_id,p.quote_id,p.exam_revision_id from ns.grading_approval_cards p join ns.grading_approval_requests a on a.tenant_id=p.tenant_id and a.id=p.request_id where p.tenant_id=$1 and p.card_id=$2 order by a.sequence desc",
      [a.tenant_id, id],
    )
  ).rows;
  return {
    card,
    receipt: {
      id: card.case_id,
      ...receipt,
      cards: receiptCards,
      examination_subtotal_cents: receiptCards.reduce(
        (n, c) => n + c.examination_cents,
        0,
      ),
    },
    events: detail.events,
    exams: exams.revisions,
    quotes,
    decisions,
  };
}
export async function portalExport(db: Sql, a: Actor) {
  const { cards } = await portalData(db, a);
  return [
    "card_id,intake_id,description,status,last_updated,external_result,certificate,exam_revision,quote_revision,submission_approval_current",
    ...cards.map((c) =>
      [
        c.card_id,
        c.case_id,
        c.description,
        c.label,
        c.updated_at,
        c.result,
        c.certificate,
        c.exam?.revision ?? "",
        c.quote?.revision ?? "",
        c.approval_current ? "yes" : "no",
      ]
        .map((v) => csvCell(String(v)))
        .join(","),
    ),
  ].join("\r\n");
}
