import "server-only";
import { randomUUID } from "node:crypto";
import { type Sql, type Actor, requireRole } from "./db";
import { TENANT } from "./providers";
import { AccessError, hashToken, csvCell } from "./security";
import {
  fieldToken,
  metricDefinitions,
  type Metric,
  type Show,
  type Placement,
} from "../engagement";
import { shortText, uuid } from "./loyalty";
export async function approvedPlacement(db: Sql, ref: unknown, sample = false) {
  if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{22,64}$/.test(ref))
    return null;
  return (
    (
      await db.query<Placement & { slug: string; brand: string }>(
        `select p.*,s.slug,s.brand from ns.show_placements p join ns.show_events s on s.tenant_id=p.tenant_id and s.id=p.event_id join ns.campaign_refs c on c.tenant_id=p.tenant_id and c.ref=p.ref where p.tenant_id=$1 and p.ref=$2 and p.enabled and c.enabled and s.published and s.fixture=$3`,
        [TENANT, ref, sample],
      )
    ).rows[0] || null
  );
}
export async function publicShow(db: Sql, slug: string, sample = false) {
  return (
    (
      await db.query<Show>(
        "select * from ns.show_events where tenant_id=$1 and slug=$2 and published and fixture=$3",
        [TENANT, slug, sample],
      )
    ).rows[0] || null
  );
}
export async function saveShow(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
  sample = false,
) {
  requireRole(a, ["owner", "admin", "operations", "content_editor"]);
  const id = uuid(b.id),
    slug = shortText(b.slug, 80);
  if (
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
    !["northside", "hobby_key"].includes(String(b.brand))
  )
    throw new AccessError(400, "invalid_show");
  let at = null;
  if (b.starts_at) {
    at = new Date(String(b.starts_at));
    if (!Number.isFinite(at.getTime()))
      throw new AccessError(400, "invalid_date");
  }
  const r = await db.query(
    "insert into ns.show_events(tenant_id,id,slug,brand,title,description,starts_at,location,published,fixture) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(tenant_id,id) do update set slug=excluded.slug,brand=excluded.brand,title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,location=excluded.location,published=excluded.published,version=ns.show_events.version+1 where ns.show_events.version=$11 returning id",
    [
      a.tenant_id,
      id,
      slug,
      b.brand,
      shortText(b.title, 120),
      String(b.description || "").slice(0, 2000),
      at?.toISOString() || null,
      b.location ? shortText(b.location, 160) : null,
      b.published === true,
      sample,
      b.version,
    ],
  );
  if (!r.rows.length) throw new AccessError(409, "show_changed_refresh");
  return {
    message: "Show saved. Existing printed QR destinations follow this record.",
  };
}
export async function savePlacement(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
) {
  requireRole(a, ["owner", "admin", "operations", "content_editor"]);
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "placement_key",
  ])
    if (!fieldToken(b[key]))
      throw new AccessError(400, "lowercase_campaign_fields_required");
  const ref =
    typeof b.ref === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(b.ref)
      ? b.ref
      : randomUUID().replaceAll("-", "");
  const event = uuid(b.event_id);
  if (
    !(
      await db.query(
        "select id from ns.show_events where tenant_id=$1 and id=$2",
        [a.tenant_id, event],
      )
    ).rows.length
  )
    throw new AccessError(404, "show_not_found");
  await db.query(
    "insert into ns.campaign_refs(tenant_id,ref,enabled) values($1,$2,$3) on conflict(tenant_id,ref) do update set enabled=excluded.enabled",
    [a.tenant_id, ref, b.enabled === true],
  );
  await db.query(
    "insert into ns.show_placements(tenant_id,ref,event_id,placement_key,utm_source,utm_medium,utm_campaign,utm_content,enabled) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(tenant_id,ref) do update set event_id=excluded.event_id,enabled=excluded.enabled",
    [
      a.tenant_id,
      ref,
      event,
      b.placement_key,
      b.utm_source,
      b.utm_medium,
      b.utm_campaign,
      b.utm_content,
      b.enabled === true,
    ],
  );
  return {
    ref,
    message:
      "Stable QR saved. Campaign labels are immutable; destination and enabled state can change.",
  };
}
type Visitor = {
  token_hash: string;
  customer_id: string | null;
  first_ref: string | null;
  latest_ref: string | null;
  first_at: string | null;
  latest_at: string | null;
  consented_at: string;
};
export async function visitor(db: Sql, token: string | undefined) {
  if (!token) return null;
  return (
    (
      await db.query<Visitor>(
        "select token_hash,customer_id,first_ref,latest_ref,first_at,latest_at,consented_at from ns.measurement_visitors where tenant_id=$1 and token_hash=$2 and analytics_consent and expires_at>now()",
        [TENANT, hashToken(token)],
      )
    ).rows[0] || null
  );
}
export async function analyticsConsent(
  db: Sql,
  token: string,
  consent: boolean,
  ref: unknown,
  sample = false,
) {
  const hash = hashToken(token);
  if (!consent) {
    await db.query(
      "delete from ns.measurement_visitors where tenant_id=$1 and token_hash=$2",
      [TENANT, hash],
    );
    await db.query(
      "delete from ns.campaign_touches where tenant_id=$1 and token_hash=$2",
      [TENANT, hash],
    );
    return;
  }
  await db.query(
    `insert into ns.measurement_visitors(tenant_id,token_hash,analytics_consent) values($1,$2,true) on conflict(tenant_id,token_hash) do update set analytics_consent=true,consented_at=now(),expires_at=now()+interval '30 days',first_ref=case when ns.measurement_visitors.expires_at<=now() then null else ns.measurement_visitors.first_ref end,latest_ref=case when ns.measurement_visitors.expires_at<=now() then null else ns.measurement_visitors.latest_ref end,first_at=case when ns.measurement_visitors.expires_at<=now() then null else ns.measurement_visitors.first_at end,latest_at=case when ns.measurement_visitors.expires_at<=now() then null else ns.measurement_visitors.latest_at end`,
    [TENANT, hash],
  );
  await observeTouch(db, token, ref, sample);
}
export async function observeTouch(
  db: Sql,
  token: string,
  ref: unknown,
  sample = false,
) {
  const p = await approvedPlacement(db, ref, sample);
  if (!p || !(await visitor(db, token))) return false;
  await db.query(
    "update ns.measurement_visitors set first_ref=coalesce(first_ref,$3),first_at=coalesce(first_at,now()),latest_ref=$3,latest_at=now() where tenant_id=$1 and token_hash=$2",
    [TENANT, hashToken(token), p.ref],
  );
  await db.query(
    `insert into ns.campaign_touches(token_hash,tenant_id,first_ref,last_ref,consent) values($1,$2,$3,$3,true) on conflict(token_hash) do update set last_ref=excluded.last_ref,last_at=now(),first_ref=case when ns.campaign_touches.expires_at<=now() then excluded.first_ref else ns.campaign_touches.first_ref end,first_at=case when ns.campaign_touches.expires_at<=now() then now() else ns.campaign_touches.first_at end,expires_at=now()+interval '30 days'`,
    [hashToken(token), TENANT, p.ref],
  );
  return true;
}
export async function metric(
  db: Sql,
  v: Visitor | null,
  event: Metric,
  key: string,
  sample = false,
  at?: string,
) {
  if (!v) return false;
  const count = (
    await db.query<{ count: number }>(
      "select count(*)::int count from ns.measurement_events where tenant_id=$1 and source_key like $2 and observed_at>now()-interval '1 day'",
      [TENANT, v.token_hash + "/%"],
    )
  ).rows[0].count;
  if (count >= 500) return false;
  await db.query(
    "insert into ns.measurement_events(tenant_id,event,source_key,first_ref,latest_ref,fixture,observed_at) values($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz,now())) on conflict do nothing",
    [TENANT, event, key, v.first_ref, v.latest_ref, sample, at || null],
  );
  return true;
}
export async function linkVisitor(
  db: Sql,
  token: string,
  a: Actor,
  sample = false,
) {
  if (!a.customer_id || a.tenant_id !== TENANT) return;
  const v = await visitor(db, token);
  if (!v) return;
  if (v.customer_id && v.customer_id !== a.customer_id) {
    await analyticsConsent(db, token, false, null, sample);
    return;
  }
  await db.query(
    "update ns.measurement_visitors set customer_id=$3 where tenant_id=$1 and token_hash=$2",
    [TENANT, v.token_hash, a.customer_id],
  );
  const signup = (
    await db.query<{ verified_at: string }>(
      "select verified_at from ns.signup_sources where tenant_id=$1 and customer_id=$2",
      [TENANT, a.customer_id],
    )
  ).rows[0];
  if (
    signup &&
    new Date(signup.verified_at).getTime() >= new Date(v.consented_at).getTime()
  )
    await metric(
      db,
      v,
      "signup_completed",
      hashToken(a.customer_id),
      sample,
      signup.verified_at,
    );
}
export async function customerMetric(
  db: Sql,
  a: Actor,
  event:
    "saved_break_reminder" | "grading_status_view" | "meaningful_activation",
  source: string,
) {
  if (!a.customer_id) return; // Old stage databases remain usable until migration 009 is applied.
  const ready = (
    await db.query<{ ready: string | null }>(
      "select to_regclass('ns.measurement_visitors')::text ready",
    )
  ).rows[0].ready;
  if (!ready) return;
  await db.query("select ns.authenticated_metric($1,$2)", [
    event,
    hashToken(source),
  ]);
}
export type MetricFilters = {
  start: string;
  end: string;
  campaign?: string;
  source?: string;
};
export function filters(url: URL): MetricFilters {
  const start =
      url.searchParams.get("start") ||
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    end =
      url.searchParams.get("end") ||
      new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    end <= start ||
    Date.parse(end) - Date.parse(start) > 366 * 86400000
  )
    throw new AccessError(400, "date_range_must_be_1_to_366_days");
  const campaign = url.searchParams.get("campaign") || "",
    source = url.searchParams.get("source") || "";
  if ((campaign && !fieldToken(campaign)) || (source && !fieldToken(source)))
    throw new AccessError(400, "invalid_filter");
  return { start, end, campaign, source };
}
export async function metrics(db: Sql, a: Actor, f: MetricFilters) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const args = [
    a.tenant_id,
    f.start,
    f.end,
    f.campaign || null,
    f.source || null,
  ];
  const where = `m.tenant_id=$1 and m.observed_at >= $2::timestamptz and m.observed_at < $3::timestamptz and ($4::text is null or p.utm_campaign=$4) and ($5::text is null or p.utm_source=$5)`;
  const events = (
    await db.query<{ event: Metric; count: number }>(
      `select m.event,count(*)::int count from ns.measurement_events m left join ns.show_placements p on p.tenant_id=m.tenant_id and p.ref=m.first_ref where ${where} group by m.event`,
      args,
    )
  ).rows;
  const legacyEvidence = (
    await db.query<{
      records: number;
      orders: number;
      recorded_cents: string;
      voided_records: number;
    }>(
      "select count(*)::int records,count(distinct source_order)::int orders,coalesce(sum(amount_cents),0)::text recorded_cents,count(*) filter(where status='canceled')::int voided_records from ns.break_purchases where tenant_id=$1 and source='legacy' and paid_at >= $2::timestamptz and paid_at < $3::timestamptz and $4::text is null and $5::text is null",
      args,
    )
  ).rows[0];
  const orders = (
    await db.query(
      `select m.channel,count(*)::int orders,coalesce(sum(m.gross_cents),0)::text gross_cents,coalesce(sum(m.refund_cents),0)::text refund_cents,coalesce(sum(m.gross_cents-m.refund_cents),0)::text net_cents,count(*) filter(where p.ref is null)::int unattributed_orders,max(m.last_sync_at) last_sync from ns.measured_orders m left join ns.show_placements p on p.tenant_id=m.tenant_id and p.ref=m.first_ref where ${where.replaceAll("m.observed_at", "m.paid_at")} and m.channel<>'external_legacy' group by m.channel`,
      args,
    )
  ).rows;
  return {
    tenant: a.tenant_id,
    filters: f,
    attribution:
      "first eligible observed touch; latest touch retained separately; not cross-device or ad-platform attribution",
    events: Object.entries(metricDefinitions).map(([event, definition]) => ({
      event,
      definition,
      count: events.find((v) => v.event === event)?.count || 0,
    })),
    orders,
    legacyEvidence,
    consignment_payouts:
      "Excluded from retail revenue. Use the consignment settlement report.",
    external_legacy:
      "Separate evidence only; never merged with Shopify orders.",
    last_sync:
      (
        await db.query(
          "select max(last_sync_at) last_sync from ns.measured_orders where tenant_id=$1",
          [a.tenant_id],
        )
      ).rows[0]?.last_sync || null,
  };
}
export function metricCsv(data: Awaited<ReturnType<typeof metrics>>) {
  const rows: unknown[][] = [
    ["contract", "northside.engagement.v1"],
    ["tenant", data.tenant],
    ["start_utc_inclusive", data.filters.start],
    ["end_utc_exclusive", data.filters.end],
    ["campaign", data.filters.campaign || "all"],
    ["source", data.filters.source || "all"],
    ["last_sync", data.last_sync || "never"],
    ["attribution", data.attribution],
    ["consignment", data.consignment_payouts],
    [],
    ["event", "count", "definition"],
    ...data.events.map((v) => [v.event, v.count, v.definition]),
    [],
    [
      "channel",
      "unique_paid_orders",
      "gross_cents",
      "refund_adjustment_cents",
      "net_cents",
      "unattributed_orders",
      "last_sync",
    ],
    ...data.orders.map((v) => [
      v.channel,
      v.orders,
      v.gross_cents,
      v.refund_cents,
      v.net_cents,
      v.unattributed_orders,
      v.last_sync,
    ]),
  ];
  rows.push(
    [],
    [
      "external_legacy_evidence_records",
      "unique_external_references",
      "recorded_cents",
      "voided_records",
      "refunds",
    ],
    [
      data.legacyEvidence.records,
      data.legacyEvidence.orders,
      data.legacyEvidence.recorded_cents,
      data.legacyEvidence.voided_records,
      "Unknown unless separately evidenced; not Shopify revenue",
    ],
  );
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function measurementTokenFrom(request: Request, sample = false) {
  const name = sample ? "ns_sample_campaign" : "__Host-ns_campaign";
  const v = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : undefined;
}
export async function setMeasurementContext(
  db: Sql,
  token: string | undefined,
) {
  await db.query("select set_config('ns.measurement_hash',$1,true)", [
    token && /^[A-Za-z0-9_-]{43}$/.test(token) ? hashToken(token) : "",
  ]);
}
