import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  initializeBreakPreview,
  breakSampleWorker,
  sampleOrder,
  sampleBreakId,
} from "../lib/server/break-preview";
import {
  saveBreak,
  publicBreaks,
  staffBreaks,
  saveReminder,
  myBreaks,
  participantConsent,
  addMapping,
} from "../lib/server/breaks";
import {
  reconcileBreakOrder,
  legacyPurchase,
  reviewPurchase,
} from "../lib/server/break-purchases";
import {
  checkProof,
  saleCheck,
  validateBreakCart,
  checklistKeys,
  type VariantProof,
} from "../lib/server/break-commerce";
import {
  enqueueBreakOrder,
  claimBreakJob,
  validBreakJob,
  failBreakJob,
  finishBreakJob,
} from "../lib/server/break-worker";
import { TENANT } from "../lib/server/providers";
import { breakCalendar } from "../lib/server/break-calendar";
import {
  chicagoToUtc,
  chicagoLocal,
  countdown,
  type BreakMapping,
} from "../lib/breaks";
const dir = await mkdtemp(join(tmpdir(), "northside-breaks-")),
  f = await openPreviewDatabase(dir);
await initializeBreakPreview(f);
const worker = <T>(fn: Parameters<typeof breakSampleWorker<T>>[1]) =>
  breakSampleWorker(f, fn);
