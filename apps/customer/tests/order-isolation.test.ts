import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { type Actor, type Sql, authorizeOn } from "../lib/server/db";
import { TENANT } from "../lib/server/providers";
import { createSession } from "../lib/server/sessions";
import { bindCustomer, ownedOrders } from "../lib/server/customer-commerce";
import {
  receiveOn,
  claimOn,
  reconcileOn,
  failOn,
} from "../lib/server/order-jobs";
import { cartOn } from "../lib/server/cart-session";
import { recordTouch } from "../lib/server/campaigns";
import { hashToken, opaqueToken, seal } from "../lib/server/security";
import type { OrderSnapshot } from "../lib/server/admin-shopify";
const db = await PGlite.create(),
  sql = db as unknown as Sql;
for (const file of [
  "202609120001_identity_and_records.sql",
  "202609120003_commerce.sql",
])
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const a = randomUUID(),
  b = randomUUID(),
  other = randomUUID(),
  T2 = "22222222-2222-4222-8222-222222222222";
await db.query(
  "insert into ns.tenants(id,slug,shop,is_test) values($1,'commerce-test-only','foreign.myshopify.com',true)",
  [T2],
);
for (const [t, id] of [
  [TENANT, a],
  [TENANT, b],
  [T2, other],
])
  await db.query("insert into ns.customers(tenant_id,id) values($1,$2)", [
    t,
    id,
  ]);
