import "server-only";
import { randomUUID } from "node:crypto";
import { transaction, type Sql } from "./db";
import { TENANT } from "./providers";
import { adminQuery } from "./admin-shopify";
import { type Query } from "./storefront";
import { cents, gid } from "./shopify-config";
import { AccessError, hashToken } from "./security";
import { approvedPlacement } from "./measurement";
import type { WorkerRun } from "./notifications";
export type MeasuredOrder = {
  id: string;
  paidAt: string;
  updatedAt: string;
  gross: number;
  refund: number;
  channel: "online" | "pos" | "other_shopify" | "external_legacy";
  first: string | null;
  latest: string | null;
};
type Bag = { shopMoney: { amount: string; currencyCode: string } };
export async function fetchMeasuredOrder(
  query: Query,
  id: string,
): Promise<MeasuredOrder | null> {
  gid(id, "Order");
  const { order: o } = await query<{
    order: {
      id: string;
      updatedAt: string;
      sourceName: string;
      test: boolean;
      displayFinancialStatus: string;
      totalReceivedSet: Bag;
      totalRefundedSet: Bag;
      transactions: { kind: string; status: string; processedAt: string }[];
      customAttributes: { key: string; value: string }[];
    } | null;
  }>(
    `query MeasuredOrder($id:ID!){order(id:$id){id updatedAt sourceName test displayFinancialStatus totalReceivedSet{shopMoney{amount currencyCode}} totalRefundedSet{shopMoney{amount currencyCode}} transactions(first:250){kind status processedAt} customAttributes{key value}}}`,
    { id },
  );
  if (!o || o.id !== id || o.test || o.transactions.length >= 250)
    throw new AccessError(409, "order_measurement_review_required");
  if (
    !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
      o.displayFinancialStatus,
    )
  )
    return null;
  const paid = o.transactions
    .filter(
      (t) => t.status === "SUCCESS" && ["SALE", "CAPTURE"].includes(t.kind),
    )
    .map((t) => t.processedAt)
    .filter((t) => Number.isFinite(Date.parse(t)))
    .sort()[0];
  if (!paid) throw new AccessError(409, "verified_payment_missing");
  const attr = (key: string) => {
    const values = o.customAttributes.filter((v) => v.key === key);
    return values.length === 1 ? values[0].value : null;
  };
  return {
    id,
    paidAt: paid,
    updatedAt: o.updatedAt,
    gross: cents(o.totalReceivedSet.shopMoney),
    refund: cents(o.totalRefundedSet.shopMoney),
    channel:
      o.sourceName === "web"
        ? "online"
        : o.sourceName === "pos"
          ? "pos"
          : "other_shopify",
    first: attr("ns_first_campaign"),
    latest: attr("ns_latest_campaign"),
  };
}
export async function reconcileMeasurement(
  db: Sql,
  o: MeasuredOrder,
  sample = false,
) {
  if (
    !Number.isSafeInteger(o.gross) ||
    !Number.isSafeInteger(o.refund) ||
    o.gross < 0 ||
    o.refund < 0 ||
    !Number.isFinite(Date.parse(o.paidAt)) ||
    !Number.isFinite(Date.parse(o.updatedAt))
  )
    throw new AccessError(400, "invalid_measured_order");
  if (o.channel === "external_legacy" && !sample)
    throw new AccessError(403, "legacy_requires_separate_evidence");
  const first = await approvedPlacement(db, o.first, sample),
    latest = await approvedPlacement(db, o.latest, sample);
  const changed = await db.query(
    `insert into ns.measured_orders(tenant_id,order_id,channel,paid_at,gross_cents,refund_cents,first_ref,latest_ref,provider_updated_at,fixture) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(tenant_id,order_id) do update set gross_cents=excluded.gross_cents,refund_cents=excluded.refund_cents,channel=excluded.channel,first_ref=excluded.first_ref,latest_ref=excluded.latest_ref,provider_updated_at=excluded.provider_updated_at,last_sync_at=now() where ns.measured_orders.provider_updated_at<=excluded.provider_updated_at returning order_id`,
    [
      TENANT,
      o.id,
      o.channel,
      o.paidAt,
      o.gross,
      o.refund,
      first?.ref || null,
      latest?.ref || null,
      o.updatedAt,
      sample,
    ],
  );
  if (changed.rows.length && o.channel !== "external_legacy")
    await db.query(
      "insert into ns.measurement_events(tenant_id,event,source_key,first_ref,latest_ref,observed_at,fixture) values($1,'verified_purchase',$2,$3,$4,$5,$6) on conflict(tenant_id,event,source_key) do update set first_ref=excluded.first_ref,latest_ref=excluded.latest_ref",
      [
        TENANT,
        hashToken(o.id),
        first?.ref || null,
        latest?.ref || null,
        o.paidAt,
        sample,
      ],
    );
}
type Job = {
  order_id: string;
  lease_token: string;
  revision: number;
  attempts: number;
};
export async function runMeasurements(
  limit = 10,
  run: WorkerRun = (fn) => transaction("engagement", fn),
  queryFactory = adminQuery,
) {
  let processed = 0;
  for (let i = 0; i < Math.min(limit, 25); i++) {
    const j = await run(
      async (db) =>
        (
          await db.query<Job>(
            `with due as(select order_id from ns.measurement_jobs where tenant_id=$1 and ((state='pending' and available_at<=now()) or(state='processing' and lease_until<now())) order by available_at for update skip locked limit 1) update ns.measurement_jobs j set state='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '2 minutes' from due where j.tenant_id=$1 and j.order_id=due.order_id returning j.order_id,j.lease_token,j.revision,j.attempts`,
            [TENANT, randomUUID()],
          )
        ).rows[0],
    );
    if (!j) break;
    try {
      if (j.attempts > 8) throw Error();
      const o = await fetchMeasuredOrder(await queryFactory(), j.order_id);
      await run(async (db) => {
        if (
          !(
            await db.query(
              "select order_id from ns.measurement_jobs where tenant_id=$1 and order_id=$2 and lease_token=$3 and lease_until>now() and revision=$4 and state='processing' for update",
              [TENANT, j.order_id, j.lease_token, j.revision],
            )
          ).rows.length
        )
          return;
        if (o) await reconcileMeasurement(db, o);
        await db.query(
          "update ns.measurement_jobs set state='complete',lease_token=null,lease_until=null,last_error=null where tenant_id=$1 and order_id=$2",
          [TENANT, j.order_id],
        );
      });
    } catch {
      await run((db) =>
        db.query(
          "update ns.measurement_jobs set state=case when attempts>=8 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>$4),lease_token=null,lease_until=null,last_error='provider_or_order_review_required' where tenant_id=$1 and order_id=$2 and lease_token=$3",
          [
            TENANT,
            j.order_id,
            j.lease_token,
            Math.min(3600, 15 * 2 ** j.attempts),
          ],
        ),
      );
    }
    processed++;
  }
  return { processed };
}
