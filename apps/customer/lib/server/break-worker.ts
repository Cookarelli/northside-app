import "server-only";
import { randomUUID } from "node:crypto";
import { transaction, type Sql } from "./db";
import { TENANT } from "./providers";
import { adminQuery } from "./admin-shopify";
import { fetchLoyaltyOrder } from "./loyalty-orders";
import { reconcileBreakOrder } from "./break-purchases";
export async function enqueueBreakOrder(
  db: Sql,
  order: string,
  source: string,
) {
  await db.query(
    "insert into ns.break_jobs(tenant_id,order_id,source_id) values($1,$2,$3) on conflict(tenant_id,source_id) do nothing",
    [TENANT, order, source],
  );
}
export type BreakJob = {
  id: string;
  order_id: string;
  lease_token: string;
  attempts: number;
};
export async function claimBreakJob(db: Sql) {
  return (
    await db.query<BreakJob>(
      `with due as(select id from ns.break_jobs where tenant_id=$1 and attempts<8 and ((state='pending' and available_at<=now()) or (state='processing' and lease_until<now())) order by available_at for update skip locked limit 1) update ns.break_jobs j set state='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '2 minutes' from due where j.tenant_id=$1 and j.id=due.id returning j.id,j.order_id,j.lease_token,j.attempts`,
      [TENANT, randomUUID()],
    )
  ).rows[0];
}
export async function validBreakJob(db: Sql, j: BreakJob) {
  return !!(
    await db.query(
      "select id from ns.break_jobs where tenant_id=$1 and id=$2 and lease_token=$3 and lease_until>now() and state='processing' for update",
      [TENANT, j.id, j.lease_token],
    )
  ).rows.length;
}
export async function finishBreakJob(db: Sql, j: BreakJob, state: string) {
  await db.query(
    "update ns.break_jobs set state=$4,lease_token=null,lease_until=null,last_error=$5 where tenant_id=$1 and id=$2 and lease_token=$3",
    [
      TENANT,
      j.id,
      j.lease_token,
      state === "review" ? "review" : "complete",
      state === "review" ? "order_review_required" : null,
    ],
  );
}
export async function failBreakJob(db: Sql, j: BreakJob) {
  await db.query(
    "update ns.break_jobs set state=case when attempts>=8 then 'review' else 'pending' end,available_at=now()+make_interval(secs=>$4),lease_token=null,lease_until=null,last_error='provider_or_database_unavailable' where tenant_id=$1 and id=$2 and lease_token=$3",
    [TENANT, j.id, j.lease_token, Math.min(3600, 15 * 2 ** j.attempts)],
  );
}
export async function runBreakJobs(limit = 10) {
  let attempted = 0,
    failed = 0;
  await transaction("commerce", (db) =>
    db.query(
      "update ns.break_jobs set state='review',last_error='lease_retry_limit' where tenant_id=$1 and state='processing' and lease_until<now() and attempts>=8",
      [TENANT],
    ),
  );
  for (let i = 0; i < Math.min(100, limit); i++) {
    const j = await transaction("commerce", claimBreakJob);
    if (!j) break;
    attempted++;
    try {
      const query = await adminQuery();
      await transaction("commerce", async (db) => {
        if (!(await validBreakJob(db, j))) return;
        await db.query("select pg_advisory_xact_lock(hashtext($1))", [
          TENANT + "/break-order/" + j.order_id,
        ]);
        const result = await reconcileBreakOrder(
          db,
          await fetchLoyaltyOrder(query, j.order_id),
        );
        await finishBreakJob(db, j, result.state);
      });
    } catch {
      failed++;
      await transaction("commerce", (db) => failBreakJob(db, j));
    }
  }
  return { attempted, failed };
}
