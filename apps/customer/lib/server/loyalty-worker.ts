import "server-only";
import { transaction, type Sql } from "./db";
import { TENANT } from "./providers";
import { adminQuery } from "./admin-shopify";
import { loyaltyGate, reconcileLoyaltyOrder } from "./loyalty";
import { fetchLoyaltyOrder } from "./loyalty-orders";
import { ShopifyLoyaltyDiscountAdapter } from "./loyalty-discounts";
import { AccessError } from "./security";
import {
  claimLoyaltyJob,
  validJob,
  finishJob,
  failLoyaltyJob,
  issueReward,
  deactivateReward,
  recordVoucherUsage,
} from "./loyalty-redemption";
export async function enqueueLoyaltyOrder(
  db: Sql,
  orderId: string,
  sourceId: string,
) {
  await db.query(
    "insert into ns.loyalty_jobs(tenant_id,kind,object_id,source_id) values($1,'order',$2,$3) on conflict(tenant_id,kind,source_id) do nothing",
    [TENANT, orderId, sourceId],
  );
}
export async function runLoyaltyJobs(limit = 10) {
  if (!loyaltyGate("live", "earning") && !loyaltyGate("live", "redemption"))
    return { state: "program_not_launched", attempted: 0, failed: 0 };
  let attempted = 0,
    failed = 0;
  await transaction("loyalty", (db) =>
    db.query(
      "update ns.loyalty_jobs set state='review',last_error='lease_retry_limit' where tenant_id=$1 and state='processing' and lease_until<now() and attempts>=8",
      [TENANT],
    ),
  );
  for (let i = 0; i < Math.min(100, limit); i++) {
    const job = await transaction("loyalty", (db) => claimLoyaltyJob(db));
    if (!job) break;
    attempted++;
    try {
      const query = await adminQuery();
      if (job.kind !== "order") {
        if (process.env.SHOPIFY_LOYALTY_CHECKOUT_VERIFIED !== "true")
          throw new AccessError(503, "loyalty_checkout_verification_required");
        const access = await query<{
          currentAppInstallation: { accessScopes: { handle: string }[] };
        }>(
          "query LoyaltyScopes { currentAppInstallation { accessScopes { handle } } }",
          {},
        );
        const scopes =
          access.currentAppInstallation?.accessScopes.map((s) => s.handle) ||
          [];
        if (!scopes.includes("write_discounts"))
          throw new AccessError(503, "discount_scopes_required");
      }
      if (job.kind === "order") {
        await transaction("loyalty", async (db) => {
          if (!(await validJob(db, job))) return;
          await db.query("select pg_advisory_xact_lock(hashtext($1))", [
            TENANT + "/loyalty-order/" + job.object_id,
          ]);
          const order = await fetchLoyaltyOrder(query, job.object_id);
          await recordVoucherUsage(db, order);
          const result = await reconcileLoyaltyOrder(db, order);
          await finishJob(
            db,
            job,
            result.state === "review" || result.state === "ownership_review"
              ? "review"
              : "complete",
            result.state === "review" ? "order_review_required" : null,
          );
        });
      } else {
        const adapter = new ShopifyLoyaltyDiscountAdapter(query);
        await transaction("loyalty", async (db) => {
          if (job.kind === "issue") await issueReward(db, job, adapter);
          else await deactivateReward(db, job, adapter);
        });
      }
    } catch {
      await transaction("loyalty", (db) => failLoyaltyJob(db, job));
      failed++;
    }
  }
  return { state: "processed", attempted, failed };
}
