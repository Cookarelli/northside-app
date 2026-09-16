import "server-only";
import { randomUUID } from "node:crypto";
import { type Sql, type Actor, requireRole } from "./db";
import { AccessError } from "./security";
import { boundedJson } from "./grading-api";
import {
  wallet,
  enroll,
  createRule,
  approveRule,
  createReward,
  rewardActive,
  adjustment,
  dispute,
  requestOrderClaim,
  uuid,
  shortText,
  loyaltyAudit,
  type LoyaltyMode,
} from "./loyalty";
import {
  reserveReward,
  requestDeactivation,
  restorePoints,
} from "./loyalty-redemption";
import {
  loyaltyStaff,
  loyaltyCohortExport,
  reconciliationReport,
  retryLoyaltyJob,
  resolveLoyaltyReview,
} from "./loyalty-reporting";
import type { RewardTerms } from "../loyalty";
export async function loyaltyApi(
  request: Request,
  db: Sql,
  a: Actor,
  mode: LoyaltyMode = "live",
) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    if (u.searchParams.has("export"))
      return {
        csv: await loyaltyCohortExport(
          db,
          a,
          u.searchParams.get("from") || undefined,
          u.searchParams.get("to") || undefined,
        ),
      };
    if (u.searchParams.has("reconciliation"))
      return reconciliationReport(db, a);
    if (u.searchParams.has("staff"))
      return loyaltyStaff(
        db,
        a,
        mode,
        u.searchParams.get("from") || undefined,
        u.searchParams.get("to") || undefined,
        u.searchParams.has("valuation")
          ? Number(u.searchParams.get("valuation"))
          : undefined,
      );
    return wallet(db, a, mode);
  }
  const b = await boundedJson(request);
  switch (b.action) {
    case "enroll":
      return enroll(db, a, mode).then(() => ({ enrolled: true }));
    case "reserve":
      if (
        Object.keys(b).some(
          (k) => !["action", "reward_id", "source_id"].includes(k),
        )
      )
        throw new AccessError(400, "server_owns_reward_cost_and_customer");
      return reserveReward(db, a, uuid(b.reward_id), uuid(b.source_id), mode);
    case "dispute":
      return dispute(db, a, uuid(b.entry_id), shortText(b.reason)).then(() => ({
        saved: true,
      }));
    case "claim":
      return requestOrderClaim(db, a, shortText(b.order_id, 100)).then(() => ({
        review: true,
      }));
    case "rule-draft":
      return createRule(db, a, b.parameters, b.reason, mode);
    case "rule-approve":
      if (b.confirmed !== true)
        throw new AccessError(400, "explicit_economic_approval_required");
      return approveRule(
        db,
        a,
        uuid(b.rule_id),
        shortText(b.effective_at, 40),
        shortText(b.reason),
        mode,
      );
    case "reward-create":
      return createReward(
        db,
        a,
        {
          rule_id: uuid(b.rule_id),
          points_cost: b.points_cost as number,
          value_cents: b.value_cents as number,
          terms: b.terms as RewardTerms,
        },
        shortText(b.reason),
      );
    case "reward-active":
      return rewardActive(
        db,
        a,
        uuid(b.reward_id),
        b.active as boolean,
        shortText(b.reason),
        mode,
      ).then(() => ({ saved: true }));
    case "adjust":
      return adjustment(
        db,
        a,
        {
          customer_id: uuid(b.customer_id),
          points: b.points as number,
          source_id: uuid(b.source_id),
          reason: shortText(b.reason),
        },
        mode,
      );
    case "deactivate":
      return requestDeactivation(
        db,
        a,
        uuid(b.voucher_id),
        shortText(b.reason),
      ).then(() => ({ queued: true }));
    case "restore":
      if (b.confirmed !== true)
        throw new AccessError(400, "independent_evidence_review_required");
      return restorePoints(
        db,
        a,
        {
          voucher_id: uuid(b.voucher_id),
          points: b.points as number,
          source_id: uuid(b.source_id),
          kind: b.kind as "used_reward_refund" | "unused_cancelled",
          reason: shortText(b.reason),
          clearance_reference: b.clearance_reference as string | undefined,
        },
        mode,
      );
    case "job-retry":
      return retryLoyaltyJob(db, a, uuid(b.job_id), shortText(b.reason)).then(
        () => ({ queued: true }),
      );
    case "review-resolve":
      return resolveLoyaltyReview(
        db,
        a,
        uuid(b.review_id),
        shortText(b.reason),
        b.rejected === true,
      ).then(() => ({ saved: true }));
    case "order-recheck": {
      requireRole(a, ["owner", "admin"]);
      const id = shortText(b.order_id, 100);
      if (
        !(
          await db.query(
            "select order_id from ns.loyalty_orders where tenant_id=$1 and order_id=$2",
            [a.tenant_id, id],
          )
        ).rows.length
      )
        throw new AccessError(404, "order_not_found");
      await db.query(
        "insert into ns.loyalty_jobs(tenant_id,kind,object_id,source_id) values($1,'order',$2,$3)",
        [a.tenant_id, id, randomUUID()],
      );
      await loyaltyAudit(db, a, "order.recheck", id, b.reason);
      return { queued: true };
    }
    default:
      throw new AccessError(400, "unsupported_loyalty_action");
  }
}
