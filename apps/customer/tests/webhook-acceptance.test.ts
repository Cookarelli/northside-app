import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../lib/server/db";
import { SHOP } from "../lib/server/providers";
import {
  rawBody,
  verifyDelivery,
  receiveOn,
  claimOn,
  reconcileOn,
  failOn,
} from "../lib/server/order-jobs";
import type { OrderSnapshot } from "../lib/server/admin-shopify";
import { POST } from "../app/api/shopify/webhooks/route";

// No env-file, network, hosted database or running worker. Synthetic signatures only.
const secret = "SYNTHETIC_WEBHOOK_ACCEPTANCE_ONLY";
process.env.SHOPIFY_SHOP = SHOP;
process.env.SHOPIFY_APP_CLIENT_SECRET = secret;
process.env.SHOPIFY_API_VERSION = "2026-07";
process.env.NORTHSIDE_FIXTURES = "0";
for (const key of Object.keys(process.env))
  if (key.endsWith("DATABASE_URL")) delete process.env[key];
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Network forbidden in isolated webhook acceptance");
};
const db = await PGlite.create(),
  sql = db as unknown as Sql;
for (const file of [
  "202609120001_identity_and_records.sql",
  "202609120003_commerce.sql",
])
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
test.after(async () => {
  globalThis.fetch = fetchBefore;
  await db.close();
});