const fail = (status: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === status;
const list = () => f.run("staff", (db, a) => staffBreaks(db, a, "sample"));
const current = async () =>
  (await list()).events.find((e) => e.id === sampleBreakId)!;
const mapping = async () =>
  (
    await f.db.query<BreakMapping>(
      "select * from ns.shopify_spot_mappings where variant_id='gid://shopify/ProductVariant/7001'",
    )
  ).rows[0];
const o = sampleOrder(1);
const checks = Object.fromEntries(checklistKeys.map((k) => [k, true]));
test("Chicago input validates spring gaps and explicit fall offsets; zero never becomes live", () => {
  assert.equal(
    chicagoToUtc("2026-11-01T01:30", "-05:00"),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    chicagoToUtc("2026-11-01T01:30", "-06:00"),
    "2026-11-01T07:30:00.000Z",
  );
  assert.throws(() => chicagoToUtc("2026-03-08T02:30", "-06:00"));
  assert.throws(() => chicagoToUtc("2026-09-12T12:00", "-06:00"));
  assert.match(
    countdown("2020-01-01T00:00:00Z", Date.now()),
    /waiting for a staff update/,
  );
  assert.equal(chicagoLocal("2026-09-12T17:00:00Z"), "2026-09-12T12:00");
});
test("calendar has stable UID, version, escaped content and UTF-8 byte folding", async () => {
  const e = await current();
  const ics = breakCalendar({
    ...e,
    title: "é".repeat(100) + "\nBEGIN:INJECT",
    description: "one,two;three\\four\r\nfive",
  });
  assert.match(ics, /UID:break-/);
  assert.match(ics, /SEQUENCE:2/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  assert.ok(ics.endsWith("\r\n"));
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.ok(!ics.includes("\r\nBEGIN:INJECT"));
  assert.match(breakCalendar({ ...e, status: "canceled" }), /STATUS:CANCELLED/);
  assert.throws(() => breakCalendar({ ...e, starts_at: null }), fail(409));
});
test("staff content scope, customer write denial and private table isolation", async () => {
  assert.equal(
    (await f.run("editor", (db, a) => staffBreaks(db, a, "sample"))).purchases
      .length,
    0,
  );
  await assert.rejects(
    f.run("a", (db, a) =>
      saveBreak(db, a, {}, randomUUID(), null, "bad", "sample"),
    ),
    fail(403),
  );
  const e = await current();
  await assert.rejects(
    f.run("reader", (db, a) =>
      saveBreak(db, a, e, e.id, e.version, "bad", "sample"),
    ),
    fail(403),
  );
  await assert.rejects(
    f.run("editor", (db, a) => addMapping(db, a, e.id, {} as never, "bad")),
    fail(403),
  );
});
test("saved reminders reschedule with edits; owner-only reads; optimistic version prevents overwrite", async () => {
  let e = await current();
  await f.run("a", (db, a) => saveReminder(db, a, e.id, 15, true, "sample"));
  assert.equal((await f.run("b", myBreaks)).reminders.length, 0);
  const next = new Date(
    new Date(e.starts_at!).getTime() + 3600000,
  ).toISOString();
  await f.run("editor", (db, a) =>
    saveBreak(
      db,
      a,
      { ...e, starts_at: next, status: "delayed" },
      e.id,
      e.version,
      "SAMPLE delay",
      "sample",
    ),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveBreak(db, a, e, e.id, e.version, "stale", "sample"),
    ),
    fail(409),
  );
  e = await current();
  const r = (await f.run("a", myBreaks)).reminders[0];
  assert.equal(
    new Date(r.scheduled_for as string).getTime(),
    Date.parse(next) - 900000,
  );
  assert.equal(r.event_version, e.version);
});
test("sale reconciliation requires every check and complete strict finite physical inventory", async () => {
  const e = await current(),
    m = await mapping();
  await assert.rejects(
    f.run("staff", (db, a) =>
      saleCheck(db, a, e.id, {}, "evidence", "test", "sample"),
    ),
    fail(400),
  );
  await f.run("staff", (db, a) =>
    saleCheck(db, a, e.id, checks, "SAMPLE evidence only", "test", "sample"),
  );
  const v: VariantProof = {
    id: m.variant_id,
    sku: m.sku,
    inventoryPolicy: "DENY",
    inventoryQuantity: 1,
    product: { id: m.product_id, status: "ACTIVE" },
    inventoryItem: { tracked: true, requiresShipping: true },
  };
  checkProof(m, v, 1, true);
  for (const bad of [
    { ...v, inventoryPolicy: "CONTINUE" },
    { ...v, inventoryQuantity: 2 },
    { ...v, product: { ...v.product, status: "DRAFT" } },
    { ...v, inventoryItem: { tracked: false, requiresShipping: true } },
    { ...v, inventoryItem: { tracked: true, requiresShipping: false } },
  ])
    assert.throws(() => checkProof(m, bad, 1, true), fail(409));
  assert.throws(() => checkProof(m, null, 1, true), fail(409));
});
test("paid line creates owned purchase; duplicate and competing last-spot order cannot double grant", async () => {
  const results = await Promise.all([
    worker((db) => reconcileBreakOrder(db, o, "sample")),
    worker((db) => reconcileBreakOrder(db, sampleOrder(2), "sample")),
  ]);
  assert.deepEqual(
    results.map((r) => r.state),
    ["reconciled", "review"],
  );
  await worker((db) => reconcileBreakOrder(db, o, "sample"));
  const m = await mapping();
  assert.equal(
    (
      await f.db.query<{ n: number }>(
        "select count(*)::int n from ns.break_allocations where mapping_id=$1 and active",
        [m.id],
      )
    ).rows[0].n,
    1,
  );
  const a = await f.run("a", myBreaks),
    b = await f.run("b", myBreaks);
  assert.equal(a.purchases.length, 1);
  assert.equal(a.purchases[0].status, "confirmed");
  assert.equal(b.purchases[0].status, "review");
  assert.equal(Number(b.purchases[0].held_slots), 0);
  assert.equal(a.history.length, 1);
  assert.ok(!JSON.stringify(a).includes("legacy_evidence"));
});
test("public participant list is empty until opt-in alias; withdrawal removes it", async () => {
  assert.equal(
    (await f.run("a", (db) => publicBreaks(db, "sample", sampleBreakId)))[0]
      .participants.length,
    0,
  );
  await assert.rejects(
    f.run("a", (db, a) =>
      participantConsent(
        db,
        a,
        sampleBreakId,
        "buyer@example.com",
        true,
        "sample",
      ),
    ),
    fail(400),
  );
  await f.run("a", (db, a) =>
    participantConsent(db, a, sampleBreakId, "Card Friend", true, "sample"),
  );
  const p = (
    await f.run("b", (db) => publicBreaks(db, "sample", sampleBreakId))
  )[0].participants;
  assert.deepEqual(p, [
    { display_name: "Card Friend", spot_key: "SAMPLE North spot", quantity: 1 },
  ]);
  assert.ok(!JSON.stringify(p).includes(previewId(1)));
  await f.run("a", (db, a) =>
    participantConsent(db, a, sampleBreakId, "Card Friend", false, "sample"),
  );
});
test("refund retains capacity; stale paid replay ignored; staff release requires reason and recheck", async () => {
  const refund = {
    ...o,
    updatedAt: new Date(Date.parse(o.updatedAt) + 60000).toISOString(),
    financialStatus: "REFUNDED",
    lines: o.lines.map((l) => ({
      ...l,
      currentQuantity: 0,
      refundedQuantity: 1,
      refundedCents: 2500,
    })),
  };
  await worker((db) => reconcileBreakOrder(db, refund, "sample"));
  assert.equal(
    (await worker((db) => reconcileBreakOrder(db, o, "sample"))).state,
    "stale_ignored",
  );
  const p = (await f.run("a", myBreaks)).purchases[0];
  assert.equal(p.status, "refunded");
  assert.equal(Number(p.held_slots), 1);
  await f.run("staff", (db, a) =>
    reviewPurchase(
      db,
      a,
      p.id as string,
      "release",
      1,
      "Confirmed refund and separate Shopify inventory reconciliation",
    ),
  );
  assert.equal(Number((await f.run("a", myBreaks)).purchases[0].held_slots), 0);
  assert.equal((await current()).sale_open, false);
  await worker((db) => reconcileBreakOrder(db, refund, "sample"));
  assert.equal(Number((await f.run("a", myBreaks)).purchases[0].held_slots), 0);
});
test("legacy evidence is separate, idempotent and occupies capacity without Shopify or loyalty revenue", async () => {
  const m = (
    await f.db.query<BreakMapping>(
      "select * from ns.shopify_spot_mappings where variant_id='gid://shopify/ProductVariant/7002'",
    )
  ).rows[0];
  const input = {
    mapping_id: m.id,
    customer_id: previewId(1),
    reference: "External-receipt-1",
    evidence: "SAMPLE independent receipt proof",
    quantity: 1,
    amount_cents: 2500,
    paid_at: new Date().toISOString(),
  };
  const p = await f.run("staff", (db, a) =>
    legacyPurchase(db, a, input, "SAMPLE verified external purchase"),
  );
  assert.equal(
    (await f.run("staff", (db, a) => legacyPurchase(db, a, input, "duplicate")))
      .id,
    p.id,
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      legacyPurchase(db, a, { ...input, reference: "other" }, "conflict"),
    ),
    fail(409),
  );
  assert.equal(
    (
      await f.db.query<{ n: number }>(
        "select count(*)::int n from ns.order_ledger",
      )
    ).rows[0].n,
    0,
  );
  const mine = await f.run("a", myBreaks);
  assert.equal(
    mine.purchases.find((p) => p.source === "legacy")?.status,
    "confirmed",
  );
  assert.ok(!JSON.stringify(mine).includes("independent receipt proof"));
  await f.run("staff", (db, a) =>
    reviewPurchase(db, a, p.id, "void-legacy", 1, "External refund evidenced"),
  );
  const e = await current();
  await f.run("staff", (db, a) =>
    saveBreak(
      db,
      a,
      { ...e, status: "live" },
      e.id,
      e.version,
      "Staff confirmed actual sample live status",
      "sample",
    ),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      reviewPurchase(db, a, p.id, "release", 1, "too late"),
    ),
    fail(409),
  );
});
test("unknown variant and unpaid checkout never allocate; anonymous paid needs review", async () => {
  const unknown = sampleOrder(5, "gid://shopify/ProductVariant/7999");
  assert.equal(
    (await worker((db) => reconcileBreakOrder(db, unknown, "sample"))).state,
    "review",
  );
  const unpaid = {
    ...sampleOrder(6),
    paidAt: null,
    financialStatus: "PENDING",
  };
  await worker((db) => reconcileBreakOrder(db, unpaid, "sample"));
  assert.equal(
    (
      await f.db.query(
        "select id from ns.break_purchases where source_order=$1",
        [unpaid.id],
      )
    ).rows.length,
    0,
  );
  const anonymous = { ...sampleOrder(7), customerId: null };
  assert.equal(
    (await worker((db) => reconcileBreakOrder(db, anonymous, "sample"))).state,
    "review",
  );
});
test("canceled schedule remains visible in own reminders; no restart or new reminder", async () => {
  const e = await current();
  await f.run("staff", (db, a) =>
    saveBreak(
      db,
      a,
      { ...e, status: "canceled", published: false },
      e.id,
      e.version,
      "SAMPLE canceled event",
      "sample",
    ),
  );
  const mine = await f.run("a", myBreaks);
  assert.equal(mine.reminders[0].status, "canceled");
  assert.ok(mine.purchases.length);
  assert.equal(
    (await f.run("a", (db) => publicBreaks(db, "sample", e.id))).length,
    0,
  );
  const latest = await current();
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveBreak(
        db,
        a,
        { ...latest, status: "scheduled" },
        e.id,
        latest.version,
        "restart",
        "sample",
      ),
    ),
    fail(409),
  );
});
test("durable jobs deduplicate, reject stale leases, back off and can complete", async () => {
  await worker(async (db) => {
    await enqueueBreakOrder(db, o.id, "one");
    await enqueueBreakOrder(db, o.id, "one");
  });
  const j = await worker(claimBreakJob);
  assert.ok(j);
  assert.equal(
    await worker((db) =>
      validBreakJob(db, { ...j, lease_token: randomUUID() }),
    ),
    false,
  );
  await worker((db) => failBreakJob(db, j));
  assert.equal(await worker(claimBreakJob), undefined);
  await f.db.query("update ns.break_jobs set available_at=now()");
  const retry = await worker(claimBreakJob);
  assert.ok(retry);
  assert.equal(await worker((db) => validBreakJob(db, j)), false);
  await worker((db) => finishBreakJob(db, retry, "reconciled"));
  assert.equal(await worker(claimBreakJob), undefined);
});
test("generic cart cannot bypass break login and live verification gates; unrelated retail passes", async () => {
  await worker((db) =>
    validateBreakCart(
      db,
      [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
      false,
    ),
  );
  await assert.rejects(
    worker((db) =>
      validateBreakCart(
        db,
        [{ variantId: "gid://shopify/ProductVariant/7001", quantity: 1 }],
        false,
      ),
    ),
    fail(401),
  );
  await assert.rejects(
    worker((db) =>
      validateBreakCart(
        db,
        [{ variantId: "gid://shopify/ProductVariant/7001", quantity: 1 }],
        true,
      ),
    ),
    fail(503),
  );
});

test("pooled capacity and partial refund hold only the verified quantity; cancellation before paid never allocates", async () => {
  const event = await current(),
    id = randomUUID();
  const e = await f.run("staff", (db, a) =>
    saveBreak(
      db,
      a,
      {
        ...event,
        status: "scheduled",
        published: true,
        format: "identical",
        capacity: 3,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
      },
      id,
      null,
      "SAMPLE pooled test",
      "sample",
    ),
  );
  const m = await f.run("staff", (db, a) =>
    addMapping(
      db,
      a,
      e.id,
      {
        variant_id: "gid://shopify/ProductVariant/7100",
        product_id: "gid://shopify/Product/7001",
        sku: "SAMPLE-POOL",
        spot_key: "Identical sample spot",
        capacity: 3,
      },
      "SAMPLE finite mapping",
    ),
  );
  const order = {
    ...sampleOrder(20, m.variant_id),
    customerId: "gid://shopify/Customer/1",
  };
  order.lines = order.lines.map((l) => ({
    ...l,
    quantity: 2,
    currentQuantity: 2,
    originalNetCents: 5000,
  }));
  assert.equal(
    (await worker((db) => reconcileBreakOrder(db, order, "sample"))).state,
    "reconciled",
  );
  const competing = {
    ...sampleOrder(21, m.variant_id),
    customerId: "gid://shopify/Customer/2",
    lines: order.lines.map((l) => ({ ...l, id: "gid://shopify/LineItem/21" })),
  };
  assert.equal(
    (await worker((db) => reconcileBreakOrder(db, competing, "sample"))).state,
    "review",
  );
  const refund = {
    ...order,
    updatedAt: new Date(Date.parse(order.updatedAt) + 60000).toISOString(),
    financialStatus: "PARTIALLY_REFUNDED",
    lines: order.lines.map((l) => ({
      ...l,
      currentQuantity: 1,
      refundedQuantity: 1,
      refundedCents: 2500,
    })),
  };
  await worker((db) => reconcileBreakOrder(db, refund, "sample"));
  const p = (await f.run("a", myBreaks)).purchases.find(
    (p) => p.event_id === e.id,
  )!;
  assert.equal(p.status, "partially_refunded");
  assert.equal(Number(p.held_slots), 2);
  assert.equal(p.current_quantity, 1);
  await assert.rejects(
    f.run("staff", (db, a) =>
      reviewPurchase(db, a, String(p.id), "release", 2, "too many"),
    ),
    fail(400),
  );
  await f.run("staff", (db, a) =>
    reviewPurchase(
      db,
      a,
      String(p.id),
      "release",
      1,
      "Verified one refunded unit and inventory reconciliation",
    ),
  );
  const canceled = {
    ...sampleOrder(22, m.variant_id),
    customerId: "gid://shopify/Customer/1",
    cancelled: true,
  };
  await worker((db) => reconcileBreakOrder(db, canceled, "sample"));
  assert.equal(
    (
      await f.db.query<{ n: number }>(
        "select count(*)::int n from ns.break_allocations where mapping_id=$1 and active",
        [m.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await f.db.query<{ status: string }>(
        "select status from ns.break_purchases where source_order=$1",
        [canceled.id],
      )
    ).rows[0].status,
    "canceled",
  );
  const removed = {
    ...refund,
    updatedAt: new Date(Date.parse(refund.updatedAt) + 60000).toISOString(),
    lines: [],
  };
  assert.equal(
    (await worker((db) => reconcileBreakOrder(db, removed, "sample"))).state,
    "review",
  );
  assert.equal(
    (
      await f.db.query<{ status: string }>(
        "select status from ns.break_purchases where id=$1",
        [p.id],
      )
    ).rows[0].status,
    "review",
  );
});
test("own reminders can be turned off after unpublication; direct tenant and ownership boundaries hold", async () => {
  await f.run("a", (db, a) =>
    participantConsent(db, a, sampleBreakId, "Card Friend", false, "sample"),
  );
  await f.run("a", (db, a) =>
    saveReminder(db, a, sampleBreakId, 15, false, "sample"),
  );
  assert.equal((await f.run("a", myBreaks)).reminders[0].active, false);
  const tenant = previewId(7900),
    event = previewId(7901);
  await f.db.query(
    "insert into ns.tenants(id,slug,shop,is_test) values($1,'break-other','break-other.myshopify.com',true)",
    [tenant],
  );
  await f.db.query(
    "insert into ns.break_events(tenant_id,id,title,published,fixture) values($1,$2,'PRIVATE OTHER TENANT',true,true)",
    [tenant, event],
  );
  for (const who of ["a", "b", "staff", "editor"])
    await f.run(who, async (db) =>
      assert.equal(
        (
          await db.query("select * from ns.break_events where tenant_id=$1", [
            tenant,
          ])
        ).rows.length,
        0,
      ),
    );
  await worker(async (db) =>
    assert.equal(
      (
        await db.query("select * from ns.break_events where tenant_id=$1", [
          tenant,
        ])
      ).rows.length,
      0,
    ),
  );
  await assert.rejects(
    worker((db) => db.query("select * from ns.sessions")),
    /permission denied/,
  );
  await f.run("b", async (db) =>
    assert.equal(
      (
        await db.query(
          "select * from ns.break_purchases where customer_id=$1",
          [previewId(1)],
        )
      ).rows.length,
      0,
    ),
  );
  const m = await mapping();
  await assert.rejects(
    f.db.query("update ns.shopify_spot_mappings set capacity=9 where id=$1", [
      m.id,
    ]),
    /immutable/,
  );
  const p = (
    await f.db.query<{ id: string }>(
      "select id from ns.break_purchases where source_order=$1",
      [o.id],
    )
  ).rows[0];
  await assert.rejects(
    f.db.query("update ns.break_purchases set customer_id=$2 where id=$1", [
      p.id,
      previewId(2),
    ]),
    /owner cannot change/,
  );
  await assert.rejects(
    f.db.query(
      "insert into ns.break_allocations(tenant_id,event_id,mapping_id,purchase_id,customer_id,slot) values($1,$2,$3,$4,$5,2)",
      [TENANT, m.event_id, m.id, p.id, previewId(1)],
    ),
    /exceeds mapped capacity/,
  );
});
test("crashed job can be reclaimed while expired lease and old completion cannot win", async () => {
  await worker((db) => enqueueBreakOrder(db, o.id, "crash"));
  const old = await worker(claimBreakJob);
  assert.ok(old);
  await f.db.query(
    "update ns.break_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [old.id],
  );
  const fresh = await worker(claimBreakJob);
  assert.ok(fresh);
  assert.notEqual(fresh.lease_token, old.lease_token);
  assert.equal(await worker((db) => validBreakJob(db, old)), false);
  await worker((db) => finishBreakJob(db, old, "reconciled"));
  assert.equal(await worker((db) => validBreakJob(db, fresh)), true);
  await worker((db) => finishBreakJob(db, fresh, "reconciled"));
});
let closed = false;
test("saved schedules, reminders, purchases and holds survive database close/reopen", async () => {
  const before = (
    await f.db.query<{ n: number }>(
      "select count(*)::int n from ns.break_purchases",
    )
  ).rows[0].n;
  await f.db.close();
  closed = true;
  const again = await openPreviewDatabase(dir);
  try {
    await initializeBreakPreview(again);
    assert.equal(
      (
        await again.db.query<{ n: number }>(
          "select count(*)::int n from ns.break_purchases",
        )
      ).rows[0].n,
      before,
    );
    assert.equal((await again.run("a", myBreaks)).reminders[0].active, false);
    assert.ok((await again.run("a", myBreaks)).purchases.length);
  } finally {
    await again.db.close();
  }
});
test.after(async () => {
  if (!closed) await f.db.close();
  await rm(dir, { recursive: true, force: true });
});