const actor = (customer: string, tenant = TENANT): Actor => ({
  tenant_id: tenant,
  customer_id: customer,
  staff_id: null,
  staff_role: null,
});
async function role<T>(name: string, fn: (db: Sql) => Promise<T>) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${name}`);
    const r = await fn(sql);
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const tokenA = await role("northside_auth", (s) =>
  createSession(
    s,
    { customerId: a },
    "shopify",
    { access_token: "SAMPLE_A", subject: "subject-a" },
    3600,
  ),
);
const tokenB = await role("northside_auth", (s) =>
  createSession(
    s,
    { customerId: b },
    "shopify",
    { access_token: "SAMPLE_B", subject: "subject-b" },
    3600,
  ),
);
await role("northside_auth", (s) =>
  bindCustomer(s, actor(a), "gid://shopify/Customer/1"),
);
await role("northside_auth", (s) =>
  bindCustomer(s, actor(b), "gid://shopify/Customer/2"),
);
const state: OrderSnapshot = {
  id: "gid://shopify/Order/100",
  customerId: "gid://shopify/Customer/1",
  name: "SAMPLE ORDER",
  financialStatus: "PARTIALLY_REFUNDED",
  cancelledAt: null,
  updatedAt: "2026-09-12T12:00:00Z",
  currency: "USD",
  totalCents: 10000,
  receivedCents: 10000,
  refundedCents: 2500,
};
const delivery = (topic = "orders/paid", orderId = state.id) => ({
  delivery: randomUUID(),
  topic,
  orderId,
});
await db.query(
  "insert into ns.shopify_orders(tenant_id,shop,order_id,shopify_customer_id,name,financial_status,currency,total_cents,received_cents,refunded_cents,provider_updated_at,fingerprint) values($1,'foreign.myshopify.com','gid://shopify/Order/999','gid://shopify/Customer/3','OTHER TENANT SAMPLE ORDER','PAID','USD',500,500,0,now(),'sample-foreign')",
  [T2],
);
test("durable duplicate protection, refund-before-delayed-paid convergence and immutable order ledger", async () => {
  const refund = delivery("refunds/create");
  assert.deepEqual(
    await role("northside_commerce", (s) => receiveOn(s, refund)),
    { duplicate: false },
  );
  assert.deepEqual(
    await role("northside_commerce", (s) => receiveOn(s, refund)),
    { duplicate: true },
  );
  const job = await role("northside_commerce", claimOn);
  assert.ok(job);
  assert.equal(
    await role("northside_commerce", (s) =>
      reconcileOn(s, job, async () => state),
    ),
    true,
  );
  assert.equal(
    await role("northside_commerce", (s) =>
      reconcileOn(s, job, async () => {
        throw Error("Must not reload completed job");
      }),
    ),
    false,
  );
  await role("northside_commerce", (s) => receiveOn(s, delivery()));
  const delayed = await role("northside_commerce", claimOn);
  assert.ok(delayed);
  await role("northside_commerce", (s) =>
    reconcileOn(s, delayed, async () => state),
  );
  assert.equal(
    (
      await db.query<{ count: number }>(
        "select count(*)::int as count from ns.order_ledger",
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await db.query<{ refunded_cents: number }>(
        "select refunded_cents::int from ns.shopify_orders where tenant_id=$1",
        [TENANT],
      )
    ).rows[0].refunded_cents,
    2500,
  );
  await assert.rejects(db.exec("update ns.order_ledger set snapshot='{}'"));
});
test("owned orders enforce actual server authorization and independent RLS across customers/tenants", async () => {
  await role("northside_runtime", async (s) => {
    const who = await authorizeOn(s, tokenA);
    assert.equal((await ownedOrders(s, who)).length, 1);
    assert.equal((await ownedOrders(s, actor(b))).length, 0);
    assert.equal((await ownedOrders(s, actor(other, T2))).length, 0);
  });
  await role("northside_runtime", async (s) => {
    const who = await authorizeOn(s, tokenB);
    assert.equal((await ownedOrders(s, who)).length, 0);
    assert.equal(
      (await s.query("select * from ns.shopify_orders")).rows.length,
      0,
    );
    await s.query("select set_config('ns.customer_id',$1,true)", [a]);
    assert.equal(
      (await s.query("select * from ns.shopify_orders")).rows.length,
      0,
    );
  });
  await assert.rejects(
    role("northside_runtime", (s) =>
      s.query("select * from ns.commerce_carts"),
    ),
  );
  await assert.rejects(
    role("northside_commerce", (s) => s.query("select * from ns.sessions")),
  );
  await assert.rejects(
    role("northside_auth", (s) => s.query("select * from ns.order_ledger")),
  );
  await assert.rejects(
    role("northside_auth", (s) =>
      bindCustomer(s, actor(a), "gid://shopify/Customer/2"),
    ),
  );
  await assert.rejects(
    role("northside_auth", (s) =>
      bindCustomer(s, actor(other, T2), "gid://shopify/Customer/3"),
    ),
    /wrong_shop/,
  );
});
test("failed provider reads retry durably, leases exclude second workers and stale reads cannot undo refunds", async () => {
  await role("northside_commerce", (s) =>
    receiveOn(s, delivery("orders/cancelled")),
  );
  const job = await role("northside_commerce", claimOn);
  assert.ok(job);
  assert.equal(await role("northside_commerce", claimOn), undefined);
  await assert.rejects(
    role("northside_commerce", (s) =>
      reconcileOn(s, job, async () => ({
        ...state,
        refundedCents: 0,
        updatedAt: "2026-09-11T12:00:00Z",
      })),
    ),
    /stale_order_state/,
  );
  await role("northside_commerce", (s) => failOn(s, job));
  const saved = (
    await db.query<{ state: string; attempts: number; last_error: string }>(
      "select state,attempts,last_error from ns.order_jobs where receipt_id=$1",
      [job.receipt_id],
    )
  ).rows[0];
  assert.equal(saved.state, "pending");
  assert.equal(saved.attempts, 1);
  assert.equal(saved.last_error, "provider_or_database_unavailable");
  await db.query(
    "update ns.order_jobs set available_at=now() where receipt_id=$1",
    [job.receipt_id],
  );
  const retry = await role("northside_commerce", claimOn);
  assert.ok(retry);
  assert.notEqual(retry.lease_token, job.lease_token);
  assert.equal(
    await role("northside_commerce", (s) =>
      reconcileOn(s, job, async () => state),
    ),
    false,
  );
  await role("northside_commerce", (s) =>
    reconcileOn(s, retry, async () => ({
      ...state,
      cancelledAt: "2026-09-12T13:00:00Z",
      updatedAt: "2026-09-12T13:00:00Z",
    })),
  );
});
test("cart secrets are encrypted, expire, and require the bound customer after sign-out or account switch", async () => {
  const handle = opaqueToken(),
    hash = hashToken(handle),
    raw = "gid://shopify/Cart/SAMPLE?key=PRIVATE_TEST_KEY";
  await db.query(
    "insert into ns.commerce_carts(token_hash,tenant_id,customer_id,encrypted_cart) values($1,$2,$3,$4)",
    [hash, TENANT, a, seal({ id: raw }, hash)],
  );
  assert.equal(
    (await role("northside_commerce", (s) => cartOn(s, handle, a))).cartId,
    raw,
  );
  for (const customer of [b, null])
    await assert.rejects(
      role("northside_commerce", (s) => cartOn(s, handle, customer)),
      /cart_owner_mismatch/,
    );
  await assert.rejects(
    role("northside_commerce", (s) => cartOn(s, opaqueToken(), a)),
    /cart_expired/,
  );
  await db.query(
    "update ns.commerce_carts set expires_at=now()-interval '1 second' where token_hash=$1",
    [hash],
  );
  await assert.rejects(
    role("northside_commerce", (s) => cartOn(s, handle, a)),
    /cart_expired/,
  );
});
test("first/latest campaign references require registry eligibility and consent, never accept arbitrary URL text", async () => {
  const token = opaqueToken(),
    first = "A".repeat(22),
    last = "B".repeat(22);
  await db.query(
    "insert into ns.campaign_refs(tenant_id,ref,enabled) values($1,$2,true),($1,$3,true)",
    [TENANT, first, last],
  );
  await assert.rejects(
    role("northside_commerce", (s) => recordTouch(s, token, first, false)),
    /consent_required/,
  );
  await assert.rejects(
    role("northside_commerce", (s) =>
      recordTouch(s, token, "email@example.test", true),
    ),
    /consent_required/,
  );
  await role("northside_commerce", (s) => recordTouch(s, token, first, true));
  await role("northside_commerce", (s) => recordTouch(s, token, last, true));
  const touch = (
    await db.query<{ first_ref: string; last_ref: string; consent: boolean }>(
      "select first_ref,last_ref,consent from ns.campaign_touches where token_hash=$1",
      [hashToken(token)],
    )
  ).rows[0];
  assert.deepEqual(touch, { first_ref: first, last_ref: last, consent: true });
});
test("worker crash leases are reclaimed and the previous worker cannot commit", async () => {
  await role("northside_commerce", (s) =>
    receiveOn(s, delivery("orders/updated")),
  );
  const crashed = await role("northside_commerce", claimOn);
  assert.ok(crashed);
  await db.query(
    "update ns.order_jobs set lease_until=now()-interval '1 second' where receipt_id=$1",
    [crashed.receipt_id],
  );
  const recovered = await role("northside_commerce", claimOn);
  assert.ok(recovered);
  assert.notEqual(crashed.lease_token, recovered.lease_token);
  assert.equal(
    await role("northside_commerce", (s) =>
      reconcileOn(s, crashed, async () => state),
    ),
    false,
  );
  await role("northside_commerce", (s) =>
    reconcileOn(s, recovered, async () => ({
      ...state,
      cancelledAt: "2026-09-12T13:00:00Z",
      updatedAt: "2026-09-12T13:00:00Z",
    })),
  );
  assert.equal(
    (
      await role("northside_commerce", (s) =>
        s.query("select * from ns.shopify_orders where tenant_id=$1", [T2]),
      )
    ).rows.length,
    0,
  );
});
test.after(async () => {
  await db.close();
});
