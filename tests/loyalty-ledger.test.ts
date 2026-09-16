import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  createRule,
  approveRule,
  enroll,
  reconcileLoyaltyOrder,
  wallet,
  adjustment,
  lineAllocation,
  requestOrderClaim,
  dispute,
} from "../lib/server/loyalty";
import { type Sql } from "../lib/server/db";
import { TENANT, SHOP } from "../lib/server/providers";
import type { LoyaltyRules, LoyaltyOrder } from "../lib/loyalty";
const dir = await mkdtemp(join(tmpdir(), "northside-loyalty-ledger-"));
const f = await openPreviewDatabase(dir);
await f.db.exec(
  await readFile("supabase/migrations/202609120006_loyalty.sql", "utf8"),
);
for (const n of [1, 2])
  await f.db.query(
    "insert into ns.shopify_customers(tenant_id,customer_id,shop,shopify_id) values($1,$2,$3,$4)",
    [TENANT, previewId(n), SHOP, `gid://shopify/Customer/${n}`],
  );
const rules: LoyaltyRules = {
  points_per_dollar: 10,
  qualification_days: 365,
  tiers: [
    { label: "Rookie", threshold_cents: 0 },
    { label: "Vet", threshold_cents: 10000 },
    { label: "HOF", threshold_cents: 100000 },
    { label: "GOAT", threshold_cents: 1000000 },
  ],
  eligible_products: [
    { id: "gid://shopify/Product/1", kind: "retail" },
    { id: "gid://shopify/Product/2", kind: "grading" },
    { id: "gid://shopify/Product/3", kind: "break" },
    { id: "gid://shopify/Product/4", kind: "consignment" },
  ],
  approved_service_kinds: [],
  excluded_product_ids: [],
  points_expiry: "none",
  rounding: "floor_per_line_cumulative",
  tier_returns: "reduce_original_period",
  refund_restoration: "manual_review",
};
const worker = <T>(fn: (db: Sql) => Promise<T>) =>
  f.db.transaction(async (tx) => {
    await tx.exec("set local role northside_loyalty");
    return fn(tx as unknown as Sql);
  });
