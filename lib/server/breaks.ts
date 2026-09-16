import { customerMetric } from "./measurement";
import "server-only";
import { type Sql, type Actor, requireRole, requireCustomer } from "./db";
import { AccessError } from "./security";
import { TENANT } from "./providers";
import { integer, shortText, uuid } from "./loyalty";
import {
  breakStatuses,
  type BreakEvent,
  type BreakMapping,
  type PublicBreak,
} from "../breaks";
export type BreakMode = "live" | "sample";
export function modeCheck(mode: BreakMode) {
  if (mode === "sample" && process.env.NODE_ENV === "production")
    throw new AccessError(404, "not_found");
  return mode === "sample";
}
export function streamUrl(v: unknown) {
  if (v == null || v === "") return null;
  const u = new URL(shortText(v, 1000));
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    ![
      "facebook.com",
      "www.facebook.com",
      "instagram.com",
      "www.instagram.com",
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
    ].includes(u.hostname)
  )
    throw new AccessError(400, "use_an_approved_public_stream_destination");
  return u.toString();
}
function imageUrl(v: unknown) {
  if (v == null || v === "") return null;
  const value = shortText(v, 1000);
  if (["/northside-logo.svg", "/samples/break-cards.svg"].includes(value))
    return value;
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "cdn.shopify.com" ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash
  )
    throw new AccessError(400, "approved_shopify_image_required");
  return u.toString();
}
export function timestamp(v: unknown, nullable = false) {
  if (nullable && (v == null || v === "")) return null;
  const s = v instanceof Date ? v.toISOString() : shortText(v, 40);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s)))
    throw new AccessError(400, "timestamp_with_timezone_required");
  return new Date(s).toISOString();
}
export function eventInput(v: unknown) {
  if (!v || typeof v !== "object") throw new AccessError(400, "event_required");
  const b = v as Record<string, unknown>;
  const status = shortText(b.status, 20) as BreakEvent["status"],
    format = shortText(b.format, 20) as BreakEvent["format"];
  if (
    !breakStatuses.includes(status) ||
    !["unconfirmed", "named", "identical"].includes(format)
  )
    throw new AccessError(400, "unsupported_event_state_or_format");
  if (!Array.isArray(b.products) || b.products.length > 30)
    throw new AccessError(400, "up_to_30_product_descriptions");
  const products = b.products.map((v) => shortText(v, 200));
  const result = {
    title: shortText(b.title, 150),
    products,
    starts_at: timestamp(b.starts_at, true),
    status,
    host: typeof b.host === "string" ? b.host.trim().slice(0, 100) : "",
    description: shortText(b.description, 4000),
    image_url: imageUrl(b.image_url),
    format,
    capacity: b.capacity == null ? null : integer(b.capacity, 1, 500),
    terms: typeof b.terms === "string" ? b.terms.trim().slice(0, 4000) : "",
    stream_url: streamUrl(b.stream_url),
    replay_url: streamUrl(b.replay_url),
    duration_minutes: integer(b.duration_minutes, 15, 1440),
    published: b.published === true,
  };
  if (
    result.published &&
    (status === "draft" || !products.length || !result.host)
  )
    throw new AccessError(
      400,
      "published_event_requires_products_host_and_status",
    );
  return result;
}
export async function breakAudit(
  db: Sql,
  a: Actor,
  event: string,
  action: string,
  reason: string,
  before: unknown = null,
  after: unknown = null,
) {
  await db.query(
    "insert into ns.break_audit(tenant_id,event_id,actor_id,action,reason,before_value,after_value) values($1,$2,$3,$4,$5,$6,$7)",
    [
      a.tenant_id,
      event,
      a.staff_id,
      action,
      shortText(reason),
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}
export async function eventLock(db: Sql, tenant: string, id: string) {
  uuid(id);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    tenant + "/break/" + id,
  ]);
  const e = (
    await db.query<BreakEvent>(
      "select * from ns.break_events where tenant_id=$1 and id=$2 for update",
      [tenant, id],
    )
  ).rows[0];
  if (!e) throw new AccessError(404, "break_not_found");
  return e;
}
export async function saveBreak(
  db: Sql,
  a: Actor,
  input: unknown,
  id: string,
  version: number | null,
  reason: string,
  mode: BreakMode = "live",
) {
  requireRole(a, ["owner", "admin", "operations", "content_editor"]);
  const fixture = modeCheck(mode),
    v = eventInput(input);
  uuid(id);
  shortText(reason);
  let old: BreakEvent | null = null;
  if (version === null) {
    const exists = (
      await db.query<BreakEvent>(
        "select * from ns.break_events where tenant_id=$1 and id=$2",
        [a.tenant_id, id],
      )
    ).rows[0];
    if (exists) {
      if (
        exists.fixture !== fixture ||
        JSON.stringify(eventInput(exists)) !== JSON.stringify(v)
      )
        throw new AccessError(409, "request_id_already_used_reload");
      return exists;
    }
    await db.query(
      "insert into ns.break_events(tenant_id,id,title,fixture) values($1,$2,$3,$4)",
      [a.tenant_id, id, v.title, fixture],
    );
  } else {
    old = await eventLock(db, a.tenant_id, id);
    if (old.version !== integer(version, 1) || old.fixture !== fixture)
      throw new AccessError(409, "event_changed_reload_before_saving");
    if (old.status === "canceled" && v.status !== "canceled")
      throw new AccessError(409, "create_a_new_event_after_cancellation");
    if (
      (v.format !== old.format || v.capacity !== old.capacity) &&
      (
        await db.query(
          "select id from ns.shopify_spot_mappings where tenant_id=$1 and event_id=$2",
          [a.tenant_id, id],
        )
      ).rows.length
    )
      throw new AccessError(
        409,
        "mapped_format_and_capacity_require_a_new_event",
      );
  }
  const keys = Object.keys(v),
    values = Object.values(v);
  await db.query(
    `update ns.break_events set ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")},sale_open=false,version=version+1,updated_at=now(),started_at=case when $${keys.indexOf("status") + 3} in ('live','complete') then coalesce(started_at,now()) else started_at end where tenant_id=$1 and id=$2`,
    [a.tenant_id, id, ...values],
  );
  await breakAudit(
    db,
    a,
    id,
    old ? "schedule.updated" : "schedule.created",
    reason,
    old,
    v,
  );
  if (v.status === "canceled" && old?.status !== "canceled")
    await exception(
      db,
      a.tenant_id,
      id,
      null,
      "event_canceled",
      "canceled/" + id,
      "Event canceled: review every purchase and resolve refunds outside this app. Allocations remain held.",
    );
  return (
    await db.query<BreakEvent>(
      "select * from ns.break_events where tenant_id=$1 and id=$2",
      [a.tenant_id, id],
    )
  ).rows[0];
}
export async function publicBreaks(
  db: Sql,
  mode: BreakMode = "live",
  id?: string,
): Promise<PublicBreak[]> {
  const sample = modeCheck(mode);
  if (id) uuid(id);
  const events = (
    await db.query<BreakEvent>(
      `select * from ns.break_events where tenant_id=$1 and fixture=$2 and published ${id ? "and id=$3" : ""} order by case when status='live' then 0 when status in ('scheduled','delayed') then 1 else 2 end, starts_at asc nulls last limit 100`,
      id ? [TENANT, sample, id] : [TENANT, sample],
    )
  ).rows;
  const result: PublicBreak[] = [];
  for (const e of events) {
    const spots = (
      await db.query<{
        id: string;
        spot_key: string;
        capacity: number;
        occupied: string;
      }>("select * from ns.public_break_spots($1,$2)", [e.id, sample])
    ).rows;
    const participants = (
      await db.query<{
        display_name: string;
        spot_key: string;
        quantity: string;
      }>("select * from ns.public_break_participants($1,$2)", [e.id, sample])
    ).rows;
    result.push({
      ...e,
      spots: spots.map((s) => ({ ...s, occupied: Number(s.occupied) })),
      participants: participants.map((p) => ({
        ...p,
        quantity: Number(p.quantity),
      })),
    });
  }
  return result;
}
export async function saveReminder(
  db: Sql,
  a: Actor,
  event: string,
  lead: number,
  active: boolean,
  mode: BreakMode = "live",
) {
  requireCustomer(a);
  uuid(event);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + "/break/" + event,
  ]);
  integer(lead);
  if (![0, 5, 15, 30, 60, 1440].includes(lead))
    throw new AccessError(400, "unsupported_reminder_time");
  const sample = modeCheck(mode);
  const e = (
    await db.query<BreakEvent>(
      "select e.* from ns.break_events e where e.tenant_id=$1 and e.id=$2 and e.fixture=$3 and (e.published or ($4=false and exists(select 1 from ns.break_reminders r where r.tenant_id=e.tenant_id and r.event_id=e.id and r.customer_id=$5)))",
      [a.tenant_id, event, sample, active, a.customer_id],
    )
  ).rows[0];
  if (!e) throw new AccessError(404, "break_not_found");
  if (active && ["canceled", "complete"].includes(e.status))
    throw new AccessError(409, "event_no_longer_accepts_reminders");
  await db.query(
    "insert into ns.break_reminders(tenant_id,customer_id,event_id,lead_minutes,active,scheduled_for,event_version) values($1,$2,$3,$4,$5,$6,$7) on conflict(tenant_id,customer_id,event_id) do update set lead_minutes=excluded.lead_minutes,active=excluded.active,scheduled_for=excluded.scheduled_for,event_version=excluded.event_version,updated_at=now() where ns.break_reminders.lead_minutes<>excluded.lead_minutes or ns.break_reminders.active<>excluded.active or ns.break_reminders.scheduled_for is distinct from excluded.scheduled_for or ns.break_reminders.event_version<>excluded.event_version",
    [
      a.tenant_id,
      a.customer_id,
      e.id,
      lead,
      active,
      e.starts_at
        ? new Date(new Date(e.starts_at).getTime() - lead * 60000).toISOString()
        : null,
      e.version,
    ],
  );
  if (active) await customerMetric(db, a, "saved_break_reminder", event);
}
export async function participantConsent(
  db: Sql,
  a: Actor,
  event: string,
  name: string,
  consented: boolean,
  mode: BreakMode = "live",
) {
  requireCustomer(a);
  modeCheck(mode);
  uuid(event);
  if (!consented) {
    const removed = await db.query(
      "update ns.break_participant_preferences set consented=false,updated_at=now() where tenant_id=$1 and customer_id=$2 and event_id=$3 returning event_id",
      [a.tenant_id, a.customer_id, event],
    );
    if (removed.rows.length) return;
  }
  if (!(await publicBreaks(db, mode, uuid(event))).length)
    throw new AccessError(404, "break_not_found");
  const alias = shortText(name, 60);
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(alias))
    throw new AccessError(400, "use_a_display_name_without_email_or_links");
  await db.query(
    "insert into ns.break_participant_preferences(tenant_id,customer_id,event_id,display_name,consented) values($1,$2,$3,$4,$5) on conflict(tenant_id,customer_id,event_id) do update set display_name=excluded.display_name,consented=excluded.consented,updated_at=now()",
    [a.tenant_id, a.customer_id, event, alias, consented],
  );
}
export async function myBreaks(db: Sql, a: Actor) {
  requireCustomer(a);
  const reminders = (
    await db.query(
      "select r.event_id,r.lead_minutes,r.active,r.scheduled_for,r.event_version,e.title,e.starts_at,e.status,e.published from ns.break_reminders r join ns.break_events e on e.tenant_id=r.tenant_id and e.id=r.event_id where r.tenant_id=$1 and r.customer_id=$2 order by r.updated_at desc limit 100",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  const purchases = (
    await db.query(
      "select p.id,p.event_id,p.source,p.quantity,p.current_quantity,p.status,p.paid_at,p.amount_cents,p.currency,e.title,e.status event_status,m.spot_key,(select count(*) from ns.break_allocations x where x.tenant_id=p.tenant_id and x.purchase_id=p.id and x.active) held_slots from ns.break_purchases p join ns.break_events e on e.tenant_id=p.tenant_id and e.id=p.event_id join ns.shopify_spot_mappings m on m.tenant_id=p.tenant_id and m.id=p.mapping_id where p.tenant_id=$1 and p.customer_id=$2 order by p.paid_at desc limit 100",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  const history = (
    await db.query(
      "select purchase_id,source_id,details,recorded_at from ns.break_purchase_events where tenant_id=$1 and customer_id=$2 order by recorded_at desc limit 100",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  const preferences = (
    await db.query(
      "select event_id,display_name,consented from ns.break_participant_preferences where tenant_id=$1 and customer_id=$2",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  return {
    reminders,
    purchases,
    history,
    preferences,
    delivery: "In-app list only. No email or push has been sent.",
  };
}
export async function exception(
  db: Sql,
  tenant: string,
  event: string | null,
  order: string | null,
  kind: string,
  source: string,
  details: string,
) {
  await db.query(
    "insert into ns.break_exceptions(tenant_id,event_id,order_id,kind,source_id,details) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,source_id) do nothing",
    [tenant, event, order, kind, source, details],
  );
}
export async function addMapping(
  db: Sql,
  a: Actor,
  event: string,
  input: {
    variant_id: string;
    product_id: string;
    sku: string;
    spot_key: string;
    capacity: number;
  },
  reason: string,
) {
  requireRole(a, ["owner", "admin", "operations"]);
  const e = await eventLock(db, a.tenant_id, event);
  const { gid } = await import("./shopify-config");
  gid(input.variant_id, "ProductVariant");
  gid(input.product_id, "Product");
  const sku = shortText(input.sku, 100),
    label = shortText(input.spot_key, 100),
    capacity = integer(input.capacity, 1, 500);
  if (
    !e.capacity ||
    e.format === "unconfirmed" ||
    (e.format === "named" && capacity !== 1) ||
    (e.format === "identical" && capacity !== e.capacity)
  )
    throw new AccessError(409, "confirm_named_or_identical_format_capacity");
  const existing = (
    await db.query<BreakMapping>(
      "select * from ns.shopify_spot_mappings where tenant_id=$1 and event_id=$2",
      [a.tenant_id, event],
    )
  ).rows;
  if (existing.reduce((n, m) => n + m.capacity, 0) + capacity > e.capacity)
    throw new AccessError(409, "mapping_exceeds_event_capacity");
  if (
    (
      await db.query(
        "select id from ns.shopify_spot_mappings where tenant_id=$1 and (variant_id=$2 or sku=$3)",
        [a.tenant_id, input.variant_id, sku],
      )
    ).rows.length
  )
    throw new AccessError(409, "variant_or_sku_already_mapped");
  const m = (
    await db.query<BreakMapping>(
      "insert into ns.shopify_spot_mappings(tenant_id,event_id,variant_id,product_id,sku,spot_key,capacity) values($1,$2,$3,$4,$5,$6,$7) returning *",
      [
        a.tenant_id,
        event,
        input.variant_id,
        input.product_id,
        sku,
        label,
        capacity,
      ],
    )
  ).rows[0];
  await db.query(
    "update ns.break_events set sale_open=false where tenant_id=$1 and id=$2",
    [a.tenant_id, event],
  );
  await breakAudit(db, a, event, "mapping.created", reason, null, m);
  return m;
}
export async function setMappingActive(
  db: Sql,
  a: Actor,
  id: string,
  active: boolean,
  reason: string,
) {
  requireRole(a, ["owner", "admin", "operations"]);
  const m = (
    await db.query<BreakMapping>(
      "select * from ns.shopify_spot_mappings where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(id)],
    )
  ).rows[0];
  if (!m) throw new AccessError(404, "mapping_not_found");
  await eventLock(db, a.tenant_id, m.event_id);
  await db.query(
    "update ns.shopify_spot_mappings set active=$3 where tenant_id=$1 and id=$2",
    [a.tenant_id, id, active],
  );
  await db.query(
    "update ns.break_events set sale_open=false where tenant_id=$1 and id=$2",
    [a.tenant_id, m.event_id],
  );
  await breakAudit(
    db,
    a,
    m.event_id,
    "mapping.active",
    reason,
    { active: m.active },
    { active },
  );
}
export async function staffBreaks(db: Sql, a: Actor, mode: BreakMode = "live") {
  requireRole(a, [
    "owner",
    "admin",
    "operations",
    "content_editor",
    "read_only",
  ]);
  const events = (
    await db.query<BreakEvent>(
      "select * from ns.break_events where tenant_id=$1 and fixture=$2 order by updated_at desc limit 100",
      [a.tenant_id, modeCheck(mode)],
    )
  ).rows;
  const contentOnly = a.staff_role === "content_editor";
  if (contentOnly)
    return {
      events,
      role: a.staff_role,
      mappings: [],
      purchases: [],
      exceptions: [],
      jobs: [],
      customers: [],
      checks: [],
      audit: [],
    };
  return {
    events,
    role: a.staff_role,
    mappings: (
      await db.query(
        "select m.*,(select count(*) from ns.break_allocations x where x.tenant_id=m.tenant_id and x.mapping_id=m.id and x.active) occupied from ns.shopify_spot_mappings m where m.tenant_id=$1 order by m.created_at desc limit 500",
        [a.tenant_id],
      )
    ).rows,
    purchases: (
      await db.query(
        "select * from ns.break_purchases where tenant_id=$1 order by paid_at desc limit 300",
        [a.tenant_id],
      )
    ).rows,
    exceptions: (
      await db.query(
        "select * from ns.break_exceptions where tenant_id=$1 order by created_at desc limit 100",
        [a.tenant_id],
      )
    ).rows,
    jobs: (
      await db.query(
        "select id,order_id,state,attempts,last_error from ns.break_jobs where tenant_id=$1 and state<>'complete' order by created_at desc limit 100",
        [a.tenant_id],
      )
    ).rows,
    customers: (
      await db.query(
        "select id,display_name from ns.customers where tenant_id=$1 order by id limit 500",
        [a.tenant_id],
      )
    ).rows,
    checks: (
      await db.query(
        "select * from ns.break_sale_checks where tenant_id=$1 order by checked_at desc limit 100",
        [a.tenant_id],
      )
    ).rows,
    audit: (
      await db.query(
        "select * from ns.break_audit where tenant_id=$1 order by created_at desc limit 100",
        [a.tenant_id],
      )
    ).rows,
  };
}
