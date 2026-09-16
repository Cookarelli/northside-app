import "server-only";
import { type Sql, type Actor, requireRole } from "./db";
import { AccessError } from "./security";
import {
  activeRule,
  integer,
  loyaltyAudit,
  shortText,
  uuid,
  type LoyaltyMode,
} from "./loyalty";
import type { LoyaltyRule, RewardTerms } from "../loyalty";
export function reportPeriod(from?: string, to?: string) {
  const end = to ? Date.parse(to) : Date.now(),
    start = from ? Date.parse(from) : end - 30 * 86400000;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > 366 * 86400000
  )
    throw new AccessError(400, "period_must_be_up_to_one_year");
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}
export async function reconciliationReport(db: Sql, a: Actor) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const balances = (
    await db.query<{
      id: string;
      cached_points: string;
      ledger_points: string;
      held_points: string;
    }>(
      `select a.id,a.cached_points,coalesce((select sum(l.points) from ns.loyalty_ledger l where l.tenant_id=a.tenant_id and l.account_id=a.id),0) ledger_points,coalesce((select sum(r.points) from ns.redemption_reservations r where r.tenant_id=a.tenant_id and r.account_id=a.id and r.status in ('held','review')),0) held_points from ns.loyalty_accounts a where a.tenant_id=$1`,
      [a.tenant_id],
    )
  ).rows;
  const issues = balances
    .filter((b) => Number(b.cached_points) !== Number(b.ledger_points))
    .map((b) => ({ kind: "balance_mismatch", id: b.id }));
  const mappings = (
    await db.query<{ id: string }>(
      `select r.id from ns.redemption_reservations r where r.tenant_id=$1 and ((r.status='issued' and (not exists(select 1 from ns.shopify_vouchers v where v.tenant_id=r.tenant_id and v.reservation_id=r.id) or coalesce((select -sum(l.points) from ns.loyalty_ledger l where l.tenant_id=r.tenant_id and l.source_object=r.id::text and l.kind='exchange'),0)<>r.points)) or (r.status<>'issued' and exists(select 1 from ns.shopify_vouchers v where v.tenant_id=r.tenant_id and v.reservation_id=r.id)))`,
      [a.tenant_id],
    )
  ).rows;
  issues.push(
    ...mappings.map((b) => ({ kind: "voucher_debit_mismatch", id: b.id })),
  );
  const over = (
    await db.query<{ reservation_id: string }>(
      "select s.reservation_id from ns.loyalty_restorations s join ns.redemption_reservations r on r.tenant_id=s.tenant_id and r.id=s.reservation_id where s.tenant_id=$1 group by s.reservation_id,r.points having sum(s.points)>r.points",
      [a.tenant_id],
    )
  ).rows;
  issues.push(
    ...over.map((r) => ({
      kind: "restoration_over_cap",
      id: r.reservation_id,
    })),
  );
  return {
    checked_at: new Date().toISOString(),
    source: "Local persisted ledger, reservations and voucher mappings",
    accounts_checked: balances.length,
    issues,
    negative_accounts: balances.filter((b) => Number(b.ledger_points) < 0)
      .length,
    held_points: balances.reduce((n, b) => n + Number(b.held_points), 0),
    provider_verification: "Not a live Shopify reconciliation or checkout test",
  };
}
export async function loyaltyReport(
  db: Sql,
  a: Actor,
  from?: string,
  to?: string,
  valuation?: number,
  mode: LoyaltyMode = "live",
) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const p = reportPeriod(from, to);
  if (valuation !== undefined) integer(valuation, 0, 100);
  const nums = (
    await db.query<Record<string, string>>(
      `select count(distinct customer_id) filter(where kind='earned' and points>0) active_earners,coalesce(sum(points) filter(where kind='earned' and points>0),0) gross_earned,coalesce(-sum(points) filter(where kind='reversal' and points<0),0) reversals,coalesce(-sum(points) filter(where kind='exchange'),0) exchange_debits,coalesce(sum(points) filter(where kind='restoration'),0) restorations,coalesce(sum(points) filter(where kind='adjustment'),0) adjustments from ns.loyalty_ledger where tenant_id=$1 and created_at>=$2 and created_at<$3`,
      [a.tenant_id, p.start, p.end],
    )
  ).rows[0];
  const members = (
    await db.query<{ n: string }>(
      "select count(*) n from ns.loyalty_accounts where tenant_id=$1 and enrolled_at<$2",
      [a.tenant_id, p.end],
    )
  ).rows[0];
  const outstanding = (
    await db.query<{ n: string }>(
      "select coalesce(sum(points),0) n from ns.loyalty_ledger where tenant_id=$1 and created_at<$2",
      [a.tenant_id, p.end],
    )
  ).rows[0];
  const positive = (
    await db.query<{ n: string }>(
      "select coalesce(sum(greatest(n,0)),0) n from (select sum(points) n from ns.loyalty_ledger where tenant_id=$1 and created_at<$2 group by account_id) b",
      [a.tenant_id, p.end],
    )
  ).rows[0];
  const issued = (
    await db.query<{ n: string }>(
      "select count(*) n from ns.shopify_vouchers where tenant_id=$1 and issued_at>=$2 and issued_at<$3",
      [a.tenant_id, p.start, p.end],
    )
  ).rows[0];
  const used = (
    await db.query<{ n: string; amount: string }>(
      "select count(distinct voucher_id) n,coalesce(sum(amount_cents),0) amount from ns.loyalty_voucher_usage where tenant_id=$1 and paid_at>=$2 and paid_at<$3",
      [a.tenant_id, p.start, p.end],
    )
  ).rows[0];
  const repeat = (
    await db.query<{ n: string }>(
      "select count(*) n from (select customer_id from ns.loyalty_orders where tenant_id=$1 and customer_id is not null and created_at>=$2 and created_at<$3 and snapshot->>'paidAt' is not null and not (snapshot->>'cancelled')::boolean and qualifying_cents>0 group by customer_id having count(*)>=2) r",
      [a.tenant_id, p.start, p.end],
    )
  ).rows[0];
  const rule = await activeRule(db, a.tenant_id, mode),
    tiers: Record<string, number> = {};
  const asof = new Date();
  if (rule) {
    for (const t of rule.parameters.tiers) tiers[t.label] = 0;
    const rows = (
      await db.query<{ cents: string; n: string }>(
        "select cents,count(*) n from (select a.customer_id,coalesce(sum(o.qualifying_cents),0) cents from ns.loyalty_accounts a left join ns.loyalty_orders o on o.tenant_id=a.tenant_id and o.customer_id=a.customer_id and o.created_at>=$2 and o.created_at<=$3 where a.tenant_id=$1 and a.enrolled_at is not null group by a.customer_id) q group by cents",
        [
          a.tenant_id,
          new Date(
            asof.getTime() - rule.parameters.qualification_days * 86400000,
          ).toISOString(),
          asof.toISOString(),
        ],
      )
    ).rows;
    for (const r of rows) {
      const tier = [...rule.parameters.tiers]
        .reverse()
        .find((t) => Number(r.cents) >= t.threshold_cents)!;
      tiers[tier.label] += Number(r.n);
    }
  }
  const rec = await reconciliationReport(db, a);
  const metrics = [
    {
      key: "members",
      label: "Members",
      value: Number(members.n),
      unit: "members",
      period: `Before ${p.end}`,
      source: "loyalty_accounts.enrolled_at",
      definition: "Verified enrolled accounts by period end.",
    },
    ...Object.entries(nums).map(([key, value]) => ({
      key,
      label: (
        {
          active_earners: "Active earners",
          gross_earned: "Gross earned points",
          reversals: "Refund / edit reversals",
          exchange_debits: "Reward exchange debits",
          restorations: "Reviewed restorations",
          adjustments: "Signed staff adjustments",
        } as Record<string, string>
      )[key],
      value: Number(value),
      unit: key === "active_earners" ? "members" : "points",
      period: `${p.start} to ${p.end} (end excluded)`,
      source: "loyalty_ledger.created_at",
      definition: (
        {
          active_earners: "Distinct customers with positive purchase earnings.",
          gross_earned: "Positive purchase earning entries, before reversals.",
          reversals:
            "Absolute negative purchase refund/edit entries; separate from reward restoration.",
          exchange_debits: "Points spent when voucher issuance was confirmed.",
          restorations: "Audited compensating reward credits.",
          adjustments: "Signed reasoned staff corrections.",
        } as Record<string, string>
      )[key],
    })),
    {
      key: "outstanding",
      label: "Outstanding signed points",
      value: Number(outstanding.n),
      unit: "points",
      period: `Before ${p.end}`,
      source: "Sum of immutable ledger entries",
      definition:
        "Signed total; includes debt and already-held points. Not cash or a liability valuation.",
    },
    {
      key: "held",
      label: "Processing holds now",
      value: rec.held_points,
      unit: "points",
      period: rec.checked_at,
      source: "Current held/review reservations",
      definition:
        "Current snapshot, not a reconstructed historical hold balance; included within outstanding points.",
    },
    {
      key: "issued",
      label: "Vouchers issued",
      value: Number(issued.n),
      unit: "vouchers",
      period: `${p.start} to ${p.end}`,
      source: "shopify_vouchers.issued_at",
      definition: "Confirmed voucher mappings; does not mean used.",
    },
    {
      key: "used",
      label: "Vouchers used",
      value: Number(used.n),
      unit: "vouchers",
      period: `${p.start} to ${p.end}`,
      source: "Verified paid order discount allocations",
      definition:
        "Distinct vouchers with recorded paid usage; delayed webhooks can change this count.",
    },
    {
      key: "discount_cents",
      label: "Shopify discount amounts",
      value: Number(used.amount),
      unit: "USD cents",
      period: `${p.start} to ${p.end}`,
      source: "loyalty_voucher_usage.amount_cents",
      definition:
        "Gross observed reward discount allocation on paid orders before refund adjustments; not issued face value.",
    },
    {
      key: "repeat",
      label: "Repeat purchasers",
      value: Number(repeat.n),
      unit: "members",
      period: `${p.start} to ${p.end}`,
      source: "Current reconciled eligible paid orders",
      definition:
        "Customers with at least two non-cancelled orders retaining positive qualifying spend in period. No causal sales claim.",
    },
  ];
  const exposure =
    valuation === undefined
      ? null
      : {
          cents: Number(positive.n) * valuation,
          cents_per_point: valuation,
          definition:
            "Scenario: positive outstanding points × assumed cents per point. Includes held points; excludes already-issued vouchers. This is not an accounting liability.",
        };
  return {
    period: p,
    metrics,
    tiers,
    tier_as_of: asof.toISOString(),
    tier_rule_version: rule?.version || null,
    exposure,
    reconciliation: rec,
  };
}
export async function loyaltyStaff(
  db: Sql,
  a: Actor,
  mode: LoyaltyMode = "live",
  from?: string,
  to?: string,
  valuation?: number,
) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const rules = (
    await db.query<LoyaltyRule>(
      "select * from ns.loyalty_rules where tenant_id=$1 order by version desc limit 50",
      [a.tenant_id],
    )
  ).rows;
  const rewards = (
    await db.query<{
      id: string;
      rule_id: string;
      points_cost: number;
      value_cents: number;
      active: boolean;
      terms: RewardTerms;
    }>("select * from ns.rewards where tenant_id=$1 order by id limit 100", [
      a.tenant_id,
    ])
  ).rows;
  const accounts = (
    await db.query<{
      id: string;
      customer_id: string;
      display_name: string;
      cached_points: string;
      enrolled_at: string;
    }>(
      "select a.id,a.customer_id,c.display_name,a.cached_points,a.enrolled_at from ns.loyalty_accounts a join ns.customers c on c.tenant_id=a.tenant_id and c.id=a.customer_id where a.tenant_id=$1 order by a.enrolled_at desc limit 500",
      [a.tenant_id],
    )
  ).rows;
  const jobs = (
    await db.query<{
      id: string;
      kind: string;
      object_id: string;
      state: string;
      attempts: number;
      last_error: string | null;
    }>(
      "select id,kind,object_id,state,attempts,last_error from ns.loyalty_jobs where tenant_id=$1 and state<>'complete' order by created_at desc limit 100",
      [a.tenant_id],
    )
  ).rows;
  const reviews = (
    await db.query<{
      id: string;
      kind: string;
      object_id: string;
      details: string;
      state: string;
      created_at: string;
    }>(
      "select id,kind,object_id,details,state,created_at from ns.loyalty_reviews where tenant_id=$1 order by created_at desc limit 100",
      [a.tenant_id],
    )
  ).rows;
  const vouchers = (
    await db.query<{
      id: string;
      customer_id: string;
      status: string;
      issued_at: string;
      snapshot: unknown;
    }>(
      "select id,customer_id,status,issued_at,snapshot from ns.shopify_vouchers where tenant_id=$1 order by issued_at desc limit 100",
      [a.tenant_id],
    )
  ).rows;
  return {
    rules,
    rewards,
    accounts,
    jobs,
    reviews,
    vouchers,
    role: a.staff_role,
    report: await loyaltyReport(db, a, from, to, valuation, mode),
  };
}
export async function retryLoyaltyJob(
  db: Sql,
  a: Actor,
  id: string,
  reason: string,
) {
  requireRole(a, ["owner", "admin"]);
  uuid(id);
  shortText(reason);
  // Retain attempts: a previous uncertain issuance must never become a new first-attempt rejection and release a hold.
  const r = await db.query(
    "update ns.loyalty_jobs set state='pending',attempts=least(attempts,7),available_at=now(),lease_token=null,lease_until=null,last_error=null where tenant_id=$1 and id=$2 and state in ('failed','review') returning id",
    [a.tenant_id, id],
  );
  if (!r.rows.length)
    throw new AccessError(
      409,
      "job_requires_manual_provider_reconciliation_or_is_running",
    );
  await loyaltyAudit(db, a, "job.retry", id, reason);
}
export async function resolveLoyaltyReview(
  db: Sql,
  a: Actor,
  id: string,
  resolution: string,
  rejected: boolean,
) {
  requireRole(a, ["owner", "admin"]);
  uuid(id);
  shortText(resolution);
  const r = await db.query(
    "update ns.loyalty_reviews set state=$3,actor_id=$4,resolution=$5 where tenant_id=$1 and id=$2 and state='open' returning id",
    [
      a.tenant_id,
      id,
      rejected ? "rejected" : "resolved",
      a.staff_id,
      resolution,
    ],
  );
  if (!r.rows.length)
    throw new AccessError(409, "review_already_resolved_or_missing");
  await loyaltyAudit(db, a, "review.resolved", id, resolution);
}
const cell = (value: unknown) => {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export async function loyaltyCohortExport(
  db: Sql,
  a: Actor,
  from?: string,
  to?: string,
) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const p = reportPeriod(from, to);
  const rows = (
    await db.query<{
      campaign: string;
      cohort: string;
      orders: string;
      qualifying_cents: string;
      customers: string;
    }>(
      `select coalesce(o.campaign_ref,'unattributed') campaign,case when a.enrolled_at<=o.created_at then 'enrolled_at_purchase' else 'not_enrolled_at_purchase' end cohort,count(*) orders,sum(o.qualifying_cents) qualifying_cents,count(distinct o.customer_id) customers from ns.loyalty_orders o left join ns.loyalty_accounts a on a.tenant_id=o.tenant_id and a.customer_id=o.customer_id where o.tenant_id=$1 and o.created_at>=$2 and o.created_at<$3 and o.snapshot->>'paidAt' is not null group by campaign,cohort order by campaign,cohort`,
      [a.tenant_id, p.start, p.end],
    )
  ).rows;
  // Suppress small cohorts in exports; no names, customer/order IDs, codes, notes or financial case data.
  return [
    [
      "contract",
      "period_start_utc",
      "period_end_exclusive_utc",
      "campaign_ref",
      "cohort",
      "orders",
      "customers",
      "loyalty_qualifying_cents",
      "currency",
      "source",
    ],
    ...rows.map((r) => [
      "northside_loyalty_cohorts_v1",
      p.start,
      p.end,
      r.campaign,
      r.cohort,
      Number(r.customers) < 5 ? "suppressed (<5 customers)" : r.orders,
      Number(r.customers) < 5 ? "suppressed" : r.customers,
      Number(r.customers) < 5 ? "suppressed" : r.qualifying_cents,
      "USD",
      "Reconciled Shopify order snapshots; not incremental sales",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
