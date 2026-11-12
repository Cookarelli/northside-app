import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { verify } from "../../webhooks/lib/receiver";
import { receiveOn as quarantine } from "../../webhooks/lib/inbox";
import {
  verifyDelivery,
  rawBody,
  receiveOn,
  claimOn,
  reconcileOn,
  runOrderJobs,
} from "../lib/server/order-jobs";
import {
  importReceiptOn,
  importPilotReceipts,
} from "../lib/server/receipt-import";
import type { Sql } from "../lib/server/db";
import { SHOP } from "../lib/server/providers";
import type { OrderSnapshot } from "../lib/server/admin-shopify";
const db = await PGlite.create(),
  sql = db as unknown as Sql;
for (const file of [
  "supabase/migrations/202609120001_identity_and_records.sql",
  "supabase/migrations/202609120003_commerce.sql",
  "../../supabase/migrations/20261019133518_shopify_webhook_pilot_inbox.sql",
  "supabase/migrations/20261029133844_commerce_delivery_integrity.sql",
])
  await db.exec(await readFile(file, "utf8"));
test.after(() => db.close());
const secret = "SYNTHETIC_SECRET_FOR_RECEIPT_TEST";
function request(
  delivery = randomUUID(),
  topic = "orders/updated",
  isTest = false,
  extra = "",
) {
  const raw = JSON.stringify({
    admin_graphql_api_id: "gid://shopify/Order/900",
    test: isTest,
    extra,
  });
  return new Request("https://receiver.example.test/api/shopify/webhooks", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-shopify-shop-domain": SHOP,
      "x-shopify-api-version": "2026-07",
      "x-shopify-webhook-id": delivery,
      "x-shopify-topic": topic,
      "x-shopify-hmac-sha256": createHmac("sha256", secret)
        .update(raw)
        .digest("base64"),
    },
  });
}
async function role<T>(name: string, fn: () => Promise<T>) {
  await db.exec(`begin; set local role ${name}`);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function counts() {
  return (
    await db.query<{ receipts: number; jobs: number; ledger: number }>(
      "select (select count(*)::int from ns.webhook_receipts) receipts, (select count(*)::int from ns.order_jobs) jobs, (select count(*)::int from ns.order_ledger) ledger",
    )
  ).rows[0];
}
const snapshot: OrderSnapshot = {
  id: "gid://shopify/Order/900",
  test: false,
  customerId: null,
  name: "SYNTHETIC",
  financialStatus: "PAID",
  cancelledAt: null,
  updatedAt: "2026-10-29T00:00:00Z",
  currency: "USD",
  totalCents: 1000,
  receivedCents: 1000,
  refundedCents: 0,
};

test("public quarantine keeps only verified metadata; restricted private import atomically queues exactly once", async () => {
  const receipt = await verify(request(), secret);
  await role("northside_webhook_receiver", () => quarantine(sql, receipt));
  assert.deepEqual(await counts(), { receipts: 0, jobs: 0, ledger: 0 });
  await assert.rejects(
    role("northside_webhook_receiver", () =>
      sql.query("select * from ns.order_jobs"),
    ),
  );
  await assert.rejects(
    role("northside_runtime", () =>
      sql.query("select * from ns_webhook_pilot.receipts"),
    ),
  );
  await assert.rejects(
    role("northside_commerce", () =>
      sql.query("delete from ns_webhook_pilot.receipts"),
    ),
  );
  await assert.rejects(
    role("northside_commerce", async () => {
      await importReceiptOn(sql, receipt.delivery);
      throw Error("rollback");
    }),
  );
  assert.deepEqual(await counts(), { receipts: 0, jobs: 0, ledger: 0 });
  assert.deepEqual(
    await role("northside_commerce", () =>
      importReceiptOn(sql, receipt.delivery),
    ),
    { duplicate: false },
  );
  assert.deepEqual(
    await role("northside_commerce", () =>
      importReceiptOn(sql, receipt.delivery),
    ),
    { duplicate: true },
  );
  assert.deepEqual(await counts(), { receipts: 1, jobs: 1, ledger: 0 });
  const job = await role("northside_commerce", () => claimOn(sql));
  assert.ok(job);
  await role("northside_commerce", () =>
    reconcileOn(sql, job, async (id) => {
      assert.equal(id, snapshot.id);
      return snapshot;
    }),
  );
  assert.deepEqual(await counts(), { receipts: 1, jobs: 1, ledger: 1 });
});

test("same delivery with changed topic/order/body is rejected and immutable binding cannot be rewritten", async () => {
  const req = request(),
    event = verifyDelivery(await rawBody(req), req.headers, secret);
  await role("northside_commerce", () => receiveOn(sql, event));
  for (const changed of [
    { ...event, topic: "orders/paid" },
    { ...event, orderId: "gid://shopify/Order/901" },
    { ...event, bodyHash: "b".repeat(64) },
  ])
    await assert.rejects(
      role("northside_commerce", () => receiveOn(sql, changed)),
      /delivery_conflict/,
    );
  await assert.rejects(
    db.query("update ns.order_jobs set body_hash=$1", ["c".repeat(64)]),
    /order_delivery_immutable/,
  );
  const job = await role("northside_commerce", () => claimOn(sql));
  assert.ok(job);
  await role("northside_commerce", () =>
    reconcileOn(sql, job, async () => snapshot),
  );
  assert.equal((await counts()).ledger, 1); // Distinct delivery, same state: no new ledger fact.
});

test("raw HMAC remains byte-exact and API version, UUID and canonical signature checks reject before persistence", async () => {
  const valid = request();
  const raw = await rawBody(valid);
  for (const [key, value] of [
    ["x-shopify-api-version", "2026-10"],
    ["x-shopify-webhook-id", "-".repeat(36)],
    [
      "x-shopify-hmac-sha256",
      valid.headers.get("x-shopify-hmac-sha256")! + "!",
    ],
  ]) {
    const headers = new Headers(valid.headers);
    headers.set(key, value);
    assert.throws(() => verifyDelivery(raw, headers, secret));
  }
  assert.throws(
    () =>
      verifyDelivery(
        Buffer.concat([raw, Buffer.from(" ")]),
        valid.headers,
        secret,
      ),
    /signature/,
  );
  const upper = new Headers(valid.headers);
  upper.set(
    "x-shopify-webhook-id",
    upper.get("x-shopify-webhook-id")!.toUpperCase(),
  );
  assert.equal(
    verifyDelivery(raw, upper, secret).delivery,
    valid.headers.get("x-shopify-webhook-id"),
  );
});

test("test receipts and canonical test orders cannot contaminate the live financial ledger", async () => {
  const receipt = await verify(
    request(randomUUID(), "orders/updated", true),
    secret,
  );
  await role("northside_webhook_receiver", () => quarantine(sql, receipt));
  await assert.rejects(
    role("northside_commerce", () => importReceiptOn(sql, receipt.delivery)),
    /eligible_quarantine/,
  );
  const req = request(),
    event = verifyDelivery(await rawBody(req), req.headers, secret);
  await role("northside_commerce", () => receiveOn(sql, event));
  const job = await role("northside_commerce", () => claimOn(sql));
  assert.ok(job);
  const before = await counts();
  await assert.rejects(
    role("northside_commerce", () =>
      reconcileOn(sql, job, async () => ({ ...snapshot, test: true })),
    ),
    /test_order_excluded/,
  );
  assert.deepEqual(await counts(), before);
  await db.query(
    "update ns.order_jobs set lease_until=clock_timestamp()-interval '1 second' where receipt_id=$1",
    [job.receipt_id],
  );
  assert.equal(
    await role("northside_commerce", () =>
      reconcileOn(sql, job, async () => {
        throw Error("stale lease cannot read");
      }),
    ),
    false,
  );
  const retry = await role("northside_commerce", () => claimOn(sql));
  assert.ok(retry);
  const cancelled = {
    ...snapshot,
    financialStatus: "REFUNDED",
    refundedCents: 1000,
    cancelledAt: "2026-10-29T01:00:00Z",
    updatedAt: "2026-10-29T01:00:00Z",
  };
  await role("northside_commerce", () =>
    reconcileOn(sql, retry, async () => cancelled),
  );
  const row = (
    await db.query<{ refunded_cents: number; cancelled_at: unknown }>(
      "select refunded_cents::int,cancelled_at from ns.shopify_orders",
    )
  ).rows[0];
  assert.equal(row.refunded_cents, 1000);
  assert.ok(row.cancelled_at);
});

test("processor and import commands return disabled without touching database or provider", async () => {
  const old = process.env.NORTHSIDE_ORDER_PROCESSOR_MODE;
  delete process.env.NORTHSIDE_ORDER_PROCESSOR_MODE;
  try {
    assert.deepEqual(await runOrderJobs(), {
      completed: 0,
      failed: 0,
      disabled: true,
    });
    assert.deepEqual(await importPilotReceipts(), {
      imported: 0,
      disabled: true,
    });
  } finally {
    if (old !== undefined) process.env.NORTHSIDE_ORDER_PROCESSOR_MODE = old;
  }
});
