import "server-only";
import { type Actor, type Sql, requireCustomer, requireRole } from "./db";
import { AccessError, uuid } from "./security";
import { text } from "./grading";
import { portalData, portalDetail } from "./grading-portal";
import { consignmentItems, consignmentDetail } from "./consignment";
import { consignmentStates } from "../consignment";
import {
  trackingServiceSchema,
  trackingListSchema,
  trackingDetailSchema,
  serviceTermsSchema,
  termsAcceptanceSchema,
  type TrackingService,
} from "../../../../packages/customer-contracts/src/tracking";
import { MOBILE_CONTRACT_VERSION } from "../../../../packages/customer-contracts/src/mobile";

export function trackingService(value: unknown): TrackingService {
  const parsed = trackingServiceSchema.safeParse(value);
  if (!parsed.success) throw new AccessError(400, "invalid_service");
  return parsed.data;
}
const iso = (v: string | Date) => new Date(v).toISOString();
const day = (v: string | Date | null) => (v ? iso(v).slice(0, 10) : null);
export async function trackingCustomers(db: Sql, a: Actor, value: unknown) {
  requireRole(a, ["owner", "admin", "operations"]);
  const q = text(value, 100, true);
  if (q.length < 2)
    throw new AccessError(400, "search_requires_two_characters");
  const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  return {
    customers: (
      await db.query<{ id: string; display_name: string; verified: boolean }>(
        "select id,display_name,ns.grading_verified(tenant_id,id) as verified from ns.customers where tenant_id=$1 and (display_name ilike $2 or id::text=$3) order by display_name,id limit 50",
        [a.tenant_id, pattern, q],
      )
    ).rows,
  };
}
export async function serviceTermsState(db: Sql, a: Actor, value: unknown) {
  const service = trackingService(value);
  if (!a.customer_id)
    requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const term = (
    await db.query<{
      id: string;
      version: string;
      title: string;
      body: string;
      published_at: string;
    }>(
      "select id,version,title,body,published_at from ns.service_terms where tenant_id=$1 and service=$2 order by revision desc limit 1",
      [a.tenant_id, service],
    )
  ).rows[0];
  const accepted =
    term && a.customer_id
      ? (
          await db.query<{ accepted_at: string }>(
            "select accepted_at from ns.service_terms_acceptances where tenant_id=$1 and customer_id=$2 and terms_id=$3",
            [a.tenant_id, a.customer_id, term.id],
          )
        ).rows[0]
      : undefined;
  return serviceTermsSchema.parse({
    service,
    current: term
      ? {
          id: term.id,
          version: term.version,
          title: term.title,
          body: term.body,
          publishedAt: iso(term.published_at),
        }
      : null,
    acceptedAt: accepted ? iso(accepted.accepted_at) : null,
  });
}
export async function publishServiceTerms(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  requireRole(a, ["owner", "admin"]);
  const service = trackingService(b.service),
    version = text(b.version, 80, true),
    title = text(b.title, 200, true),
    body = text(b.body, 16000, true),
    ref = text(b.approval_reference, 1000, true);
  const previous =
    b.previous_id === null ? null : uuid(text(b.previous_id, 36, true));
  try {
    const r = await db.query<{ id: string }>(
      "select ns.publish_service_terms($1,$2,$3,$4,$5,$6) as id",
      [service, version, title, body, ref, previous],
    );
    return { id: r.rows[0].id };
  } catch {
    throw new AccessError(409, "terms_changed_or_version_already_used");
  }
}
export async function acceptServiceTerms(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  requireCustomer(a);
  const input = termsAcceptanceSchema.safeParse(b);
  if (!input.success)
    throw new AccessError(400, "explicit_current_terms_confirmation_required");
  try {
    await db.query("select ns.accept_service_terms($1,$2,$3)", [
      input.data.service,
      input.data.terms_id,
      input.data.card_id,
    ]);
  } catch {
    throw new AccessError(409, "terms_or_owned_card_changed_review_again");
  }
  return serviceTermsState(db, a, input.data.service);
}
async function gradingMetadata(db: Sql, a: Actor, ids: string[]) {
  return (
    await db.query<{
      card_id: string;
      received_date: string | null;
      recorded_at: string;
      provider_card_reference: string;
    }>(
      "select g.card_id,i.received_date::text,s.created_at as recorded_at,g.provider_card_reference from ns.grading_cards g join ns.grading_intakes i on i.tenant_id=g.tenant_id and i.case_id=g.case_id join ns.service_cases s on s.tenant_id=i.tenant_id and s.id=i.case_id where g.tenant_id=$1 and g.card_id=any($2::uuid[])",
      [a.tenant_id, ids],
    )
  ).rows;
}
export async function trackingList(
  db: Sql,
  a: Actor,
  value: unknown,
  onlyId?: string,
) {
  requireCustomer(a);
  const service = trackingService(value);
  const terms = await serviceTermsState(db, a, service);
  if (service === "grading") {
    const { cards } = await portalData(db, a, onlyId),
      meta = await gradingMetadata(
        db,
        a,
        cards.map((c) => c.card_id),
      );
    return trackingListSchema.parse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "card-tracking",
      service,
      terms,
      cards: cards.map((c) => {
        const m = meta.find((x) => x.card_id === c.card_id)!;
        return {
          id: c.card_id,
          cardId: c.card_id,
          service,
          title: c.description,
          status: c.label,
          receivedDate: m.received_date,
          recordedAt: iso(m.recorded_at),
          updatedAt: iso(c.updated_at),
        };
      }),
    });
  }
  const items = onlyId
    ? [(await consignmentDetail(db, a, onlyId)).item]
    : await consignmentItems(db, a);
  const rows = (
    await db.query<{ id: string; created_at: string }>(
      "select id,created_at from ns.card_items where tenant_id=$1 and id=any($2::uuid[])",
      [a.tenant_id, items.map((c) => c.card_id)],
    )
  ).rows;
  return trackingListSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "card-tracking",
    service,
    terms,
    cards: items.map((c) => ({
      id: c.id,
      cardId: c.card_id,
      service,
      title: c.description,
      status: consignmentStates[c.state_key],
      receivedDate: day(c.received_date),
      recordedAt: iso(rows.find((x) => x.id === c.card_id)!.created_at),
      updatedAt: iso(c.updated_at),
    })),
  });
}
export async function trackingDetail(
  db: Sql,
  a: Actor,
  value: unknown,
  id: string,
) {
  requireCustomer(a);
  const service = trackingService(value);
  uuid(id);
  // Authorize the exact record before projecting detail or reading photo metadata.
  const detail =
    service === "grading"
      ? await portalDetail(db, a, id)
      : await consignmentDetail(db, a, id);
  const list = await trackingList(db, a, service, id),
    summary = list.cards.find((c) => c.id === id);
  if (!summary) throw new AccessError(404, "card_not_found");
  if ("card" in detail) {
    const m = (await gradingMetadata(db, a, [id]))[0];
    return trackingDetailSchema.parse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "card-tracking-detail",
      terms: list.terms,
      card: {
        ...summary,
        customerNotes: detail.card.customer_notes,
        providerCardReference: m.provider_card_reference || null,
        result: detail.card.result || null,
        certificate: detail.card.certificate || null,
        history: detail.events.map((e) => ({
          id: e.id,
          label: e.label,
          source: e.source,
          occurredAt: iso(e.created_at),
        })),
        photos: detail.card.photos.map((p) => ({
          id: p.id,
          kind: p.kind,
          format: "grading",
        })),
      },
    });
  }
  return trackingDetailSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "card-tracking-detail",
    terms: list.terms,
    card: {
      ...summary,
      customerNotes: detail.item.customer_notes,
      providerCardReference: detail.item.provider_card_reference || null,
      result: null,
      certificate: null,
      history: detail.events.map((e) => ({
        id: e.id,
        label: e.label,
        source: e.source,
        occurredAt: iso(e.created_at),
      })),
      photos: detail.files
        .filter((p) => /^image\/(jpeg|png|webp)$/.test(p.mime_type))
        .map((p) => ({ id: p.id, kind: "Card photograph", format: "file" })),
    },
  });
}
