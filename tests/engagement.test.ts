import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  initializeEngagementPreview,
  engagementSampleRun,
  sampleShowRef,
  sampleShowId,
  sampleVendorShowId,
} from "../lib/server/engagement-preview";
import { TENANT } from "../lib/server/providers";
import {
  inbox,
  preferences,
  runNotifications,
  claimNotice,
  deliverNotice,
  validateSubscription,
  protectContact,
} from "../lib/server/notifications";
import {
  analyticsConsent,
  visitor,
  observeTouch,
  linkVisitor,
  customerMetric,
  metric,
  metrics,
  metricCsv,
  savePlacement,
  approvedPlacement,
  saveShow,
} from "../lib/server/measurement";
import {
  reconcileMeasurement,
  fetchMeasuredOrder,
  runMeasurements,
} from "../lib/server/measurement-worker";
import { saveReminder } from "../lib/server/breaks";
import { sampleBreakId } from "../lib/server/break-preview";
import { gradingDetail } from "../lib/server/grading";
import { hashToken, opaqueToken } from "../lib/server/security";
import type { Query } from "../lib/server/storefront";
import { installGuidance, pushCapability } from "../lib/pwa";
const dir = await mkdtemp(join(tmpdir(), "northside-engagement-")),
  f = await openPreviewDatabase(dir);
await initializeEngagementPreview(f);
const worker = <T>(fn: Parameters<typeof engagementSampleRun<T>>[1]) =>
  engagementSampleRun(f, fn);
const raw = (q: string, p: unknown[] = []) =>
  f.db.query<Record<string, unknown>>(q, p);
const sampleNotice = () =>
  raw(
    "insert into ns.grading_events(tenant_id,card_id,case_id,label,source) select tenant_id,card_id,case_id,'SAMPLE status notification','northside' from ns.grading_cards where tenant_id=$1 and case_id in(select case_id from ns.grading_intakes where customer_id=$2) limit 1",
    [TENANT, previewId(1)],
  );
