import "server-only";
import {
  createHmac,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import { type Sql, transaction } from "./db";
import { SHOP, TENANT } from "./providers";
import { AccessError } from "./security";
import { gid } from "./shopify-config";
import { adminQuery, fetchOrder, type OrderSnapshot } from "./admin-shopify";
import { enqueueBreakOrder } from "./break-worker";
import { enqueueLoyaltyOrder } from "./loyalty-worker";
export async function rawBody(request: Request, maxBytes = 1024 * 1024) {
  if (!request.body) throw new AccessError(400, "body_required");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AccessError(413, "request_too_large");
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}
export function verifyDelivery(raw: Buffer, headers: Headers, secret: string) {
  if (!secret) throw new AccessError(503, "webhook_not_configured");
  const value = headers.get("x-shopify-hmac-sha256") || "";
  const received = Buffer.from(value, "base64"),
    expected = createHmac("sha256", secret).update(raw).digest();
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new AccessError(401, "invalid_webhook_signature");
  if (headers.get("x-shopify-shop-domain") !== SHOP)
    throw new AccessError(403, "unrecognized_shop");
  const topic = headers.get("x-shopify-topic") || "",
    delivery = headers.get("x-shopify-webhook-id") || "";
  if (
    ![
      "orders/paid",
      "orders/cancelled",
      "orders/updated",
      "refunds/create",
    ].includes(topic)
  )
    throw new AccessError(400, "unsupported_webhook_topic");
  if (!/^[a-f0-9-]{36}$/i.test(delivery))
    throw new AccessError(400, "invalid_delivery_id");
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new AccessError(400, "invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new AccessError(400, "invalid_json");
  // Prefer the string GraphQL ID; never round an unsafe JSON numeric ID.
  const source =
    topic === "refunds/create"
      ? payload.order_id
      : payload.admin_graphql_api_id;
  const id =
    typeof source === "number" && Number.isSafeInteger(source)
      ? `gid://shopify/Order/${source}`
      : typeof source === "string" && /^[0-9]+$/.test(source)
        ? `gid://shopify/Order/${source}`
        : source;
  return { delivery, topic, orderId: gid(id, "Order") };
}
export async function receiveOn(
  db: Sql,
  event: ReturnType<typeof verifyDelivery>,
) {
  const receipt = (
    await db.query<{ id: string }>(
      "insert into ns.webhook_receipts(tenant_id,provider,source_id) values($1,'shopify',$2) on conflict(tenant_id,provider,source_id) do nothing returning id",
      [TENANT, event.delivery],
    )
  ).rows[0];
  if (!receipt) return { duplicate: true };
  await db.query(
    "insert into ns.order_jobs(tenant_id,receipt_id,shop,order_id,topic) values($1,$2,$3,$4,$5)",
    [TENANT, receipt.id, SHOP, event.orderId, event.topic],
  );
  return { duplicate: false };
}
export type Job = {
  receipt_id: string;
  order_id: string;
  lease_token: string;
  attempts: number;
};
export async function claimOn(db: Sql): Promise<Job | undefined> {
  return (
    await db.query<Job>(
      `with due as (
    select receipt_id from ns.order_jobs where tenant_id=$1 and attempts<8 and ((state='pending' and available_at<=now()) or (state='processing' and lease_until<now()))
    order by available_at for update skip locked limit 1
  ) update ns.order_jobs j set state='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '2 minutes'
    from due where j.tenant_id=$1 and j.receipt_id=due.receipt_id returning j.receipt_id,j.order_id,j.lease_token,j.attempts`,
      [TENANT, randomUUID()],
    )
  ).rows[0];
}
export async function reconcileOn(
  db: Sql,
  job: Job,
  load: (id: string) => Promise<OrderSnapshot>,
) {
  const claimed = (
    await db.query(
      "select receipt_id from ns.order_jobs where tenant_id=$1 and receipt_id=$2 and lease_token=$3 and state='processing' and lease_until>now() for update",
      [TENANT, job.receipt_id, job.lease_token],
    )
  ).rows[0];
  if (!claimed) return false;
  // Serialize BEFORE the provider read so concurrent jobs cannot commit stale reads in reverse order.
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    `${TENANT}/${SHOP}/${job.order_id}`,
  ]);
  const s = await load(job.order_id);
  if (s.id !== job.order_id)
    throw new AccessError(503, "order_identity_mismatch");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(s))
    .digest("hex");
  const prior = (
    await db.query<{ fingerprint: string; provider_updated_at: Date | string }>(
      "select fingerprint,provider_updated_at from ns.shopify_orders where tenant_id=$1 and shop=$2 and order_id=$3 for update",
      [TENANT, SHOP, s.id],
    )
  ).rows[0];
  if (
    prior &&
    new Date(prior.provider_updated_at).getTime() > Date.parse(s.updatedAt)
  )
    throw new AccessError(503, "stale_order_state");
  if (prior?.fingerprint !== fingerprint) {
    await db.query(
      `insert into ns.shopify_orders(tenant_id,shop,order_id,shopify_customer_id,name,financial_status,cancelled_at,currency,total_cents,received_cents,refunded_cents,provider_updated_at,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(tenant_id,shop,order_id) do update set
      shopify_customer_id=excluded.shopify_customer_id,name=excluded.name,financial_status=excluded.financial_status,cancelled_at=excluded.cancelled_at,total_cents=excluded.total_cents,received_cents=excluded.received_cents,refunded_cents=excluded.refunded_cents,provider_updated_at=excluded.provider_updated_at,fingerprint=excluded.fingerprint,reconciled_at=now()`,
      [
        TENANT,
        SHOP,
        s.id,
        s.customerId,
        s.name,
        s.financialStatus,
        s.cancelledAt,
        s.currency,
        s.totalCents,
        s.receivedCents,
        s.refundedCents,
        s.updatedAt,
        fingerprint,
      ],
    );
    await db.query(
      "insert into ns.order_ledger(tenant_id,shop,order_id,receipt_id,snapshot) values($1,$2,$3,$4,$5)",
      [TENANT, SHOP, s.id, job.receipt_id, JSON.stringify(s)],
    );
  }
  await db.query(
    "update ns.webhook_receipts set processed_at=now() where tenant_id=$1 and id=$2",
    [TENANT, job.receipt_id],
  );
  await db.query(
    "update ns.order_jobs set state='complete',lease_token=null,lease_until=null,last_error=null where tenant_id=$1 and receipt_id=$2",
    [TENANT, job.receipt_id],
  );
  return true;
}
export async function failOn(db: Sql, job: Job) {
  await db.query(
    "update ns.order_jobs set state=case when attempts>=8 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>$4),lease_token=null,lease_until=null,last_error='provider_or_database_unavailable' where tenant_id=$1 and receipt_id=$2 and lease_token=$3",
    [
      TENANT,
      job.receipt_id,
      job.lease_token,
      Math.min(3600, 15 * 2 ** job.attempts),
    ],
  );
}
export async function runOrderJobs(limit = 10) {
  let completed = 0,
    failed = 0;
  await transaction("commerce", (db) =>
    db.query(
      "update ns.order_jobs set state='failed',last_error='lease_retry_limit' where tenant_id=$1 and state='processing' and lease_until<now() and attempts>=8",
      [TENANT],
    ),
  );
  for (let i = 0; i < limit; i++) {
    const job = await transaction("commerce", claimOn);
    if (!job) break;
    try {
      const query = await adminQuery();
      if (
        await transaction("commerce", (db) =>
          (async () => {
            const done = await reconcileOn(db, job, (id) =>
              fetchOrder(query, id),
            );
            if (done) {
              await enqueueLoyaltyOrder(db, job.order_id, job.receipt_id);
              await enqueueBreakOrder(db, job.order_id, job.receipt_id);
            }
            return done;
          })(),
        )
      )
        completed++;
    } catch {
      await transaction("commerce", (db) => failOn(db, job));
      failed++;
    }
  }
  return { completed, failed };
}
