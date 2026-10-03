import "server-only";
import { createHash } from "node:crypto";
import { type Actor, type Sql, requireCustomer, requireRole } from "./db";
import { AccessError } from "./security";
import { publicFlags } from "../policy.mjs";
import { SHOP, TENANT } from "./providers";
import type {
  LoyaltyRules,
  LoyaltyRule,
  LoyaltyReward,
  LoyaltyOrder,
  LoyaltyOrderLine,
  LoyaltyWallet,
  RewardTerms,
} from "../loyalty";
export type LoyaltyMode = "live" | "sample";
export function loyaltyGate(
  mode: LoyaltyMode,
  purpose: "earning" | "redemption",
) {
  if (mode === "sample") {
    if (process.env.NODE_ENV === "production")
      throw new AccessError(404, "not_found");
    return true;
  }
  return purpose === "earning"
    ? publicFlags.loyaltyEarning
    : publicFlags.loyaltyRedemption;
}
export function integer(n: unknown, min = 0, max = 100_000_000) {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max)
    throw new AccessError(400, "invalid_integer_amount");
  return n;
}
export function shortText(v: unknown, max = 1000) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new AccessError(400, "reason_or_value_required");
  return v.trim();
}
export function uuid(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      v,
    )
  )
    throw new AccessError(400, "invalid_record_id");
  return v;
}
export const fingerprint = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function ids(v: unknown, kind: string) {
  if (
    !Array.isArray(v) ||
    v.length > 100 ||
    v.some(
      (x) =>
        typeof x !== "string" ||
        !new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(x),
    ) ||
    new Set(v).size !== v.length
  )
    throw new AccessError(400, "invalid_eligible_ids");
  return v as string[];
}
export function validateRules(value: unknown): LoyaltyRules {
  if (!value || typeof value !== "object")
    throw new AccessError(400, "rules_required");
  const p = value as LoyaltyRules;
  integer(p.points_per_dollar, 1, 1000);
  integer(p.qualification_days, 1, 3650);
  if (
    !Array.isArray(p.tiers) ||
    p.tiers.length !== 4 ||
    new Set(p.tiers.map((t) => t.label)).size !== 4
  )
    throw new AccessError(400, "four_distinct_tiers_required");
  p.tiers.forEach((t, i) => {
    shortText(t.label, 30);
    integer(t.threshold_cents);
    if (
      (!i && t.threshold_cents !== 0) ||
      (i && t.threshold_cents <= p.tiers[i - 1].threshold_cents)
    )
      throw new AccessError(400, "tier_thresholds_must_increase");
  });
  if (!Array.isArray(p.eligible_products) || p.eligible_products.length > 100)
    throw new AccessError(400, "eligible_product_registry_required");
  ids(
    p.eligible_products.map((p) => p.id),
    "Product",
  );
  if (
    p.eligible_products.some(
      (p) => !["retail", "grading", "consignment", "break"].includes(p.kind),
    ) ||
    !Array.isArray(p.approved_service_kinds) ||
    p.approved_service_kinds.some(
      (k) => !["grading", "consignment", "break"].includes(k),
    )
  )
    throw new AccessError(400, "invalid_service_approval");
  ids(p.excluded_product_ids, "Product");
  if (
    p.points_expiry !== "none" ||
    p.rounding !== "floor_per_line_cumulative" ||
    p.tier_returns !== "reduce_original_period" ||
    p.refund_restoration !== "manual_review"
  )
    throw new AccessError(400, "unsupported_policy_requires_implementation");
  return structuredClone(p);
}
export function validateReward(value: unknown, cents: number): RewardTerms {
  const p = value as RewardTerms;
  if (!p || typeof p !== "object")
    throw new AccessError(400, "reward_terms_required");
  shortText(p.title, 100);
  integer(p.minimum_cents, cents);
  integer(p.expiry_days, 1, 365);
  ids(p.product_ids, "Product");
  ids(p.collection_ids, "Collection");
  if (
    (!p.product_ids.length && !p.collection_ids.length) ||
    (p.product_ids.length && p.collection_ids.length)
  )
    throw new AccessError(400, "choose_products_or_collections");
  if (
    !p.combines ||
    [
      p.combines.orderDiscounts,
      p.combines.productDiscounts,
      p.combines.shippingDiscounts,
    ].some((x) => typeof x !== "boolean")
  )
    throw new AccessError(400, "combination_rules_required");
  // Same-cart product/order discounts can reduce eligible spend below the purchased fixed value. Unsupported until checkout allocation is verified.
  if (p.combines.orderDiscounts || p.combines.productDiscounts)
    throw new AccessError(400, "product_and_order_stacking_not_supported");
  return structuredClone(p);
}
export async function loyaltyAudit(
  db: Sql,
  a: Actor,
  action: string,
  object: string,
  reason: unknown,
) {
  requireRole(a, ["owner", "admin"]);
  await db.query(
    "insert into ns.loyalty_audit(tenant_id,actor_id,action,object_id,reason) values($1,$2,$3,$4,$5)",
    [a.tenant_id, a.staff_id, action, object, shortText(reason)],
  );
}
export async function createRule(
  db: Sql,
  a: Actor,
  parameters: unknown,
  reason: unknown,
  mode: LoyaltyMode = "live",
) {
  requireRole(a, ["owner", "admin"]);
  const p = validateRules(parameters);
  shortText(reason);
  loyaltyGate(mode, "earning");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + "/loyalty-rules",
  ]);
  const r = (
    await db.query<LoyaltyRule>(
      "insert into ns.loyalty_rules(tenant_id,version,parameters,fixture) select $1,coalesce(max(version),0)+1,$2,$3 from ns.loyalty_rules where tenant_id=$1 returning *",
      [a.tenant_id, JSON.stringify(p), mode === "sample"],
    )
  ).rows[0];
  await loyaltyAudit(db, a, "rule.draft", r.id, reason);
  return r;
}
export async function approveRule(
  db: Sql,
  a: Actor,
  id: string,
  effectiveAt: string,
  reason: string,
  mode: LoyaltyMode = "live",
) {
  requireRole(a, ["owner", "admin"]);
  uuid(id);
  shortText(reason);
  if (
    mode === "live" &&
    (!process.env.LOYALTY_APPROVER_STAFF_ID ||
      a.staff_id !== process.env.LOYALTY_APPROVER_STAFF_ID)
  )
    throw new AccessError(403, "joey_approval_identity_not_verified");
  loyaltyGate(mode, "earning");
  const time = Date.parse(effectiveAt);
  if (!Number.isFinite(time) || (mode === "live" && time < Date.now()))
    throw new AccessError(400, "future_effective_date_required");
  const draft = (
    await db.query<LoyaltyRule>(
      "select * from ns.loyalty_rules where tenant_id=$1 and id=$2",
      [a.tenant_id, id],
    )
  ).rows[0];
  if (!draft || draft.approved_by || draft.fixture !== (mode === "sample"))
    throw new AccessError(409, "draft_not_available");
  validateRules(draft.parameters);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + "/loyalty-rules",
  ]);
  const r = (
    await db.query<LoyaltyRule>(
      "insert into ns.loyalty_rules(tenant_id,version,parameters,fixture,approved_by,effective_at) select $1,coalesce(max(version),0)+1,$2,$3,$4,$5 from ns.loyalty_rules where tenant_id=$1 returning *",
      [
        a.tenant_id,
        JSON.stringify(draft.parameters),
        draft.fixture,
        a.staff_id,
        new Date(time).toISOString(),
      ],
    )
  ).rows[0];
  await loyaltyAudit(db, a, "rule.approved_version", r.id, reason);
  return r;
}
export async function activeRule(
  db: Sql,
  tenant = TENANT,
  mode: LoyaltyMode = "live",
  at = new Date().toISOString(),
) {
  return (
    (
      await db.query<LoyaltyRule>(
        "select * from ns.loyalty_rules where tenant_id=$1 and approved_by is not null and effective_at<=$2 and fixture=$3 order by effective_at desc,version desc limit 1",
        [tenant, at, mode === "sample"],
      )
    ).rows[0] || null
  );
}
export async function createReward(
  db: Sql,
  a: Actor,
  input: {
    rule_id: string;
    points_cost: number;
    value_cents: number;
    terms: RewardTerms;
  },
  reason: string,
) {
  requireRole(a, ["owner", "admin"]);
  uuid(input.rule_id);
  integer(input.points_cost, 1, 1_000_000);
  integer(input.value_cents, 1, 100_000);
  shortText(reason);
  const terms = validateReward(input.terms, input.value_cents);
  const rule = (
    await db.query<LoyaltyRule>(
      "select * from ns.loyalty_rules where tenant_id=$1 and id=$2",
      [a.tenant_id, input.rule_id],
    )
  ).rows[0];
  if (!rule) throw new AccessError(404, "rule_not_found");
  const r = (
    await db.query<{ id: string }>(
      "insert into ns.rewards(tenant_id,rule_id,points_cost,value_cents,terms) values($1,$2,$3,$4,$5) returning id",
      [
        a.tenant_id,
        rule.id,
        input.points_cost,
        input.value_cents,
        JSON.stringify(terms),
      ],
    )
  ).rows[0];
  await loyaltyAudit(db, a, "reward.created", r.id, reason);
  return r;
}
export async function rewardActive(
  db: Sql,
  a: Actor,
  id: string,
  active: boolean,
  reason: string,
  mode: LoyaltyMode = "live",
) {
  requireRole(a, ["owner", "admin"]);
  shortText(reason);
  if (typeof active !== "boolean")
    throw new AccessError(400, "invalid_active_state");
  loyaltyGate(mode, "redemption");
  if (
    active &&
    mode === "live" &&
    (!process.env.LOYALTY_APPROVER_STAFF_ID ||
      a.staff_id !== process.env.LOYALTY_APPROVER_STAFF_ID)
  )
    throw new AccessError(403, "joey_approval_identity_not_verified");
  const r = await db.query(
    "update ns.rewards set active=$3,approved_by=case when $3 then coalesce(approved_by,$4) else approved_by end,approved_at=case when $3 then coalesce(approved_at,now()) else approved_at end where tenant_id=$1 and id=$2 returning id",
    [a.tenant_id, uuid(id), active, a.staff_id],
  );
  if (!r.rows.length) throw new AccessError(404, "reward_not_found");
  await loyaltyAudit(
    db,
    a,
    active ? "reward.enabled_definition" : "reward.suspended",
    id,
    reason,
  );
}
export async function enroll(db: Sql, a: Actor, mode: LoyaltyMode = "live") {
  requireCustomer(a);
  if (
    !loyaltyGate(mode, "earning") ||
    !(await activeRule(db, a.tenant_id, mode))
  )
    throw new AccessError(409, "program_not_launched");
  const m = (
    await db.query(
      "select shopify_id from ns.shopify_customers where tenant_id=$1 and customer_id=$2 and shop=$3",
      [a.tenant_id, a.customer_id, SHOP],
    )
  ).rows[0];
  if (!m) throw new AccessError(409, "verified_shopify_profile_required");
  await db.query(
    "insert into ns.loyalty_accounts(tenant_id,customer_id,enrolled_at) values($1,$2,now()) on conflict(tenant_id,customer_id) do nothing",
    [a.tenant_id, a.customer_id],
  );
}
export async function lockAccount(db: Sql, tenant: string, customer: string) {
  const r = (
    await db.query<{
      id: string;
      customer_id: string;
      cached_points: string | number;
      enrolled_at: string | null;
    }>(
      "select * from ns.loyalty_accounts where tenant_id=$1 and customer_id=$2 for update",
      [tenant, customer],
    )
  ).rows[0];
  if (!r?.enrolled_at) throw new AccessError(409, "not_enrolled");
  const ledger = Number(
    (
      await db.query<{ points: string }>(
        "select coalesce(sum(points),0) points from ns.loyalty_ledger where tenant_id=$1 and account_id=$2",
        [tenant, r.id],
      )
    ).rows[0].points,
  );
  if (ledger !== Number(r.cached_points))
    throw new AccessError(409, "balance_reconciliation_required");
  return r;
}
export async function postPoints(
  db: Sql,
  p: {
    tenant: string;
    customer: string;
    account: string;
    rule: string;
    points: number;
    source: string;
    operation: string;
    kind: string;
    reason: string;
    actor?: string | null;
  },
) {
  integer(p.points, -100_000_000, 100_000_000);
  if (!p.points) return false;
  return !!(
    await db.query(
      "insert into ns.loyalty_ledger(tenant_id,customer_id,account_id,rule_id,points,source_object,operation,kind,reason,actor_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(tenant_id,source_object,operation) do nothing returning id",
      [
        p.tenant,
        p.customer,
        p.account,
        p.rule,
        p.points,
        p.source,
        p.operation,
        p.kind,
        p.reason,
        p.actor || null,
      ],
    )
  ).rows.length;
}
export function lineAllocation(
  line: LoyaltyOrderLine,
  p: LoyaltyRules,
  original?: { cents: number; points: number; eligible: boolean },
) {
  for (const v of [
    line.quantity,
    line.currentQuantity,
    line.originalNetCents,
    line.refundedCents,
    line.refundedQuantity,
  ])
    integer(v);
  if (
    line.quantity < 1 ||
    line.currentQuantity + line.refundedQuantity > line.quantity
  )
    throw new AccessError(409, "line_quantity_review");
  const registry = p.eligible_products.find((x) => x.id === line.productId);
  const eligible =
    original?.eligible ??
    (!!registry &&
      !line.isGiftCard &&
      !p.excluded_product_ids.includes(registry.id) &&
      (registry.kind === "retail" ||
        p.approved_service_kinds.includes(registry.kind)));
  const base = original?.cents ?? line.originalNetCents;
  const points =
    original?.points ??
    Number((BigInt(base) * BigInt(p.points_per_dollar)) / 100n);
  integer(points);
  const removed = line.quantity - line.currentQuantity - line.refundedQuantity;
  const removedCents = Number(
    (BigInt(line.originalNetCents) * BigInt(removed)) / BigInt(line.quantity),
  );
  if (line.currentNetCents !== undefined) integer(line.currentNetCents);
  const current = Math.max(
    0,
    Math.min(
      base,
      line.originalNetCents - line.refundedCents - removedCents,
      line.currentNetCents ?? base,
    ),
  );
  // Reverse cumulative points against the original allocation once; never round each refund independently.
  const target = base
    ? points - Number((BigInt(points) * BigInt(base - current)) / BigInt(base))
    : 0;
  return {
    eligible,
    base,
    points: eligible ? points : 0,
    current: eligible ? current : 0,
    target: eligible ? target : 0,
  };
}
export async function openReview(
  db: Sql,
  tenant: string,
  customer: string | null,
  kind: string,
  object: string,
  source: string,
  details: string,
) {
  await db.query(
    "insert into ns.loyalty_reviews(tenant_id,customer_id,kind,object_id,source_id,details) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,source_id) do nothing",
    [tenant, customer, kind, object, source, details],
  );
}
type StoredOrder = {
  customer_id: string | null;
  rule_id: string | null;
  provider_updated_at: string;
  fingerprint: string;
  revision: number;
  state: string;
};
export async function reconcileLoyaltyOrder(
  db: Sql,
  o: LoyaltyOrder,
  mode: LoyaltyMode = "live",
  tenant = TENANT,
) {
  if (tenant !== TENANT)
    throw new AccessError(403, "worker_tenant_not_authorized");
  if (
    !/^gid:\/\/shopify\/Order\/[0-9]+$/.test(o.id) ||
    o.currency !== "USD" ||
    !Number.isFinite(Date.parse(o.updatedAt)) ||
    !Number.isFinite(Date.parse(o.createdAt)) ||
    o.lines.length > 250 ||
    new Set(o.lines.map((l) => l.id)).size !== o.lines.length
  )
    throw new AccessError(400, "invalid_verified_order");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    tenant + "/loyalty-order/" + o.id,
  ]);
  const prior = (
    await db.query<StoredOrder>(
      "select * from ns.loyalty_orders where tenant_id=$1 and order_id=$2 for update",
      [tenant, o.id],
    )
  ).rows[0];
  if (
    prior &&
    new Date(prior.provider_updated_at).getTime() > Date.parse(o.updatedAt)
  )
    return { state: "stale_ignored" };
  const hash = fingerprint(o);
  if (
    o.campaignRef &&
    !(
      await db.query(
        "select ref from ns.campaign_refs where tenant_id=$1 and ref=$2 and enabled=true",
        [tenant, o.campaignRef],
      )
    ).rows.length
  )
    o = { ...o, campaignRef: null };
  if (prior?.fingerprint === hash && prior.state === "reconciled")
    return { state: "duplicate" };
  const customer = o.customerId
    ? (
        await db.query<{ customer_id: string }>(
          "select customer_id from ns.shopify_customers where tenant_id=$1 and shop=$2 and shopify_id=$3",
          [tenant, SHOP, o.customerId],
        )
      ).rows[0]?.customer_id || null
    : null;
  if (prior?.customer_id && prior.customer_id !== customer) {
    await openReview(
      db,
      tenant,
      prior.customer_id,
      "ownership",
      o.id,
      "owner/" + o.id,
      "Provider customer changed; no reparenting or automatic points movement.",
    );
    return { state: "ownership_review" };
  }
  const rule = prior?.rule_id
    ? (
        await db.query<LoyaltyRule>(
          "select * from ns.loyalty_rules where tenant_id=$1 and id=$2",
          [tenant, prior.rule_id],
        )
      ).rows[0]
    : await activeRule(db, tenant, mode, o.createdAt);
  let state = "reconciled",
    reason: string | null = null;
  const canEarn = loyaltyGate(mode, "earning");
  if (!rule || (!canEarn && !prior?.rule_id)) state = "not_launched";
  else if (!customer) state = "awaiting_verified_owner";
  const account = customer
    ? (
        await db.query<{ id: string; enrolled_at: string | null }>(
          "select id,enrolled_at from ns.loyalty_accounts where tenant_id=$1 and customer_id=$2",
          [tenant, customer],
        )
      ).rows[0]
    : null;
  if (
    state === "reconciled" &&
    (!account?.enrolled_at ||
      Date.parse(o.createdAt) < new Date(account.enrolled_at).getTime())
  )
    state = "not_enrolled_at_purchase";
  if (
    state === "reconciled" &&
    (o.ambiguousRefund ||
      (!o.cancelled &&
        !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
          o.financialStatus,
        )) ||
      (!o.paidAt && !o.cancelled))
  ) {
    state = "review";
    reason =
      "Unallocated refund or unsupported payment state. Preserve current points pending evidence.";
  }
  await db.query(
    "insert into ns.loyalty_orders(tenant_id,order_id,customer_id,rule_id,created_at,provider_updated_at,fingerprint,snapshot,state,review_reason,channel,campaign_ref) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(tenant_id,order_id) do update set customer_id=excluded.customer_id,rule_id=coalesce(ns.loyalty_orders.rule_id,excluded.rule_id),provider_updated_at=excluded.provider_updated_at,fingerprint=excluded.fingerprint,snapshot=excluded.snapshot,state=excluded.state,review_reason=excluded.review_reason,reconciled_at=now()",
    [
      tenant,
      o.id,
      customer,
      rule?.id || null,
      o.createdAt,
      o.updatedAt,
      hash,
      JSON.stringify(o),
      state,
      reason,
      o.channel,
      o.campaignRef,
    ],
  );
  if (state !== "reconciled" || !rule || !customer || !account) {
    if (["review", "awaiting_verified_owner"].includes(state))
      await openReview(
        db,
        tenant,
        customer,
        state,
        o.id,
        state + "/" + o.id,
        reason ||
          "Awaiting a verified Shopify customer association; email and order number cannot claim this order.",
      );
    return { state };
  }
  const p = validateRules(rule.parameters);
  await lockAccount(db, tenant, customer);
  const existing = (
    await db.query<{
      line_id: string;
      original_cents: string;
      original_points: number;
      current_points: number;
      eligibility: { eligible: boolean; quantity?: number };
      revision: number;
    }>(
      "select * from ns.loyalty_line_allocations where tenant_id=$1 and order_id=$2",
      [tenant, o.id],
    )
  ).rows;
  // Validate the complete order before posting any line. An existing line cannot
  // grow beyond its frozen allocation without reviewed, additional payment evidence.
  try {
    for (const line of o.lines) {
      const old = existing.find((x) => x.line_id === line.id);
      if (
        old &&
        !o.cancelled &&
        (line.originalNetCents > Number(old.original_cents) ||
          (line.currentNetCents ?? 0) > Number(old.original_cents) ||
          line.quantity > (old.eligibility.quantity ?? line.quantity))
      )
        throw new AccessError(409, "increased_line_requires_payment_review");
      lineAllocation(
        line,
        p,
        old
          ? {
              cents: Number(old.original_cents),
              points: old.original_points,
              eligible: old.eligibility.eligible,
            }
          : undefined,
      );
    }
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    await db.query(
      "update ns.loyalty_orders set state='review',review_reason=$3 where tenant_id=$1 and order_id=$2",
      [tenant, o.id, error.message],
    );
    await openReview(
      db,
      tenant,
      customer,
      "line_edit",
      o.id,
      "line_edit/" + o.id + "/" + hash,
      "Unsupported line quantity or increased amount. Preserve posted earnings; reconcile payment evidence and use an audited correction if required.",
    );
    return { state: "review" };
  }
  const revision = (prior?.revision || 0) + 1;
  let total = 0;
  for (const line of o.lines) {
    const old = existing.find((x) => x.line_id === line.id);
    const alloc = lineAllocation(
      line,
      p,
      old
        ? {
            cents: Number(old.original_cents),
            points: old.original_points,
            eligible: old.eligibility.eligible,
          }
        : undefined,
    );
    if (o.cancelled) {
      alloc.target = 0;
      alloc.current = 0;
    }
    if (!canEarn && alloc.target > (old?.current_points || 0))
      alloc.target = old?.current_points || 0;
    if (!old)
      await db.query(
        "insert into ns.loyalty_line_allocations(tenant_id,order_id,line_id,customer_id,rule_id,eligibility,original_cents,original_points,current_cents,current_points) values($1,$2,$3,$4,$5,$6,$7,$8,0,0)",
        [
          tenant,
          o.id,
          line.id,
          customer,
          rule.id,
          JSON.stringify({
            eligible: alloc.eligible,
            productId: line.productId,
            variantId: line.variantId,
            isGiftCard: line.isGiftCard,
            quantity: line.quantity,
          }),
          alloc.base,
          alloc.points,
        ],
      );
    const delta = alloc.target - (old?.current_points || 0);
    await postPoints(db, {
      tenant,
      customer,
      account: account.id,
      rule: rule.id,
      points: delta,
      source: o.id + "/" + line.id,
      operation: "reconcile/" + revision,
      kind: delta < 0 ? "reversal" : "earned",
      reason:
        delta < 0
          ? "Purchase refund / edit reversal"
          : "Eligible paid purchase",
    });
    await db.query(
      "update ns.loyalty_line_allocations set current_cents=$4,current_points=$5,revision=$6 where tenant_id=$1 and order_id=$2 and line_id=$3",
      [tenant, o.id, line.id, alloc.current, alloc.target, revision],
    );
    total += alloc.current;
  }
  for (const old of existing.filter(
    (x) => !o.lines.some((l) => l.id === x.line_id),
  )) {
    await postPoints(db, {
      tenant,
      customer,
      account: account.id,
      rule: rule.id,
      points: -old.current_points,
      source: o.id + "/" + old.line_id,
      operation: "reconcile/" + revision,
      kind: "reversal",
      reason: "Removed purchase line",
    });
    await db.query(
      "update ns.loyalty_line_allocations set current_cents=0,current_points=0,revision=$4 where tenant_id=$1 and order_id=$2 and line_id=$3",
      [tenant, o.id, old.line_id, revision],
    );
  }
  await db.query(
    "update ns.loyalty_orders set qualifying_cents=$3,revision=$4 where tenant_id=$1 and order_id=$2",
    [tenant, o.id, total, revision],
  );
  const tier = await tierProgress(db, tenant, customer, rule);
  await db.query(
    "insert into ns.tier_qualifications(tenant_id,customer_id,rule_id,tier,period_start,period_end,qualifying_cents) values($1,$2,$3,$4,$5,$6,$7)",
    [
      tenant,
      customer,
      rule.id,
      tier.label,
      tier.period_start,
      tier.period_end,
      tier.qualifying_cents,
    ],
  );
  const balance = (
    await db.query<{ cached_points: string }>(
      "select cached_points from ns.loyalty_accounts where tenant_id=$1 and id=$2",
      [tenant, account.id],
    )
  ).rows[0];
  if (Number(balance.cached_points) < 0)
    await openReview(
      db,
      tenant,
      customer,
      "negative_balance",
      account.id,
      "negative/" + o.id + "/" + revision,
      "A purchase reversal left a negative balance. Preserve the ledger; spendable points are zero.",
    );
  return { state, qualifying_cents: total };
}
export async function adjustment(
  db: Sql,
  a: Actor,
  input: {
    customer_id: string;
    points: number;
    source_id: string;
    reason: string;
  },
  mode: LoyaltyMode = "live",
) {
  requireRole(a, ["owner", "admin"]);
  uuid(input.customer_id);
  uuid(input.source_id);
  integer(input.points, -1_000_000, 1_000_000);
  shortText(input.reason);
  if (!loyaltyGate(mode, "earning"))
    throw new AccessError(409, "program_not_launched");
  const r = await activeRule(db, a.tenant_id, mode);
  if (!r) throw new AccessError(409, "approved_rule_required");
  const account = await lockAccount(db, a.tenant_id, input.customer_id);
  const posted = await postPoints(db, {
    tenant: a.tenant_id,
    customer: input.customer_id,
    account: account.id,
    rule: r.id,
    points: input.points,
    source: input.source_id,
    operation: "staff-adjustment",
    kind: "adjustment",
    reason: "Northside points correction",
    actor: a.staff_id,
  });
  if (posted)
    await loyaltyAudit(
      db,
      a,
      "ledger.adjustment",
      input.source_id,
      input.reason,
    );
  return { posted };
}
export async function tierProgress(
  db: Sql,
  tenant: string,
  customer: string,
  rule: LoyaltyRule,
  at = new Date(),
) {
  const end = at.toISOString(),
    start = new Date(
      at.getTime() - rule.parameters.qualification_days * 86400000,
    ).toISOString();
  const cents = Number(
    (
      await db.query<{ cents: string }>(
        "select coalesce(sum(qualifying_cents),0) as cents from ns.loyalty_orders where tenant_id=$1 and customer_id=$2 and created_at>=$3 and created_at<=$4",
        [tenant, customer, start, end],
      )
    ).rows[0].cents,
  );
  const tiers = rule.parameters.tiers;
  const current = [...tiers].reverse().find((t) => cents >= t.threshold_cents)!;
  return {
    label: current.label,
    qualifying_cents: cents,
    next: tiers.find((t) => t.threshold_cents > cents) || null,
    period_start: start,
    period_end: end,
  };
}
export async function wallet(
  db: Sql,
  a: Actor,
  mode: LoyaltyMode = "live",
): Promise<LoyaltyWallet> {
  requireCustomer(a);
  const rule = await activeRule(db, a.tenant_id, mode);
  const account = (
    await db.query<{
      id: string;
      cached_points: string;
      enrolled_at: string | null;
    }>(
      "select * from ns.loyalty_accounts where tenant_id=$1 and customer_id=$2",
      [a.tenant_id, a.customer_id],
    )
  ).rows[0];
  const launched = loyaltyGate(mode, "earning") && !!rule;
  const reservations = (
    await db.query<LoyaltyWallet["reservations"][number]>(
      "select id,status,points,created_at,snapshot from ns.redemption_reservations where tenant_id=$1 and customer_id=$2 order by created_at desc limit 100",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  const held = Number(
    (
      await db.query<{ held: string }>(
        "select coalesce(sum(points),0) as held from ns.redemption_reservations where tenant_id=$1 and customer_id=$2 and status in ('held','review')",
        [a.tenant_id, a.customer_id],
      )
    ).rows[0].held,
  );
  const balance = account?.enrolled_at ? Number(account.cached_points) : null;
  const rewards = rule
    ? (
        await db.query<LoyaltyReward & { terms: RewardTerms }>(
          "select * from ns.rewards where tenant_id=$1 and rule_id=$2 and active=true order by points_cost",
          [a.tenant_id, rule.id],
        )
      ).rows.map((r) => ({ ...r, ...r.terms }))
    : [];
  const ledger = (
    await db.query<LoyaltyWallet["ledger"][number]>(
      "select id,points,kind,reason,rule_id,created_at from ns.loyalty_ledger where tenant_id=$1 and customer_id=$2 order by created_at desc limit 100",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  const vouchers = (
    await db.query<LoyaltyWallet["vouchers"][number]>(
      "select v.id,v.reservation_id,v.code,v.status,v.issued_at,v.snapshot,coalesce(sum(u.amount_cents),0)::integer as used_cents,count(u.order_id)::integer as used_orders from ns.shopify_vouchers v left join ns.loyalty_voucher_usage u on u.tenant_id=v.tenant_id and u.voucher_id=v.id where v.tenant_id=$1 and v.customer_id=$2 group by v.tenant_id,v.id order by v.issued_at desc limit 100",
      [a.tenant_id, a.customer_id],
    )
  ).rows;
  return {
    state: !launched
      ? "not_launched"
      : balance === null
        ? "not_enrolled"
        : "ready",
    rule,
    balance,
    held,
    spendable: Math.max(0, (balance || 0) - held),
    negative_review: (balance || 0) < 0,
    enrolled_at: account?.enrolled_at || null,
    tier:
      rule && account
        ? await tierProgress(db, a.tenant_id, a.customer_id!, rule)
        : null,
    rewards,
    ledger,
    reservations,
    vouchers,
  };
}
export async function dispute(
  db: Sql,
  a: Actor,
  entry: string,
  reason: string,
) {
  requireCustomer(a);
  uuid(entry);
  shortText(reason);
  if (
    !(
      await db.query(
        "select id from ns.loyalty_ledger where tenant_id=$1 and customer_id=$2 and id=$3",
        [a.tenant_id, a.customer_id, entry],
      )
    ).rows.length
  )
    throw new AccessError(404, "entry_not_found");
  await openReview(
    db,
    a.tenant_id,
    a.customer_id,
    "dispute",
    entry,
    "dispute/" + entry,
    reason,
  );
}
export async function requestOrderClaim(db: Sql, a: Actor, orderId: string) {
  requireCustomer(a);
  // Only a provider-verified current order/customer association can enqueue a recheck. A supplied order ID is never a claim credential.
  if (
    !(
      await db.query(
        "select o.order_id from ns.shopify_orders o join ns.shopify_customers c on c.tenant_id=o.tenant_id and c.shop=o.shop and c.shopify_id=o.shopify_customer_id where o.tenant_id=$1 and c.customer_id=$2 and o.order_id=$3",
        [a.tenant_id, a.customer_id, orderId],
      )
    ).rows.length
  )
    throw new AccessError(404, "verified_owned_order_required");
  await openReview(
    db,
    a.tenant_id,
    a.customer_id,
    "dispute",
    orderId,
    "claim/" + orderId,
    "Authenticated owner requested recheck. Staff must queue a fresh provider read; original program/enrollment dates still apply.",
  );
}