async function transaction<T>(fn: (s: Sql) => Promise<T>) {
  await db.exec("begin; set local role northside_commerce");
  try {
    const result = await fn(sql);
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
function request(
  topic = "orders/paid",
  delivery: string = randomUUID(),
  body?: string,
) {
  const raw =
    body ??
    JSON.stringify(
      topic === "refunds/create"
        ? { order_id: "123" }
        : { admin_graphql_api_id: "gid://shopify/Order/123" },
    );
  return new Request("https://example.test/api/shopify/webhooks", {
    method: "POST",
    body: raw,
    headers: {
      "x-shopify-shop-domain": SHOP,
      "x-shopify-topic": topic,
      "x-shopify-webhook-id": delivery,
      "x-shopify-hmac-sha256": createHmac("sha256", secret)
        .update(raw)
        .digest("base64"),
    },
  });
}
async function intake(req: Request) {
  const event = verifyDelivery(await rawBody(req), req.headers, secret);
  return transaction((s) => receiveOn(s, event));
}
const state: OrderSnapshot = {
  id: "gid://shopify/Order/123",
  customerId: null,
  name: "SYNTHETIC ACCEPTANCE",
  financialStatus: "PAID",
  cancelledAt: null,
  updatedAt: "2026-10-01T00:00:00Z",
  currency: "USD",
  totalCents: 1000,
  receivedCents: 1000,
  refundedCents: 0,
};
async function counts() {
  return (
    await db.query<{ receipts: number; jobs: number; ledger: number }>(
      "select (select count(*)::int from ns.webhook_receipts) receipts, (select count(*)::int from ns.order_jobs) jobs, (select count(*)::int from ns.order_ledger) ledger",
    )
  ).rows[0];
}

test("actual HTTP handler rejects unsigned, tampered, foreign-shop and unsupported-topic deliveries before persistence", async () => {
  const missing = request();
  missing.headers.delete("x-shopify-hmac-sha256");
  const tampered = request();
  tampered.headers.set(
    "x-shopify-hmac-sha256",
    Buffer.alloc(32).toString("base64"),
  );
  const foreign = request();
  foreign.headers.set("x-shopify-shop-domain", "foreign.myshopify.com");
  for (const [req, status, error] of [
    [missing, 401, "invalid_webhook_signature"],
    [tampered, 401, "invalid_webhook_signature"],
    [foreign, 403, "unrecognized_shop"],
    [request("products/update"), 400, "unsupported_webhook_topic"],
    [request("orders/paid", "bad-id"), 400, "invalid_delivery_id"],
    [request("orders/paid", randomUUID(), "[1]"), 400, "invalid_json"],
  ] as const) {
    const r = await POST(req);
    assert.equal(r.status, status);
    assert.deepEqual(await r.json(), { error });
    assert.match(r.headers.get("cache-control") || "", /no-store/);
  }
  assert.deepEqual(await counts(), { receipts: 0, jobs: 0, ledger: 0 });
});
test("actual HTTP handler refuses success when verified delivery cannot be persisted", async () => {
  const r = await POST(request());
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: "database_not_configured" });
  assert.match(r.headers.get("cache-control") || "", /no-store/);
});
test("receipt and job roll back together; redelivery then persists exactly once", async () => {
  const id = randomUUID();
  const req = request("orders/paid", id);
  const event = verifyDelivery(await rawBody(req), req.headers, secret);
  await assert.rejects(
    transaction(async (s) => {
      await receiveOn(s, event);
      throw Error("Simulated transaction loss before commit");
    }),
  );
  assert.deepEqual(await counts(), { receipts: 0, jobs: 0, ledger: 0 });
  assert.deepEqual(await intake(request("orders/paid", id)), {
    duplicate: false,
  });
  assert.deepEqual(await intake(request("orders/paid", id)), {
    duplicate: true,
  });
  assert.deepEqual(await counts(), { receipts: 1, jobs: 1, ledger: 0 });
});
test("reconciliation rollback leaves no partial order or processed receipt; replay completes once", async () => {
  const job = await transaction(claimOn);
  assert.ok(job);
  await assert.rejects(
    transaction(async (s) => {
      await reconcileOn(s, job, async () => state);
      throw Error("Simulated crash before commit");
    }),
  );
  assert.equal(
    (await db.query("select * from ns.shopify_orders")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select * from ns.webhook_receipts where processed_at is not null",
      )
    ).rows.length,
    0,
  );
  assert.equal((await counts()).ledger, 0);
  assert.equal(
    await transaction((s) => reconcileOn(s, job, async () => state)),
    true,
  );
  assert.equal(
    await transaction((s) =>
      reconcileOn(s, job, async () => {
        throw Error("Completed job must not reload");
      }),
    ),
    false,
  );
  assert.equal((await counts()).ledger, 1);
});
test("all four signed topics converge on canonical state, including refund then delayed paid and cancellation", async () => {
  const refunded = {
    ...state,
    financialStatus: "PARTIALLY_REFUNDED",
    refundedCents: 250,
    updatedAt: "2026-10-02T00:00:00Z",
  };
  for (const topic of [
    "refunds/create",
    "orders/paid",
    "orders/updated",
    "orders/cancelled",
  ]) {
    const id = randomUUID();
    await intake(request(topic, id));
    const job = await transaction(claimOn);
    assert.ok(job);
    await transaction((s) => reconcileOn(s, job, async () => refunded));
    assert.deepEqual(await intake(request(topic, id)), { duplicate: true });
  }
  assert.equal((await counts()).ledger, 2);
  const row = (
    await db.query<{ refunded_cents: string }>(
      "select refunded_cents from ns.shopify_orders",
    )
  ).rows[0];
  assert.equal(Number(row.refunded_cents), 250);
  assert.equal(
    (await db.query("select * from ns.order_jobs where state<>'complete'")).rows
      .length,
    0,
  );
});
test("wrong-order provider response cannot persist; retry exhaustion is bounded, sanitized and not claimable", async () => {
  const id = randomUUID();
  await intake(request("orders/updated", id));
  for (let attempt = 1; attempt <= 8; attempt++) {
    const job = await transaction(claimOn);
    assert.ok(job);
    assert.equal(job.attempts, attempt);
    await assert.rejects(
      transaction((s) =>
        reconcileOn(s, job, async () => ({
          ...state,
          id: "gid://shopify/Order/999",
        })),
      ),
      /order_identity_mismatch/,
    );
    await transaction((s) => failOn(s, job));
    const row = (
      await db.query<{ state: string; last_error: string; delayed: boolean }>(
        "select state,last_error,available_at>now() delayed from ns.order_jobs where receipt_id=$1",
        [job.receipt_id],
      )
    ).rows[0];
    assert.equal(row.state, attempt === 8 ? "failed" : "pending");
    assert.equal(row.last_error, "provider_or_database_unavailable");
    assert.equal(row.delayed, true);
    assert.equal(await transaction(claimOn), undefined);
    await db.query(
      "update ns.order_jobs set available_at=now() where receipt_id=$1",
      [job.receipt_id],
    );
  }
  assert.equal(await transaction(claimOn), undefined);
  assert.equal((await counts()).ledger, 2);
});
