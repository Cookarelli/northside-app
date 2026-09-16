import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  loyaltyFixture,
  SampleAdapter,
  fail,
  sampleOrder,
} from "./support/loyalty-fixture";
import {
  reserveReward,
  claimLoyaltyJob,
  issueReward,
  deactivateReward,
  requestDeactivation,
  restorePoints,
  recordVoucherUsage,
} from "../lib/server/loyalty-redemption";
import {
  wallet,
  adjustment,
  reconcileLoyaltyOrder,
} from "../lib/server/loyalty";
import { TENANT } from "../lib/server/providers";
import { previewId } from "../lib/server/grading-preview";
const f = await loyaltyFixture(),
  adapter = new SampleAdapter();
const reserve = () =>
  f.run("a", (db, a) =>
    reserveReward(db, a, f.reward.id, randomUUID(), "sample"),
  );
test("loyalty pass 2: simultaneous requests reserve once per source and cannot overspend held points", async () => {
  const id = randomUUID();
  const both = await Promise.all(
    [1, 2].map(() =>
      f.run("a", (db, a) => reserveReward(db, a, f.reward.id, id, "sample")),
    ),
  );
  assert.equal(both[0].id, both[1].id);
  const more = await Promise.allSettled([1, 2, 3, 4].map(reserve));
  assert.equal(more.filter((r) => r.status === "fulfilled").length, 3);
  const w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.held, 2000);
  assert.equal(w.spendable, 0);
  assert.equal(w.balance, 2000);
  await assert.rejects(
    f.run("b", (db, a) =>
      reserveReward(db, a, f.reward.id, randomUUID(), "sample"),
    ),
    fail(409),
  );
});
test("loyalty pass 2: timeout keeps holds; stable-code lookup recovers without creating twice", async () => {
  const job = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  adapter.timeout = true;
  await f.worker((db) => issueReward(db, job, adapter, "sample"));
  assert.equal(adapter.creates, 1);
  let w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.held, 2000);
  assert.equal(w.balance, 2000);
  await f.db.query(
    "update ns.loyalty_jobs set available_at=now()-interval '1 second' where id=$1",
    [job.id],
  );
  // Claim that exact retry before the other pending reservations.
  await f.db.query(
    "update ns.loyalty_jobs set available_at=now()+interval '1 day' where kind='issue' and id<>$1",
    [job.id],
  );
  const retry = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  adapter.timeout = false;
  assert.equal(
    await f.worker((db) => issueReward(db, retry, adapter, "sample")),
    true,
  );
  assert.equal(adapter.creates, 1);
  await f.worker((db) => issueReward(db, retry, adapter, "sample"));
  w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.vouchers.length, 1);
  assert.equal(w.balance, 1500);
  assert.equal(w.held, 1500);
});
test("loyalty pass 2: crash after remote creation rolls back local debit, new lease recovers; old lease cannot double issue", async () => {
  await f.db.query(
    "update ns.loyalty_jobs set available_at=now() where kind='issue' and state='pending'",
  );
  const job = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  await assert.rejects(
    f.worker(async (db) => {
      await issueReward(db, job, adapter, "sample");
      throw Error("simulated process crash before commit");
    }),
    /simulated/,
  );
  const created = adapter.creates;
  await f.db.query(
    "update ns.loyalty_jobs set lease_until=now()-interval '1 second' where id=$1",
    [job.id],
  );
  const retry = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  assert.equal(retry.id, job.id);
  assert.notEqual(retry.lease_token, job.lease_token);
  assert.equal(
    await f.worker((db) => issueReward(db, job, adapter, "sample")),
    false,
  );
  await f.worker((db) => issueReward(db, retry, adapter, "sample"));
  assert.equal(adapter.creates, created);
  const w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.vouchers.length, 2);
  assert.equal(w.balance, 1000);
});
test("loyalty pass 2: definitive first failure releases hold while unresolved repeat failure never does", async () => {
  const job = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  adapter.reject = true;
  await f.worker((db) => issueReward(db, job, adapter, "sample"));
  adapter.reject = false;
  const w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.balance, 1000);
  assert.equal(w.held, 500);
  assert.equal(w.spendable, 500);
  const another = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  adapter.timeout = true;
  await f.worker((db) => issueReward(db, another, adapter, "sample"));
  adapter.records.clear();
  adapter.timeout = false;
  adapter.reject = true;
  await f.db.query(
    "update ns.loyalty_jobs set available_at=now() where id=$1",
    [another.id],
  );
  const again = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  await f.worker((db) => issueReward(db, again, adapter, "sample"));
  adapter.reject = false;
  assert.equal(
    (await f.run("a", (db, a) => wallet(db, a, "sample"))).held,
    500,
  );
});
test("loyalty pass 2: paid usage is separate, duplicate-safe; wrong customer and voucher reuse go to review", async () => {
  const w = await f.run("a", (db, a) => wallet(db, a, "sample")),
    v = w.vouchers[0];
  const o = sampleOrder(500);
  o.discounts = [{ code: v.code, amountCents: 500 }];
  await f.worker((db) => recordVoucherUsage(db, o));
  await f.worker((db) => recordVoucherUsage(db, o));
  assert.equal(
    (await f.run("a", (db, a) => wallet(db, a, "sample"))).vouchers[0]
      .used_cents,
    500,
  );
  const wrong = {
    ...o,
    id: "gid://shopify/Order/501",
    customerId: "gid://shopify/Customer/2",
  };
  await f.worker((db) => recordVoucherUsage(db, wrong));
  const reuse = { ...o, id: "gid://shopify/Order/502" };
  await f.worker((db) => recordVoucherUsage(db, reuse));
  assert.equal(
    (
      await f.db.query(
        "select * from ns.loyalty_reviews where kind in ('voucher_reuse','voucher_wrong_owner')",
      )
    ).rows.length,
    2,
  );
  assert.equal(
    (await f.run("b", (db, a) => wallet(db, a, "sample"))).vouchers.length,
    0,
  );
});
test("loyalty pass 2: restoration needs refund evidence, original debit cap and role; earning reversal is separate", async () => {
  const w = await f.run("a", (db, a) => wallet(db, a, "sample")),
    v = w.vouchers[0];
  const data = {
    voucher_id: v.id,
    points: 250,
    source_id: randomUUID(),
    kind: "used_reward_refund" as const,
    reason: "SAMPLE approved partial restoration evidence",
  };
  await assert.rejects(
    f.run("staff", (db, a) => restorePoints(db, a, data, "sample")),
    fail(409),
  );
  const o = sampleOrder(500);
  o.discounts = [{ code: v.code, amountCents: 500 }];
  o.financialStatus = "PARTIALLY_REFUNDED";
  o.lines[0].refundedCents = 5000;
  await f.worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  await f.run("staff", (db, a) => restorePoints(db, a, data, "sample"));
  await f.run("staff", (db, a) => restorePoints(db, a, data, "sample"));
  await assert.rejects(
    f.run("staff", (db, a) =>
      restorePoints(
        db,
        a,
        { ...data, points: 251, source_id: randomUUID() },
        "sample",
      ),
    ),
    fail(409),
  );
  await assert.rejects(
    f.run("reader", (db, a) =>
      restorePoints(db, a, { ...data, source_id: randomUUID() }, "sample"),
    ),
    fail(403),
  );
  assert.equal(
    (await f.db.query("select * from ns.loyalty_restorations")).rows.length,
    1,
  );
});
test("loyalty pass 2: cancellation requires confirmed deactivation plus review; late payment stays an explicit exception", async () => {
  // A fresh voucher with its remote evidence retained for this cancellation scenario.
  await f.run("staff", (db, a) =>
    adjustment(
      db,
      a,
      {
        customer_id: previewId(1),
        points: 500,
        source_id: randomUUID(),
        reason: "SAMPLE cancellation test credit",
      },
      "sample",
    ),
  );
  const r = await reserve();
  await f.db.query(
    "update ns.loyalty_jobs set available_at=now()+interval '1 day' where kind='issue' and object_id<>$1",
    [r.id],
  );
  const job = (await f.worker((db) => claimLoyaltyJob(db, "issue")))!;
  await f.worker((db) => issueReward(db, job, adapter, "sample"));
  const v = (
    await f.run("a", (db, a) => wallet(db, a, "sample"))
  ).vouchers.find((v) => v.reservation_id === r.id)!;
  const data = {
    voucher_id: v.id,
    points: 500,
    source_id: randomUUID(),
    kind: "unused_cancelled" as const,
    reason: "SAMPLE reviewed unused cancellation",
    clearance_reference:
      "SAMPLE pending and paid checkouts independently reconciled",
  };
  await assert.rejects(
    f.run("staff", (db, a) => restorePoints(db, a, data, "sample")),
    fail(409),
  );
  await f.run("staff", (db, a) =>
    requestDeactivation(db, a, v.id, "SAMPLE cancel request"),
  );
  const j = (await f.worker((db) => claimLoyaltyJob(db, "deactivate")))!;
  await f.worker((db) => deactivateReward(db, j, adapter, "sample"));
  await f.run("staff", (db, a) => restorePoints(db, a, data, "sample"));
  const late = sampleOrder(600);
  late.discounts = [{ code: v.code, amountCents: 500 }];
  await f.worker((db) => recordVoucherUsage(db, late));
  assert.equal(
    (
      await f.db.query(
        "select * from ns.loyalty_reviews where kind='late_paid_usage'",
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      restorePoints(db, a, { ...data, source_id: randomUUID() }, "sample"),
    ),
    fail(409),
  );
  const sum = Number(
    (
      await f.db.query<{ n: string }>(
        "select sum(points) n from ns.loyalty_ledger where tenant_id=$1",
        [TENANT],
      )
    ).rows[0].n,
  );
  assert.equal(
    sum,
    (await f.run("a", (db, a) => wallet(db, a, "sample"))).balance,
  );
});
test.after(() => f.close());