const fail = (status: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === status;
let version = "";
const now = () => new Date().toISOString();
const order = (n = 1): LoyaltyOrder => ({
  id: `gid://shopify/Order/${n}`,
  customerId: "gid://shopify/Customer/1",
  createdAt: now(),
  updatedAt: now(),
  paidAt: now(),
  financialStatus: "PAID",
  cancelled: false,
  currency: "USD",
  channel: "web",
  lines: [
    {
      id: `gid://shopify/LineItem/${n}`,
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/1",
      isGiftCard: false,
      quantity: 3,
      currentQuantity: 3,
      originalNetCents: 10001,
      refundedCents: 0,
      refundedQuantity: 0,
    },
  ],
  ambiguousRefund: false,
  discounts: [],
  campaignRef: null,
});
test("loyalty pass 1: draft stays inactive; approval creates immutable version; unapproved live gate rejects", async () => {
  const d = await f.run("staff", (db, a) =>
    createRule(db, a, rules, "Fictional test rules", "sample"),
  );
  await assert.rejects(
    f.run("a", (db, a) => enroll(db, a, "sample")),
    fail(409),
  );
  const r = await f.run("staff", (db, a) =>
    approveRule(
      db,
      a,
      d.id,
      new Date(Date.now() - 60000).toISOString(),
      "SAMPLE approval only",
      "sample",
    ),
  );
  version = r.id;
  assert.notEqual(d.id, r.id);
  await assert.rejects(
    f.db.query("update ns.loyalty_rules set parameters='{}' where id=$1", [
      version,
    ]),
    /Append-only/,
  );
  await assert.rejects(
    f.run("a", (db, a) => enroll(db, a, "live")),
    fail(409),
  );
  await f.run("a", (db, a) => enroll(db, a, "sample"));
  assert.equal(
    (await f.run("a", (db, a) => wallet(db, a, "sample"))).balance,
    0,
  );
  assert.equal(
    (await f.run("b", (db, a) => wallet(db, a, "sample"))).state,
    "not_enrolled",
  );
});
test("loyalty pass 1: eligible paid lines exclude discounts/tax/shipping/gifts/services and duplicate notifications", async () => {
  const o = order(1);
  o.lines.push(
    ...[2, 3, 4].map((n) => ({
      ...o.lines[0],
      id: `gid://shopify/LineItem/${n}`,
      productId: `gid://shopify/Product/${n}`,
    })),
    { ...o.lines[0], id: "gid://shopify/LineItem/5", isGiftCard: true },
  );
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  const w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.balance, 1000);
  assert.equal(w.ledger.length, 1);
  assert.equal(w.tier?.qualifying_cents, 10001);
  assert.equal(w.tier?.label, "Vet");
  assert.equal(
    (await f.run("b", (db, a) => wallet(db, a, "sample"))).ledger.length,
    0,
  );
  await f.run("b", async (db) =>
    assert.equal(
      (await db.query("select * from ns.loyalty_ledger")).rows.length,
      0,
    ),
  );
});
test("loyalty pass 1: cumulative partial refunds converge without repeated rounding loss; original allocation frozen", async () => {
  const a = order(20),
    b = order(21);
  a.lines[0].originalNetCents = b.lines[0].originalNetCents = 101;
  await worker((db) => reconcileLoyaltyOrder(db, a, "sample"));
  await worker((db) => reconcileLoyaltyOrder(db, b, "sample"));
  for (const cents of [30, 60, 101]) {
    a.lines[0].refundedCents = cents;
    a.updatedAt = new Date(Date.now() + cents).toISOString();
    a.financialStatus = "PARTIALLY_REFUNDED";
    await worker((db) => reconcileLoyaltyOrder(db, a, "sample"));
  }
  b.lines[0].refundedCents = 101;
  b.updatedAt = new Date(Date.now() + 500).toISOString();
  b.financialStatus = "REFUNDED";
  await worker((db) => reconcileLoyaltyOrder(db, b, "sample"));
  for (const o of [a, b])
    assert.equal(
      Number(
        (
          await f.db.query<{ n: string }>(
            "select sum(points) n from ns.loyalty_ledger where source_object like $1",
            [o.id + "/%"],
          )
        ).rows[0].n,
      ),
      0,
    );
  await assert.rejects(
    f.db.query(
      "update ns.loyalty_line_allocations set original_points=999 where order_id=$1",
      [a.id],
    ),
    /immutable/,
  );
});
test("loyalty pass 1: cancellation before paid and stale delivery cannot earn; monetary-only refund stays in review", async () => {
  const o = order(30);
  o.cancelled = true;
  o.paidAt = null;
  o.financialStatus = "VOIDED";
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  const late = {
    ...o,
    cancelled: false,
    paidAt: now(),
    financialStatus: "PAID",
    updatedAt: new Date(Date.parse(o.updatedAt) - 1000).toISOString(),
  };
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, late, "sample"))).state,
    "stale_ignored",
  );
  const ambiguous = order(31);
  ambiguous.ambiguousRefund = true;
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, ambiguous, "sample")))
      .state,
    "review",
  );
  assert.equal(
    (
      await f.db.query(
        "select * from ns.loyalty_ledger where source_object like 'gid://shopify/Order/3%'",
      )
    ).rows.length,
    0,
  );
});
test("loyalty pass 1: order edits remove earnings, catalog changes preserve eligibility; anonymous claims never guess ownership", async () => {
  const o = order(40);
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  o.lines[0].productId = "gid://shopify/Product/999";
  o.lines[0].currentQuantity = 1;
  o.updatedAt = new Date(Date.now() + 1000).toISOString();
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  const allocation = (
    await f.db.query<{
      current_points: number;
      eligibility: { productId: string };
    }>("select * from ns.loyalty_line_allocations where order_id=$1", [o.id])
  ).rows[0];
  assert.equal(allocation.eligibility.productId, "gid://shopify/Product/1");
  assert.equal(allocation.current_points, 334);
  o.lines = [];
  o.updatedAt = new Date(Date.now() + 2000).toISOString();
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  const anon = order(41);
  anon.customerId = null;
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, anon, "sample"))).state,
    "awaiting_verified_owner",
  );
  await assert.rejects(
    f.run("a", (db, a) => requestOrderClaim(db, a, anon.id)),
    fail(404),
  );
  const pre = order(42);
  pre.createdAt = "2020-01-01T00:00:00Z";
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, pre, "sample"))).state,
    "not_launched",
  );
});
test("loyalty pass 1: signed correction, duplicate source and refund debt reconcile to cache; restricted roles cannot write", async () => {
  const correction = {
    customer_id: previewId(1),
    points: -1200,
    source_id: randomUUID(),
    reason: "SAMPLE spent-points debt simulation",
  };
  await f.run("staff", (db, a) => adjustment(db, a, correction, "sample"));
  await f.run("staff", (db, a) => adjustment(db, a, correction, "sample"));
  const w = await f.run("a", (db, a) => wallet(db, a, "sample"));
  assert.equal(w.balance, -200);
  assert.equal(w.spendable, 0);
  assert.equal(w.negative_review, true);
  const sum = Number(
    (
      await f.db.query<{ n: string }>(
        "select sum(points) n from ns.loyalty_ledger",
      )
    ).rows[0].n,
  );
  assert.equal(sum, w.balance);
  for (const who of ["a", "reader", "editor"])
    await assert.rejects(
      f.run(who, (db, a) =>
        adjustment(db, a, { ...correction, source_id: randomUUID() }, "sample"),
      ),
      fail(403),
    );
  await assert.rejects(
    f.run("a", (db) =>
      db.query(
        "insert into ns.loyalty_ledger(tenant_id,account_id,customer_id,rule_id,points,source_object,operation,reason) select tenant_id,id,customer_id,$1,100,'forged','credit','Forged' from ns.loyalty_accounts",
        [version],
      ),
    ),
    /row-level/,
  );
  await assert.rejects(
    f.db.query("delete from ns.loyalty_ledger"),
    /Append-only/,
  );
  const entry = w.ledger[0].id;
  await f.run("a", (db, a) => dispute(db, a, entry, "Sample dispute"));
  await assert.rejects(
    f.run("b", (db, a) => dispute(db, a, entry, "Wrong owner")),
    fail(404),
  );
});
test("loyalty pass 1: allocation property checks cap reversals and preserve zero/nonnegative targets", () => {
  for (let cents = 0; cents < 500; cents += 7)
    for (
      let refunded = 0;
      refunded <= cents;
      refunded += Math.max(1, Math.floor(cents / 7))
    ) {
      const l = {
        ...order().lines[0],
        originalNetCents: cents,
        refundedCents: refunded,
      };
      const a = lineAllocation(l, rules);
      assert.ok(a.target >= 0 && a.target <= a.points);
      assert.ok(a.current >= 0 && a.current <= a.base);
      const full = lineAllocation({ ...l, refundedCents: cents }, rules);
      assert.equal(full.target, 0);
    }
});
test("loyalty enrollment date stays enforced after an earlier uncredited order is reconciled again", async () => {
  const o = order(800);
  o.customerId = "gid://shopify/Customer/2";
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, o, "sample"))).state,
    "not_enrolled_at_purchase",
  );
  await f.run("b", (db, a) => enroll(db, a, "sample"));
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, o, "sample"))).state,
    "not_enrolled_at_purchase",
  );
  assert.equal(
    (await f.run("b", (db, a) => wallet(db, a, "sample"))).balance,
    0,
  );
});
test("increased and malformed line edits enter review before any partial ledger change", async () => {
  const o = order(900);
  await worker((db) => reconcileLoyaltyOrder(db, o, "sample"));
  const before = (await f.run("a", (db, a) => wallet(db, a, "sample"))).balance;
  o.lines[0].originalNetCents += 500;
  o.updatedAt = new Date(Date.now() + 1000).toISOString();
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, o, "sample"))).state,
    "review",
  );
  assert.equal(
    (await f.run("a", (db, a) => wallet(db, a, "sample"))).balance,
    before,
  );
  o.lines[0].originalNetCents -= 500;
  o.lines[0].currentQuantity = 1;
  o.lines.push({
    ...o.lines[0],
    id: "gid://shopify/LineItem/901",
    currentQuantity: 5,
  });
  o.updatedAt = new Date(Date.now() + 2000).toISOString();
  assert.equal(
    (await worker((db) => reconcileLoyaltyOrder(db, o, "sample"))).state,
    "review",
  );
  assert.equal(
    (await f.run("a", (db, a) => wallet(db, a, "sample"))).balance,
    before,
  );
});
test.after(async () => {
  await f.db.close();
  await rm(dir, { recursive: true, force: true });
});
