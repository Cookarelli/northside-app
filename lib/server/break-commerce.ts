import "server-only";
import { type Sql, type Actor, requireRole } from "./db";
import { TENANT } from "./providers";
import { AccessError } from "./security";
import { eventLock, breakAudit, modeCheck, type BreakMode } from "./breaks";
import { allocationCount } from "./break-purchases";
import type { BreakMapping, BreakEvent } from "../breaks";
import type { Query } from "./storefront";
import { adminQuery } from "./admin-shopify";
import { shortText } from "./loyalty";
export type VariantProof = {
  id: string;
  sku: string;
  inventoryPolicy: string;
  inventoryQuantity: number;
  product: { id: string; status: string };
  inventoryItem: { tracked: boolean; requiresShipping: boolean };
};
export async function variantProof(query: Query, ids: string[]) {
  const r = await query<{ nodes: (VariantProof | null)[] }>(
    "query BreakInventory($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id sku inventoryPolicy inventoryQuantity product { id status } inventoryItem { tracked requiresShipping } } } }",
    { ids },
  );
  return r.nodes;
}
export function checkProof(
  m: BreakMapping,
  v: VariantProof | null | undefined,
  remaining: number,
  exact = false,
) {
  if (
    !v ||
    v.id !== m.variant_id ||
    v.product.id !== m.product_id ||
    v.sku !== m.sku ||
    v.product.status !== "ACTIVE" ||
    v.inventoryPolicy !== "DENY" ||
    !v.inventoryItem.tracked ||
    !v.inventoryItem.requiresShipping ||
    !Number.isSafeInteger(v.inventoryQuantity) ||
    v.inventoryQuantity < 0 ||
    v.inventoryQuantity > m.capacity ||
    (exact && v.inventoryQuantity !== remaining)
  )
    throw new AccessError(
      409,
      "shopify_inventory_or_physical_fulfillment_not_verified",
    );
}
export const checklistKeys = [
  "format_and_terms",
  "physical_fulfillment",
  "separate_inventory_pools",
  "legacy_reconciled",
  "concurrent_checkout_test",
] as const;
export async function saleCheck(
  db: Sql,
  a: Actor,
  id: string,
  checks: Record<string, unknown>,
  evidence: string,
  reason: string,
  mode: BreakMode = "live",
  query?: Query,
) {
  requireRole(a, ["owner", "admin", "operations"]);
  const sample = modeCheck(mode),
    e = await eventLock(db, a.tenant_id, id);
  if (e.fixture !== sample)
    throw new AccessError(409, "fixture_live_mapping_mismatch");
  if (
    !e.published ||
    !["scheduled", "delayed"].includes(e.status) ||
    e.started_at ||
    !e.starts_at ||
    new Date(e.starts_at).getTime() <= Date.now() ||
    !e.host ||
    !e.products.length ||
    !e.terms ||
    e.format === "unconfirmed" ||
    !e.capacity
  )
    throw new AccessError(409, "confirm_schedule_format_and_terms_before_sale");
  if (checklistKeys.some((k) => checks[k] !== true))
    throw new AccessError(400, "complete_every_reconciliation_check");
  shortText(evidence, 2000);
  if (
    (
      await db.query(
        "select id from ns.break_exceptions where tenant_id=$1 and (event_id=$2 or event_id is null) and status='open'",
        [TENANT, id],
      )
    ).rows.length
  )
    throw new AccessError(409, "resolve_open_break_exceptions");
  const mappings = (
    await db.query<BreakMapping>(
      "select * from ns.shopify_spot_mappings where tenant_id=$1 and event_id=$2 and active",
      [TENANT, id],
    )
  ).rows;
  if (mappings.reduce((n, m) => n + m.capacity, 0) !== e.capacity)
    throw new AccessError(409, "map_the_full_event_capacity");
  if (!sample && process.env.SHOPIFY_BREAK_CHECKOUT_VERIFIED !== "true")
    throw new AccessError(503, "real_concurrent_checkout_test_required");
  const proofs = sample
    ? null
    : await variantProof(
        query || (await adminQuery()),
        mappings.map((m) => m.variant_id),
      );
  const snapshots = [];
  for (const m of mappings) {
    const remaining = m.capacity - (await allocationCount(db, m.id));
    const v = proofs
      ? proofs.find((v) => v?.id === m.variant_id)
      : {
          id: m.variant_id,
          sku: m.sku,
          inventoryPolicy: "DENY",
          inventoryQuantity: remaining,
          product: { id: m.product_id, status: "ACTIVE" },
          inventoryItem: { tracked: true, requiresShipping: true },
        };
    checkProof(m, v, remaining, true);
    snapshots.push(v);
  }
  await db.query(
    "insert into ns.break_sale_checks(tenant_id,event_id,event_version,actor_id,evidence,reason) values($1,$2,$3,$4,$5,$6)",
    [
      TENANT,
      id,
      e.version,
      a.staff_id,
      JSON.stringify({ sample, checks, evidence, variants: snapshots }),
      shortText(reason),
    ],
  );
  await db.query(
    "update ns.break_events set sale_open=true where tenant_id=$1 and id=$2",
    [TENANT, id],
  );
  await breakAudit(db, a, id, "sale.reconciled", reason, null, {
    sample,
    evidence,
  });
  return {
    message: sample
      ? "SAMPLE reconciliation saved. Live purchases remain disabled."
      : "Reconciliation saved. Global purchase gate still applies.",
  };
}
export async function validateBreakCart(
  db: Sql,
  lines: { variantId: string; quantity: number }[],
  authenticated: boolean,
  query?: Query,
) {
  const totals = new Map<string, number>();
  for (const l of lines) {
    if (l.quantity > 0)
      totals.set(l.variantId, (totals.get(l.variantId) || 0) + l.quantity);
  }
  const mappings = (
    await db.query<BreakMapping & BreakEvent & { mapping_id: string }>(
      "select e.*,m.*,m.id mapping_id from ns.shopify_spot_mappings m join ns.break_events e on e.tenant_id=m.tenant_id and e.id=m.event_id where m.tenant_id=$1 and m.variant_id=any($2::text[])",
      [TENANT, [...totals.keys()]],
    )
  ).rows;
  if (!mappings.length) return;
  if (!authenticated)
    throw new AccessError(401, "sign_in_before_buying_break_spots");
  if (process.env.SHOPIFY_BREAK_CHECKOUT_VERIFIED !== "true")
    throw new AccessError(503, "real_concurrent_checkout_test_required");
  const proofs = await variantProof(
    query || (await adminQuery()),
    mappings.map((m) => m.variant_id),
  );
  for (const m of mappings) {
    if (
      m.fixture ||
      !m.active ||
      !m.sale_open ||
      !m.published ||
      m.started_at ||
      !m.starts_at ||
      new Date(m.starts_at).getTime() <= Date.now() ||
      !["scheduled", "delayed"].includes(m.status)
    )
      throw new AccessError(409, "break_sales_closed");
    const check = (
      await db.query(
        "select id from ns.break_sale_checks where tenant_id=$1 and event_id=$2 and event_version=$3",
        [TENANT, m.event_id, m.version],
      )
    ).rows.length;
    const conflicts = (
      await db.query(
        "select id from ns.break_exceptions where tenant_id=$1 and (event_id=$2 or event_id is null) and status='open'",
        [TENANT, m.event_id],
      )
    ).rows.length;
    const remaining = m.capacity - (await allocationCount(db, m.mapping_id)),
      requested = totals.get(m.variant_id)!;
    if (!check || conflicts || remaining < requested)
      throw new AccessError(409, "break_capacity_or_review_required");
    const v = proofs.find((v) => v?.id === m.variant_id);
    checkProof(m, v, remaining);
    if (!v || v.inventoryQuantity < requested)
      throw new AccessError(409, "spot_sold_out");
  }
}