const token = opaqueToken();
test("transactional status notifications expose only the owning collector and generic fields", async () => {
  const a = await f.run("a", inbox),
    b = await f.run("b", inbox);
  assert.equal(a.notifications.length, 1);
  assert.equal(b.notifications.length, 0);
  assert.deepEqual(Object.keys(a.notifications[0]).sort(), [
    "due_at",
    "id",
    "kind",
    "read_at",
  ]);
  assert.equal(
    (await f.run("a", (db) => db.query("select * from ns.notification_jobs")))
      .rows.length,
    0,
  );
});
test("worker is durable, repeat-safe and explicitly UNSENT without providers", async () => {
  const one = await runNotifications(25, worker, true);
  assert.equal(one.processed, 2);
  assert.equal((await runNotifications(25, worker, true)).processed, 0);
  assert.equal(
    (await raw("select * from ns.notification_attempts where outcome='unsent'"))
      .rows.length,
    2,
  );
});
test("opt-out cancels queued and claimed work; a stale lease cannot send", async () => {
  await sampleNotice();
  const j = await worker(claimNotice);
  assert.ok(j);
  await f.run("a", (db, a) =>
    preferences(
      db,
      a,
      { kind: "grading", in_app: true, email: false, push: false },
      undefined,
      true,
    ),
  );
  const row = (
    await raw(
      "select state,lease_token from ns.notification_jobs where id=$1",
      [j.id],
    )
  ).rows[0];
  assert.equal(row.state, "cancelled");
  assert.equal(row.lease_token, null);
  assert.equal((await runNotifications(25, worker, true)).processed, 0);
});
test("changed break times replace pending reminders, repeat saves deduplicate, cancellation removes them", async () => {
  await f.run("a", (db, a) =>
    saveReminder(db, a, sampleBreakId, 15, true, "sample"),
  );
  const initial = (
    await raw(
      "select * from ns.notifications where kind='break' and not cancelled",
    )
  ).rows[0];
  assert.ok(initial);
  await f.run("a", (db, a) =>
    saveReminder(db, a, sampleBreakId, 15, true, "sample"),
  );
  assert.equal(
    (
      await raw(
        "select * from ns.notifications where kind='break' and not cancelled",
      )
    ).rows.length,
    1,
  );
  await raw(
    "update ns.break_events set starts_at=starts_at+interval '1 hour',version=version+1 where id=$1",
    [sampleBreakId],
  );
  const next = (
    await raw(
      "select * from ns.notifications where kind='break' and not cancelled",
    )
  ).rows[0];
  assert.notEqual(next.id, initial.id);
  assert.equal(
    new Date(String(next.due_at)).getTime() -
      new Date(String(initial.due_at)).getTime(),
    3600000,
  );
  assert.equal(
    (
      await raw(
        "select j.* from ns.notification_jobs j join ns.notifications n on n.id=j.notification_id where n.id=$1 and j.state<>'cancelled'",
        [initial.id],
      )
    ).rows.length,
    0,
  );
  await raw(
    "update ns.break_events set status='canceled',version=version+1 where id=$1",
    [sampleBreakId],
  );
  assert.equal(
    (
      await raw(
        "select * from ns.notifications where kind='break' and not cancelled",
      )
    ).rows.length,
    0,
  );
});
test("network failures retry after persisted backoff and stop at the attempt limit", async () => {
  await f.run("a", (db, a) =>
    preferences(
      db,
      a,
      { kind: "grading", in_app: true, email: true, push: false },
      undefined,
      true,
    ),
  );
  await sampleNotice();
  await runNotifications(1, worker, true, async () => ({
    state: "pending",
    code: "network_failure",
  }));
  const j = (
    await raw(
      "select * from ns.notification_jobs where state='pending' and last_error='network_failure'",
    )
  ).rows[0];
  assert.ok(j);
  assert.ok(new Date(String(j.available_at)).getTime() > Date.now());
  await raw(
    "update ns.notification_jobs set attempts=7,available_at=now()-interval '1 second' where id=$1",
    [j.id],
  );
  await runNotifications(1, worker, true, async () => ({
    state: "pending",
    code: "network_failure",
  }));
  assert.equal(
    (await raw("select state from ns.notification_jobs where id=$1", [j.id]))
      .rows[0].state,
    "failed",
  );
});
test("push subscription endpoint allowlist prevents private-network and arbitrary callbacks", () => {
  const s = {
    endpoint: "https://fcm.googleapis.com/fcm/send/sample",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  };
  assert.equal(validateSubscription(s).endpoint, s.endpoint);
  for (const endpoint of [
    "http://127.0.0.1/",
    "https://evil.example/",
    "https://fcm.googleapis.com.evil.example/",
    "https://user:secret@fcm.googleapis.com/send",
    "https://web.push.apple.com:444/",
  ])
    assert.throws(() => validateSubscription({ ...s, endpoint }));
});
test("permission denied and unavailable browsers retain truthful install and in-app guidance", () => {
  assert.match(pushCapability("denied", true), /denied/);
  assert.match(pushCapability("default", false), /unavailable/);
  assert.match(
    installGuidance({
      standalone: false,
      prompt: false,
      ios: false,
      secure: true,
    }),
    /has not supplied/,
  );
  assert.match(
    installGuidance({
      standalone: false,
      prompt: false,
      ios: true,
      secure: true,
    }),
    /Safari/,
  );
  assert.match(
    installGuidance({
      standalone: true,
      prompt: false,
      ios: false,
      secure: true,
    }),
    /standalone/,
  );
});
test("consent is required for observed touches and first/latest timestamps, withdrawal removes the link", async () => {
  assert.equal(
    await worker((db) => observeTouch(db, token, sampleShowRef, true)),
    false,
  );
  await worker((db) => analyticsConsent(db, token, true, sampleShowRef, true));
  const first = await worker((db) => visitor(db, token));
  assert.equal(first?.first_ref, sampleShowRef);
  assert.ok(first?.first_at);
  await worker((db) =>
    observeTouch(db, token, "SAMPLE_hobby_key_vendor_desk_01", true),
  );
  const latest = await worker((db) => visitor(db, token));
  assert.equal(latest?.first_ref, sampleShowRef);
  assert.equal(latest?.latest_ref, "SAMPLE_hobby_key_vendor_desk_01");
  assert.equal(
    await worker((db) =>
      observeTouch(db, token, "forged_ref_which_is_not_approved", true),
    ),
    false,
  );
  await worker((db) => analyticsConsent(db, token, false, null, true));
  assert.equal(await worker((db) => visitor(db, token)), null);
  assert.equal(
    (
      await raw("select * from ns.campaign_touches where token_hash=$1", [
        hashToken(token),
      ])
    ).rows.length,
    0,
  );
});
test("landing is not activation; verified useful actions deduplicate and customer B cannot open A grading", async () => {
  await worker((db) => analyticsConsent(db, token, true, sampleShowRef, true));
  const a = await f.run("a", async (_, a) => a);
  await worker((db) => linkVisitor(db, token, a, true));
  await worker(async (db) =>
    metric(
      db,
      await visitor(db, token),
      "landing_view",
      hashToken(token) + "/" + randomUUID(),
      true,
    ),
  );
  assert.equal(
    (
      await raw(
        "select * from ns.measurement_events where event='meaningful_activation'",
      )
    ).rows.length,
    0,
  );
  const card = (
    await raw(
      "select card_id from ns.grading_cards where case_id in(select case_id from ns.grading_intakes where customer_id=$1) limit 1",
      [previewId(1)],
    )
  ).rows[0].card_id as string;
  await assert.rejects(f.run("b", (db, a) => gradingDetail(db, a, card)));
  await f.run("a", (db, a) => gradingDetail(db, a, card));
  assert.equal(
    (
      await raw(
        "select * from ns.measurement_events where event='grading_status_view'",
      )
    ).rows.length,
    0,
    "Another signed-in browser does not inherit analytics consent",
  );
  await f.run("a", async (db, a) => {
    await db.query("select set_config('ns.measurement_hash',$1,true)", [
      hashToken(token),
    ]);
    return gradingDetail(db, a, card);
  });
  await f.run("a", async (db, a) => {
    await db.query("select set_config('ns.measurement_hash',$1,true)", [
      hashToken(token),
    ]);
    return gradingDetail(db, a, card);
  });
  assert.equal(
    (
      await raw(
        "select * from ns.measurement_events where event='grading_status_view'",
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await raw(
        "select * from ns.measurement_events where event='meaningful_activation'",
      )
    ).rows.length,
    1,
  );
  await worker((db) => analyticsConsent(db, token, false, null, true));
  await f.run("a", (db, a) =>
    customerMetric(db, a, "saved_break_reminder", "new-event"),
  );
  assert.equal(
    (
      await raw(
        "select * from ns.measurement_events where event='saved_break_reminder'",
      )
    ).rows.length,
    0,
  );
});
test("paid order replay stays one purchase, stale snapshots cannot overwrite refunds, unattributed orders are retained", async () => {
  const o = {
    id: "SAMPLE-dedupe-order",
    paidAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    gross: 5000,
    refund: 0,
    channel: "online" as const,
    first: sampleShowRef,
    latest: sampleShowRef,
  };
  await worker((db) => reconcileMeasurement(db, o, true));
  await worker((db) => reconcileMeasurement(db, o, true));
  const newer = {
    ...o,
    updatedAt: new Date(Date.now() + 5000).toISOString(),
    refund: 2000,
  };
  await worker((db) => reconcileMeasurement(db, newer, true));
  await worker((db) => reconcileMeasurement(db, o, true));
  assert.equal(
    (
      await raw(
        "select * from ns.measurement_events where event='verified_purchase' and source_key=$1",
        [hashToken(o.id)],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    Number(
      (
        await raw(
          "select refund_cents from ns.measured_orders where order_id=$1",
          [o.id],
        )
      ).rows[0].refund_cents,
    ),
    2000,
  );
  assert.ok(
    (await raw("select * from ns.measured_orders where first_ref is null")).rows
      .length,
  );
});
test("staff CSV includes filters, definitions, unmatched orders and refunds without private payloads; content editor cannot read metrics", async () => {
  const ftr = { start: "2026-09-01", end: "2026-10-01" };
  const m = await f.run("reader", (db, a) => metrics(db, a, ftr));
  const csv = metricCsv(m);
  for (const s of [
    "tenant",
    "start_utc",
    "definition",
    "refund_adjustment",
    "unattributed",
    "external_legacy",
    "Excluded from retail",
  ])
    assert.ok(csv.includes(s));
  for (const s of [
    "customer_id",
    "card_id",
    "case_id",
    "contact_sealed",
    "subscription_sealed",
    "SAMPLE-dedupe-order",
  ])
    assert.ok(!csv.includes(s));
  await assert.rejects(f.run("editor", (db, a) => metrics(db, a, ftr)));
});
test("stable QR can change destination without altering placement attribution; lowercase unique labels required", async () => {
  const p = (
    await raw("select * from ns.show_placements where ref=$1", [sampleShowRef])
  ).rows[0];
  await f.run("staff", (db, a) =>
    savePlacement(db, a, { ...p, event_id: sampleVendorShowId }),
  );
  assert.equal(
    (await worker((db) => approvedPlacement(db, sampleShowRef, true)))
      ?.event_id,
    sampleVendorShowId,
  );
  await f.run("staff", (db, a) =>
    savePlacement(db, a, { ...p, event_id: sampleShowId }),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      savePlacement(db, a, { ...p, ref: undefined, utm_content: "UPPERCASE" }),
    ),
  );
  await assert.rejects(
    f.run("reader", (db, a) => saveShow(db, a, { id: sampleShowId }, true)),
  );
});
test("engagement worker cannot read sessions, grading cards, consignment amounts or loyalty balances", async () => {
  for (const table of [
    "sessions",
    "grading_cards",
    "consignment_items",
    "points_ledger",
  ])
    await assert.rejects(worker((db) => db.query("select * from ns." + table)));
});
test("verified purchase reader rejects test orders, incomplete payments and malformed money", async () => {
  const base = {
    id: "gid://shopify/Order/98765",
    updatedAt: new Date().toISOString(),
    sourceName: "web",
    test: false,
    displayFinancialStatus: "PAID",
    totalReceivedSet: { shopMoney: { amount: "25.00", currencyCode: "USD" } },
    totalRefundedSet: { shopMoney: { amount: "5.00", currencyCode: "USD" } },
    transactions: [
      {
        kind: "SALE",
        status: "SUCCESS",
        processedAt: new Date().toISOString(),
      },
    ],
    customAttributes: [],
  };
  const query = (o: unknown) => (async () => ({ order: o })) as Query;
  const o = await fetchMeasuredOrder(query(base), base.id);
  assert.equal(o?.gross, 2500);
  assert.equal(o?.refund, 500);
  assert.equal(o?.first, null);
  assert.equal(
    await fetchMeasuredOrder(
      query({ ...base, displayFinancialStatus: "PENDING" }),
      base.id,
    ),
    null,
  );
  await assert.rejects(
    fetchMeasuredOrder(query({ ...base, test: true }), base.id),
  );
  await assert.rejects(
    fetchMeasuredOrder(query({ ...base, transactions: [] }), base.id),
  );
});
test("measurement job retry and receipt replay do not create a second order", async () => {
  const id = "gid://shopify/Order/98766",
    at = new Date().toISOString(),
    query = (async () => ({
      order: {
        id,
        updatedAt: at,
        sourceName: "web",
        test: false,
        displayFinancialStatus: "PAID",
        totalReceivedSet: {
          shopMoney: { amount: "10.00", currencyCode: "USD" },
        },
        totalRefundedSet: {
          shopMoney: { amount: "0.00", currencyCode: "USD" },
        },
        transactions: [{ kind: "SALE", status: "SUCCESS", processedAt: at }],
        customAttributes: [],
      },
    })) as Query;
  await worker((db) =>
    db.query(
      "insert into ns.measurement_jobs(tenant_id,order_id) values($1,$2)",
      [TENANT, id],
    ),
  );
  assert.equal(
    (await runMeasurements(1, worker, async () => query)).processed,
    1,
  );
  assert.equal(
    (await runMeasurements(1, worker, async () => query)).processed,
    0,
  );
  assert.equal(
    (await raw("select * from ns.measured_orders where order_id=$1", [id])).rows
      .length,
    1,
  );
});
test("provider adapter uses generic payload and stable idempotency; uncertain old delivery needs manual review", async () => {
  const old = { ...process.env };
  Object.assign(process.env, {
    NOTIFICATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    NOTIFICATION_DELIVERY_ENABLED: "true",
    NORTHSIDE_FIXTURES: "0",
    APP_ORIGIN: "https://northside.example",
    RESEND_API_KEY: "SAMPLE",
    NOTIFICATION_EMAIL_FROM: "sample@example.invalid",
  }); // Mock transport only; never contacts a provider.
  try {
    const job = {
        id: randomUUID(),
        lease_token: randomUUID(),
        channel: "email" as const,
        attempts: 1,
        first_attempt_at: new Date().toISOString(),
      },
      d = {
        customer_id: previewId(1),
        cancelled: false,
        allowed: true,
        email_sealed: protectContact(
          "sample@example.invalid",
          `${TENANT}/${previewId(1)}/email`,
        ),
        subscription_sealed: null,
        subscription_id: null,
        active: null,
      };
    let calls = 0;
    const send = (async (_, init) => {
      calls++;
      assert.equal(
        (init?.headers as Record<string, string>)["Idempotency-Key"],
        "northside-notice-" + job.id,
      );
      const body = JSON.parse(String(init?.body));
      assert.match(body.text, /account\/notifications/);
      assert.ok(!body.text.includes(previewId(1)));
      return Response.json({ id: "provider-mock-id" });
    }) as typeof fetch;
    const r = await deliverNotice(job, d, false, send);
    assert.equal(r.state, "accepted");
    assert.equal(calls, 1);
    assert.equal(
      (
        await deliverNotice(
          {
            ...job,
            first_attempt_at: new Date(Date.now() - 25 * 3600000).toISOString(),
          },
          d,
          false,
          send,
        )
      ).state,
      "failed",
    );
    assert.equal(calls, 1);
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
});
test.after(async () => {
  await f.db.close();
  await rm(dir, { recursive: true, force: true });
});
