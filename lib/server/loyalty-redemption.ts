import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { type Sql, type Actor, requireCustomer, requireRole } from "./db";
import { AccessError } from "./security";
import { SHOP, TENANT } from "./providers";
import type { VoucherSnapshot, RewardTerms, LoyaltyOrder } from "../loyalty";
import {
  activeRule,
  lockAccount,
  loyaltyGate,
  postPoints,
  integer,
  uuid,
  shortText,
  validateReward,
  loyaltyAudit,
  openReview,
  type LoyaltyMode,
} from "./loyalty";
import type {
  LoyaltyDiscountAdapter,
  DiscountEvidence,
} from "./loyalty-discounts";
export type LoyaltyJob = {
  id: string;
  kind: "order" | "issue" | "deactivate";
  object_id: string;
  source_id: string;
  lease_token: string;
  attempts: number;
};
type Reservation = {
  id: string;
  customer_id: string;
  account_id: string;
  status: string;
  points: number;
  code: string;
  snapshot: VoucherSnapshot;
};
export async function reserveReward(
  db: Sql,
  a: Actor,
  rewardId: string,
  sourceId: string,
  mode: LoyaltyMode = "live",
) {
  requireCustomer(a);
  uuid(rewardId);
  uuid(sourceId);
  if (!loyaltyGate(mode, "redemption"))
    throw new AccessError(409, "redemption_not_launched");
  const account = await lockAccount(db, a.tenant_id, a.customer_id!);
  const prior = (
    await db.query<Reservation>(
      "select * from ns.redemption_reservations where tenant_id=$1 and source_id=$2",
      [a.tenant_id, sourceId],
    )
  ).rows[0];
  if (prior) {
    if (
      prior.customer_id !== a.customer_id ||
      prior.snapshot.reward_id !== rewardId
    )
      throw new AccessError(409, "request_identity_conflict");
    return { id: prior.id, status: prior.status };
  }
  const rule = await activeRule(db, a.tenant_id, mode);
  const reward = (
    await db.query<{
      id: string;
      rule_id: string;
      points_cost: number;
      value_cents: number;
      terms: RewardTerms;
    }>(
      "select * from ns.rewards where tenant_id=$1 and id=$2 and active=true and approved_by is not null and approved_at is not null",
      [a.tenant_id, rewardId],
    )
  ).rows[0];
  if (!rule || !reward || reward.rule_id !== rule.id)
    throw new AccessError(409, "active_approved_reward_required");
  const terms = validateReward(reward.terms, reward.value_cents);
  const customer = (
    await db.query<{ shopify_id: string }>(
      "select shopify_id from ns.shopify_customers where tenant_id=$1 and customer_id=$2 and shop=$3",
      [a.tenant_id, a.customer_id, SHOP],
    )
  ).rows[0];
  if (!customer) throw new AccessError(409, "verified_customer_required");
  const held = Number(
    (
      await db.query<{ n: string }>(
        "select coalesce(sum(points),0) n from ns.redemption_reservations where tenant_id=$1 and account_id=$2 and status in ('held','review')",
        [a.tenant_id, account.id],
      )
    ).rows[0].n,
  );
  if (Number(account.cached_points) - held < reward.points_cost)
    throw new AccessError(409, "insufficient_spendable_points");
  const snapshot: VoucherSnapshot = {
    ...terms,
    rule_id: rule.id,
    reward_id: reward.id,
    customer_id: a.customer_id!,
    shopify_customer_id: customer.shopify_id,
    points_cost: reward.points_cost,
    value_cents: reward.value_cents,
    currency: "USD",
    starts_at: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
    ends_at: new Date(
      Math.floor(Date.now() / 1000) * 1000 + terms.expiry_days * 86400000,
    ).toISOString(),
  };
  const id = randomUUID(),
    code = "NS" + randomBytes(20).toString("hex").toUpperCase();
  await db.query(
    "insert into ns.redemption_reservations(tenant_id,id,customer_id,account_id,reward_id,source_id,points,code,snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      a.tenant_id,
      id,
      a.customer_id,
      account.id,
      reward.id,
      sourceId,
      reward.points_cost,
      code,
      JSON.stringify(snapshot),
    ],
  );
  await db.query(
    "insert into ns.loyalty_jobs(tenant_id,kind,object_id,source_id) values($1,'issue',$2,$2)",
    [a.tenant_id, id],
  );
  return { id, status: "held" };
}
export async function claimLoyaltyJob(
  db: Sql,
  kind?: LoyaltyJob["kind"],
  objectId?: string,
): Promise<LoyaltyJob | undefined> {
  return (
    await db.query<LoyaltyJob>(
      `with due as (select id from ns.loyalty_jobs where tenant_id=$1 and ($2::text is null or kind=$2) and ($4::text is null or object_id=$4) and attempts<8 and ((state='pending' and available_at<=now()) or (state='processing' and lease_until<now())) order by available_at for update skip locked limit 1) update ns.loyalty_jobs j set state='processing',attempts=attempts+1,lease_token=$3,lease_until=now()+interval '2 minutes' from due where j.tenant_id=$1 and j.id=due.id returning j.*`,
      [TENANT, kind || null, randomUUID(), objectId || null],
    )
  ).rows[0];
}
export async function validJob(db: Sql, j: LoyaltyJob) {
  return !!(
    await db.query(
      "select id from ns.loyalty_jobs where tenant_id=$1 and id=$2 and state='processing' and lease_token=$3 and lease_until>now() for update",
      [TENANT, j.id, j.lease_token],
    )
  ).rows.length;
}
export async function finishJob(
  db: Sql,
  j: LoyaltyJob,
  state = "complete",
  error: string | null = null,
) {
  await db.query(
    "update ns.loyalty_jobs set state=$4,last_error=$5,lease_until=null,lease_token=null where tenant_id=$1 and id=$2 and lease_token=$3",
    [TENANT, j.id, j.lease_token, state, error],
  );
}
export async function failLoyaltyJob(db: Sql, j: LoyaltyJob) {
  await db.query(
    "update ns.loyalty_jobs set state=case when attempts>=8 then 'review' else 'pending' end,last_error='provider_state_uncertain',available_at=now()+make_interval(secs=>$4),lease_token=null,lease_until=null where tenant_id=$1 and id=$2 and lease_token=$3",
    [TENANT, j.id, j.lease_token, Math.min(3600, 15 * 2 ** j.attempts)],
  );
  // Never release an uncertain hold, even after retry exhaustion.
}
export async function issueReward(
  db: Sql,
  j: LoyaltyJob,
  adapter: LoyaltyDiscountAdapter,
  mode: LoyaltyMode = "live",
) {
  if (
    !loyaltyGate(mode, "redemption") ||
    (mode === "sample") !== (adapter.kind === "sample")
  )
    throw new AccessError(409, "issuance_not_enabled");
  if (!(await validJob(db, j))) return false;
  const r = (
    await db.query<Reservation>(
      "select * from ns.redemption_reservations where tenant_id=$1 and id=$2 for update",
      [TENANT, uuid(j.object_id)],
    )
  ).rows[0];
  if (!r) throw new AccessError(404, "reservation_not_found");
  if (r.status === "issued" || r.status === "failed") {
    await finishJob(db, j);
    return true;
  }
  await lockAccount(db, TENANT, r.customer_id);
  let evidence: DiscountEvidence | null = null;
  try {
    evidence = await adapter.lookup(r.code, r.snapshot);
  } catch {
    await failLoyaltyJob(db, j);
    return false;
  }
  if (!evidence) {
    if (Date.parse(r.snapshot.ends_at) <= Date.now()) {
      await finishJob(db, j, "review", "reservation_expired_while_uncertain");
      return false;
    }
    const result = await adapter.create(r.code, r.snapshot);
    if (result.state === "created") evidence = result.evidence;
    else if (result.state === "rejected" && j.attempts === 1) {
      // Only a first, definitive mutation rejection with a confirmed absent code releases points.
      try {
        evidence = await adapter.lookup(r.code, r.snapshot);
      } catch {
        await failLoyaltyJob(db, j);
        return false;
      }
      if (!evidence) {
        await db.query(
          "update ns.redemption_reservations set status='failed' where tenant_id=$1 and id=$2",
          [TENANT, r.id],
        );
        await finishJob(db, j, "failed", "creation_rejected");
        return true;
      }
    } else {
      await failLoyaltyJob(db, j);
      return false;
    }
  }
  if (
    !evidence ||
    evidence.code !== r.code ||
    JSON.stringify(evidence.snapshot) !== JSON.stringify(r.snapshot)
  ) {
    await finishJob(db, j, "review", "voucher_contract_mismatch");
    return false;
  }
  await postPoints(db, {
    tenant: TENANT,
    customer: r.customer_id,
    account: r.account_id,
    rule: r.snapshot.rule_id,
    points: -r.points,
    source: r.id,
    operation: "voucher-issued",
    kind: "exchange",
    reason: "Points exchanged for issued reward",
  });
  await db.query(
    "insert into ns.shopify_vouchers(tenant_id,customer_id,reservation_id,shopify_discount_id,code,snapshot) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,reservation_id) do nothing",
    [
      TENANT,
      r.customer_id,
      r.id,
      evidence.id,
      r.code,
      JSON.stringify(r.snapshot),
    ],
  );
  await db.query(
    "update ns.redemption_reservations set status='issued' where tenant_id=$1 and id=$2",
    [TENANT, r.id],
  );
  await finishJob(db, j);
  return true;
}
export async function recordVoucherUsage(db: Sql, o: LoyaltyOrder) {
  if (
    !o.paidAt ||
    !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.financialStatus)
  )
    return;
  for (const d of o.discounts) {
    const v = (
      await db.query<{
        id: string;
        customer_id: string;
        reservation_id: string;
        snapshot: VoucherSnapshot;
      }>("select * from ns.shopify_vouchers where tenant_id=$1 and code=$2", [
        TENANT,
        d.code.toUpperCase(),
      ])
    ).rows[0];
    if (!v) continue;
    integer(d.amountCents);
    if (v.snapshot.shopify_customer_id !== o.customerId) {
      await openReview(
        db,
        TENANT,
        v.customer_id,
        "voucher_wrong_owner",
        v.id,
        "wrong-owner/" + o.id + "/" + v.id,
        "Verified order used a voucher under another customer. Requires Shopify investigation; no ownership change.",
      );
      continue;
    }
    const old = (
      await db.query<{ order_id: string }>(
        "select order_id from ns.loyalty_voucher_usage where tenant_id=$1 and voucher_id=$2",
        [TENANT, v.id],
      )
    ).rows;
    if (old.some((x) => x.order_id !== o.id))
      await openReview(
        db,
        TENANT,
        v.customer_id,
        "voucher_reuse",
        v.id,
        "reuse/" + v.id + "/" + o.id,
        "Unexpected additional paid usage of a single-use voucher.",
      );
    await db.query(
      "insert into ns.loyalty_voucher_usage(tenant_id,voucher_id,customer_id,order_id,amount_cents,paid_at) values($1,$2,$3,$4,$5,$6) on conflict do nothing",
      [TENANT, v.id, v.customer_id, o.id, d.amountCents, o.paidAt],
    );
    if (
      (
        await db.query(
          "select source_id from ns.loyalty_restorations where tenant_id=$1 and reservation_id=$2 and kind='unused_cancelled'",
          [TENANT, v.reservation_id],
        )
      ).rows.length
    )
      await openReview(
        db,
        TENANT,
        v.customer_id,
        "late_paid_usage",
        v.id,
        "late-paid/" + v.id,
        "Payment arrived after a reviewed cancellation credit. Freeze further restoration and investigate; no silent balance change.",
      );
  }
}
export async function requestDeactivation(
  db: Sql,
  a: Actor,
  id: string,
  reason: string,
) {
  requireRole(a, ["owner", "admin"]);
  uuid(id);
  shortText(reason);
  if (
    !(
      await db.query(
        "select id from ns.shopify_vouchers where tenant_id=$1 and id=$2",
        [a.tenant_id, id],
      )
    ).rows.length
  )
    throw new AccessError(404, "voucher_not_found");
  await db.query(
    "insert into ns.loyalty_jobs(tenant_id,kind,object_id,source_id) values($1,'deactivate',$2,$2) on conflict do nothing",
    [a.tenant_id, id],
  );
  await loyaltyAudit(db, a, "voucher.deactivation_requested", id, reason);
}
export async function deactivateReward(
  db: Sql,
  j: LoyaltyJob,
  adapter: LoyaltyDiscountAdapter,
  mode: LoyaltyMode = "live",
) {
  if (
    !loyaltyGate(mode, "redemption") ||
    (mode === "sample") !== (adapter.kind === "sample")
  )
    throw new AccessError(409, "issuance_not_enabled");
  if (!(await validJob(db, j))) return;
  const v = (
    await db.query<{
      id: string;
      code: string;
      shopify_discount_id: string;
      snapshot: VoucherSnapshot;
      customer_id: string;
    }>(
      "select * from ns.shopify_vouchers where tenant_id=$1 and id=$2 for update",
      [TENANT, uuid(j.object_id)],
    )
  ).rows[0];
  if (!v) throw new AccessError(404, "voucher_not_found");
  if (!(await adapter.deactivate(v.shopify_discount_id))) {
    await failLoyaltyJob(db, j);
    return;
  }
  const evidence = await adapter.lookup(v.code, v.snapshot, true);
  if (!evidence || evidence.status !== "EXPIRED") {
    await failLoyaltyJob(db, j);
    return;
  }
  await db.query(
    "update ns.shopify_vouchers set status='deactivated',checked_at=now() where tenant_id=$1 and id=$2",
    [TENANT, v.id],
  );
  await openReview(
    db,
    TENANT,
    v.customer_id,
    "cancellation",
    v.id,
    "cancel/" + v.id,
    "Deactivation confirmed. Pending and paid checkouts still require independent reconciliation before any points credit. Asynchronous usage counts are insufficient.",
  );
  await finishJob(db, j);
}
export async function restorePoints(
  db: Sql,
  a: Actor,
  input: {
    voucher_id: string;
    points: number;
    source_id: string;
    kind: "used_reward_refund" | "unused_cancelled";
    reason: string;
    clearance_reference?: string;
  },
  mode: LoyaltyMode = "live",
) {
  requireRole(a, ["owner", "admin"]);
  uuid(input.voucher_id);
  uuid(input.source_id);
  integer(input.points, 1, 1_000_000);
  shortText(input.reason);
  if (!loyaltyGate(mode, "redemption"))
    throw new AccessError(409, "restoration_not_launched");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + "/restore/" + input.voucher_id,
  ]);
  const v = (
    await db.query<{
      id: string;
      reservation_id: string;
      customer_id: string;
      status: string;
      checked_at: string | null;
      snapshot: VoucherSnapshot;
    }>("select * from ns.shopify_vouchers where tenant_id=$1 and id=$2", [
      a.tenant_id,
      input.voucher_id,
    ])
  ).rows[0];
  if (!v) throw new AccessError(404, "voucher_not_found");
  const account = await lockAccount(db, a.tenant_id, v.customer_id);
  if (
    (
      await db.query(
        "select source_id from ns.loyalty_restorations where tenant_id=$1 and source_id=$2",
        [a.tenant_id, input.source_id],
      )
    ).rows.length
  )
    return { duplicate: true };
  const total = Number(
    (
      await db.query<{ n: string }>(
        "select coalesce(sum(points),0) n from ns.loyalty_restorations where tenant_id=$1 and reservation_id=$2",
        [a.tenant_id, v.reservation_id],
      )
    ).rows[0].n,
  );
  if (total + input.points > v.snapshot.points_cost)
    throw new AccessError(409, "original_redemption_cap_exceeded");
  const used = (
    await db.query(
      "select order_id from ns.loyalty_voucher_usage where tenant_id=$1 and voucher_id=$2",
      [a.tenant_id, v.id],
    )
  ).rows.length;
  if (input.kind === "unused_cancelled") {
    if (v.status !== "deactivated" || !v.checked_at || used)
      throw new AccessError(
        409,
        "deactivation_and_unused_reconciliation_required",
      );
    shortText(input.clearance_reference);
    if (
      (
        await db.query(
          "select id from ns.loyalty_jobs where tenant_id=$1 and kind='order' and state<>'complete'",
          [a.tenant_id],
        )
      ).rows.length
    )
      throw new AccessError(409, "pending_order_jobs_require_review");
    await db.query(
      "insert into ns.loyalty_clearances(tenant_id,voucher_id,actor_id,reference) values($1,$2,$3,$4) on conflict do nothing",
      [a.tenant_id, v.id, a.staff_id, input.clearance_reference],
    );
  } else if (input.kind === "used_reward_refund") {
    if (!used) throw new AccessError(409, "verified_paid_usage_required");
    const eligible = (
      await db.query(
        "select o.order_id from ns.loyalty_voucher_usage u join ns.loyalty_orders o on o.tenant_id=u.tenant_id and o.order_id=u.order_id where u.tenant_id=$1 and u.voucher_id=$2 and (o.snapshot->>'financialStatus' in ('REFUNDED','PARTIALLY_REFUNDED') or (o.snapshot->>'cancelled')::boolean)",
        [a.tenant_id, v.id],
      )
    ).rows.length;
    if (!eligible)
      throw new AccessError(409, "verified_refund_evidence_required");
  } else throw new AccessError(400, "unsupported_restoration_kind");
  await db.query(
    "insert into ns.loyalty_restorations(tenant_id,reservation_id,customer_id,source_id,points,actor_id,reason,kind) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      a.tenant_id,
      v.reservation_id,
      v.customer_id,
      input.source_id,
      input.points,
      a.staff_id,
      input.reason,
      input.kind,
    ],
  );
  await postPoints(db, {
    tenant: a.tenant_id,
    customer: v.customer_id,
    account: account.id,
    rule: v.snapshot.rule_id,
    points: input.points,
    source: input.source_id,
    operation: "restoration",
    kind: "restoration",
    reason: "Reviewed reward points restoration",
    actor: a.staff_id,
  });
  await loyaltyAudit(db, a, "reward.points_restored", v.id, input.reason);
  return { restored: input.points };
}
