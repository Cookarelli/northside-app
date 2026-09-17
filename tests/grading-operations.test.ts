import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  createIntake,
  gradingCards,
  gradingCard,
  updateGradingCard,
} from "../lib/server/grading";
import { batch } from "../lib/server/grading-operations";
import {
  operationsAction,
  batchWorkspace,
  manifestCsv,
  operationsOverview,
  operationsCard,
} from "../lib/server/grading-fulfillment";
import {
  statusImportPreview,
  commitStatusImport,
  readStatusImport,
} from "../lib/server/grading-status-import";
import {
  approveForTest,
  sampleQuote,
  sampleService,
} from "./support/grading-exam-fixture";
import { localPhotoStore, photoHash } from "../lib/server/exam-storage";
import {
  prepareExamPhoto,
  completeExamPhoto,
  authorizedExamPhoto,
  examWorkspace,
  saveExamDraft,
  publishExam,
} from "../lib/server/exam";
import {
  portalData,
  portalDetail,
  portalExport,
  recordPortalDecision,
  saveQuote,
} from "../lib/server/grading-portal";
import { decisionSelection } from "../lib/grading-portal";
import {
  gradingLabel,
  parseGradingLabel,
  statusImportFields,
} from "../lib/grading-fulfillment";
import {
  inbox,
  preferences,
  runNotifications,
} from "../lib/server/notifications";
import { engagementSampleRun } from "../lib/server/engagement-preview";
import { AccessError } from "../lib/server/security";
import { TENANT } from "../lib/server/providers";
const directory = await mkdtemp("/private/tmp/northside-grading-ops-");
let f = await openPreviewDatabase(join(directory, "db"));
const run = <T>(who: string, fn: Parameters<typeof f.run<T>>[1]) =>
  f.run(who, fn);
const store = localPhotoStore(join(directory, "photos"));
const reason = "SAMPLE observed physical card and verified evidence";
const raw = await sharp({
  create: { width: 90, height: 120, channels: 3, background: "#e1edf5" },
})
  .png()
  .toBuffer();
async function intake(who: number, n: number) {
  const r = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      {
        customer_id: previewId(who),
        description: "SAMPLE staff custody " + who,
        quantity: n,
        sport: "",
        year: "",
        manufacturer: "",
        card_set: "",
        card_number: "",
        parallel: "",
      },
      randomUUID(),
      reason,
    ),
  );
  return (await run("staff", gradingCards))
    .filter((c) => c.case_id === r.case_id)
    .map((c) => c.card_id)
    .sort();
}
const ids = await intake(1, 3),
  other = (await intake(2, 1))[0];
await approveForTest(f, [ids[0], ids[1]], "a", store);
await approveForTest(f, [other], "b", store);
const bid = (
  await run("staff", (db, a) =>
    batch(db, a, {
      operation: "create",
      provider: "psa",
      service: sampleService,
      reference: "SAMPLE mixed collector outbound",
      carrier: "SAMPLE carrier",
      tracking: "SAMPLE-TRACK",
      reason,
    }),
  )
).id!;
const state = () => run("staff", (db, a) => batchWorkspace(db, a, bid));
const card = (id: string) => run("staff", (db, a) => gradingCard(db, a, id));
const operation = (b: Record<string, unknown>, who = "staff") =>
  run(who, (db, a) => operationsAction(db, a, b, store));
const body = (b: Record<string, unknown>): Record<string, unknown> => ({
  request_id: randomUUID(),
  reason,
  ...b,
});
const denied = (e: unknown) =>
  e instanceof AccessError && [400, 403, 404, 409, 503].includes(e.status);
async function scan(id: string) {
  const w = await state();
  return operation(
    body({
      action: "scan_batch",
      batch_id: bid,
      batch_version: w.batch.version,
      code: gradingLabel(id),
      method: "manual",
    }),
  );
}
async function milestone(ids: string[], status: string) {
  return operation(
    body({
      action: "milestone",
      cards: await Promise.all(
        ids.map(async (id) => ({
          card_id: id,
          version: (await card(id)).version,
        })),
      ),
      status_key: status,
    }),
  );
}
async function dispatchBody() {
  const w = await state();
  return body({
    action: "dispatch",
    batch_id: bid,
    batch_version: w.batch.version,
    cards: w.cards.map((c) => ({ card_id: c.card_id, version: c.version })),
    confirmed: true,
  });
}
async function returnPhoto(id: string, kind: string) {
  const p = await run("staff", (db, a) =>
    prepareExamPhoto(db, a, id, {
      kind,
      source_hash: photoHash(raw),
      request_id: randomUUID(),
    }),
  );
  await run("staff", (db, a) =>
    completeExamPhoto(db, a, id, p.id, raw, "image/png", store),
  );
  return p.id;
}
let dispatched: Record<string, unknown>,
  released: Record<string, unknown>,
  returnFront = "";
test("card label parsing accepts exact identity and rejects product/foreign URLs", () => {
  assert.equal(parseGradingLabel(gradingLabel(ids[0])), ids[0]);
  assert.throws(() => parseGradingLabel("https://outside.test/" + ids[0]));
  assert.throws(() => parseGradingLabel("0001234567890"));
});
test("staff role and tenant-scoped manifest access fail closed", async () => {
  await assert.rejects(
    operation(body({ action: "scan_card", code: ids[0] }), "a"),
    denied,
  );
  await assert.rejects(
    operation(
      body({
        action: "scan_batch",
        batch_id: bid,
        batch_version: 1,
        code: ids[0],
        method: "camera",
      }),
      "reader",
    ),
    denied,
  );
  await assert.rejects(
    run("b", (db, a) => manifestCsv(db, a, bid)),
    denied,
  );
  const rows = await run("a", (db) =>
    db.query("select * from ns.grading_manifest_cards"),
  );
  assert.equal(rows.rows.length, 0);
});
test("unapproved and held cards cannot stage; provider/service must match", async () => {
  await assert.rejects(scan(ids[2]), denied);
  const wrong = (
    await run("staff", (db, a) =>
      batch(db, a, {
        operation: "create",
        provider: "psa",
        service: "SAMPLE different service",
        reference: "SAMPLE incompatible",
        reason,
      }),
    )
  ).id;
  await assert.rejects(
    operation(
      body({
        action: "scan_batch",
        batch_id: wrong,
        batch_version: 1,
        code: ids[0],
        method: "camera",
      }),
    ),
    denied,
  );
  await milestone([ids[0]], "on_hold");
  await assert.rejects(scan(ids[0]), denied);
  await milestone([ids[0]], "ready_to_submit");
});
test("mixed collectors stage without changing ownership; scan retry deduplicates", async () => {
  const w = await state(),
    b = body({
      action: "scan_batch",
      batch_id: bid,
      batch_version: w.batch.version,
      code: ids[0],
      method: "scanner",
    });
  await operation(b);
  assert.equal((await operation(b)).duplicate, true);
  await assert.rejects(operation({ ...b, code: other }), denied);
  await scan(ids[1]);
  await scan(other);
  const saved = await state();
  assert.equal(saved.cards.length, 3);
  assert.equal(new Set(saved.cards.map((c) => c.customer_id)).size, 2);
  assert.equal(
    saved.cards.filter((c) => c.collector_id === previewId(1)).length,
    2,
  );
});
test("a card cannot join a second active outbound submission", async () => {
  const second = (
    await run("staff", (db, a) =>
      batch(db, a, {
        operation: "create",
        provider: "psa",
        service: sampleService,
        reference: "SAMPLE second",
        reason,
      }),
    )
  ).id;
  await assert.rejects(
    operation(
      body({
        action: "scan_batch",
        batch_id: second,
        batch_version: 1,
        code: ids[0],
        method: "manual",
      }),
    ),
    denied,
  );
  assert.equal((await card(ids[0])).batch_id, bid);
});
test("dispatch revalidates stale approval atomically and does not queue failed notifications", async () => {
  const current = (await run("a", portalData)).cards.find(
    (c) => c.card_id === ids[0],
  )!;
  await run("staff", (db, a) =>
    saveQuote(db, a, {
      ...sampleQuote,
      card_id: ids[0],
      request_id: randomUUID(),
      previous_id: current.quote!.id,
      shipping_cents: 700,
    }),
  );
  const notices = (await run("a", inbox)).notifications.length;
  await assert.rejects(operation(await dispatchBody()), denied);
  assert.equal((await state()).dispatch, null);
  assert.ok((await state()).cards.every((c) => c.custody === "northside"));
  assert.equal((await run("a", inbox)).notifications.length, notices);
  const latest = (await run("a", portalData)).cards.filter(
    (c) => c.card_id === ids[0],
  );
  await run("a", (db, a) =>
    recordPortalDecision(db, a, {
      choice: "submit",
      confirmed: true,
      request_id: randomUUID(),
      cards: decisionSelection(latest),
    }),
  );
});
test("dispatch rejects an incomplete manifest and requires explicit physical confirmation", async () => {
  const b = await dispatchBody();
  await assert.rejects(
    operation({ ...b, cards: (b.cards as unknown[]).slice(1) }),
    denied,
  );
  await assert.rejects(
    operation({ ...b, request_id: randomUUID(), confirmed: false }),
    denied,
  );
});
test("dispatch freezes exact approvals, original owners, service and card list; retry is stable", async () => {
  dispatched = await dispatchBody();
  await operation(dispatched);
  assert.equal((await operation(dispatched)).duplicate, true);
  const w = await state();
  assert.equal(w.batch.phase, "dispatched");
  assert.equal(w.manifest.length, 3);
  assert.equal(w.cards.filter((c) => c.custody === "grader").length, 3);
  for (const m of w.manifest) {
    assert.ok(m.quote_id && m.exam_revision_id && m.approval_request_id);
  }
  await assert.rejects(
    f.db.query("delete from ns.grading_manifest_cards where batch_id=$1", [
      bid,
    ]),
    /Append-only/i,
  );
});
test("later exam corrections retain the dispatched revision and do not falsify physical progress", async () => {
  const before = (await state()).manifest.find((c) => c.card_id === ids[0])!;
  const draft = (await run("staff", (db, a) => examWorkspace(db, a, ids[0])))
    .draft!;
  const saved = await run("staff", (db, a) =>
    saveExamDraft(db, a, ids[0], {
      version: draft.version,
      fields: { ...draft.fields, notes: "SAMPLE post-dispatch correction" },
      internal_notes: "PRIVATE correction remains private",
    }),
  );
  await run("staff", (db, a) =>
    publishExam(
      db,
      a,
      ids[0],
      {
        version: saved.version,
        signoff: true,
        reason: "SAMPLE corrected finding after dispatch",
      },
      store,
    ),
  );
  assert.equal(
    (await state()).manifest.find((c) => c.card_id === ids[0])!
      .exam_revision_id,
    before.exam_revision_id,
  );
  assert.equal(
    (await run("a", portalData)).cards.find((c) => c.card_id === ids[0])!
      .approval_current,
    false,
  );
  assert.equal((await card(ids[0])).custody, "grader");
});
test("closed batch rejects newly attached cards even through the legacy API", async () => {
  await assert.rejects(
    run("staff", (db) =>
      db.query(
        "update ns.card_items set batch_id=$3 where tenant_id=$1 and id=$2",
        [TENANT, ids[2], bid],
      ),
    ),
    /dispatched or cancelled/,
  );
  await assert.rejects(
    run("staff", (db, a) =>
      batchWorkspace(db, { ...a, tenant_id: randomUUID() }, bid),
    ),
    denied,
  );
});
test("tracking correction does not rewrite dispatch manifest; cancellation and duplicate dispatch fail", async () => {
  const before = await run("staff", (db, a) => manifestCsv(db, a, bid)),
    w = await state();
  await run("staff", (db, a) =>
    batch(db, a, {
      operation: "tracking",
      id: bid,
      version: w.batch.version,
      reference: "SAMPLE corrected tracking display",
      carrier: "SAMPLE carrier",
      tracking: "SAMPLE-NEW",
      reason,
    }),
  );
  assert.equal(await run("staff", (db, a) => manifestCsv(db, a, bid)), before);
  await assert.rejects(operation(await dispatchBody()), denied);
  await assert.rejects(
    operation(
      body({
        action: "cancel_batch",
        batch_id: bid,
        batch_version: (await state()).batch.version,
      }),
    ),
    denied,
  );
  await assert.rejects(milestone([ids[0]], "cancelled"), denied);
});
test("holds preserve physical custody and cannot bypass dispatch or release rules", async () => {
  await milestone([ids[0]], "on_hold");
  assert.equal((await card(ids[0])).custody, "grader");
  await assert.rejects(milestone([ids[0]], "return_without_grading"), denied);
  await assert.rejects(milestone([ids[0]], "ready_for_pickup"), denied);
  await assert.rejects(
    run("staff", async (db, a) =>
      updateGradingCard(db, a, ids[0], {
        version: (await gradingCard(db, a, ids[0])).version,
        status_key: "completed",
        reason,
      }),
    ),
    denied,
  );
  await milestone([ids[0]], "grader_received");
});
test("post-dispatch customer withdrawal is a separate reviewed request and preserves shipment", async () => {
  const c = await card(other),
    b = {
      choice: "withdraw",
      card_id: other,
      version: c.version,
      confirmed: true,
      request_id: randomUUID(),
    };
  await run("b", (db, a) => recordPortalDecision(db, a, b));
  await run("b", (db, a) => recordPortalDecision(db, a, b));
  assert.equal((await card(other)).status_key, "sent_to_grader");
  const own = (await run("b", portalData)).cards.find(
    (c) => c.card_id === other,
  )!;
  assert.equal(own.withdrawal?.resolution, "pending");
  await assert.rejects(
    run("a", (db, a) =>
      recordPortalDecision(db, a, { ...b, request_id: randomUUID() }),
    ),
    denied,
  );
  await operation(
    body({
      action: "withdrawal_review",
      withdrawal_id: b.request_id,
      resolution: "return_when_received",
    }),
  );
  assert.equal(
    (await run("b", portalData)).cards.find((c) => c.card_id === other)
      ?.withdrawal?.resolution,
    "return_when_received",
  );
  assert.equal((await card(other)).custody, "grader");
});
test("partial returns record only the received card and preserve manual Northside estimate", async () => {
  await milestone([ids[0]], "grading");
  const before = (await run("a", (db, a) => portalDetail(db, a, ids[0])))
    .exams[0].projected_grade;
  await operation(
    body({
      action: "return_card",
      card_id: ids[0],
      version: (await card(ids[0])).version,
      physically_received: true,
      result_kind: "graded",
      result: "SAMPLE actual 8",
      certificate: "SAMPLE-CERT-8",
    }),
  );
  assert.equal((await card(ids[0])).custody, "northside");
  assert.equal((await card(ids[1])).custody, "grader");
  assert.equal((await card(other)).custody, "grader");
  assert.equal(
    (await run("a", (db, a) => portalDetail(db, a, ids[0]))).exams[0]
      .projected_grade,
    before,
  );
});
test("ready-for-pickup requires confirmed returned photos, separate from published exam photos", async () => {
  await assert.rejects(milestone([ids[0]], "ready_for_pickup"), denied);
  returnFront = await returnPhoto(ids[0], "returned_front");
  await assert.rejects(milestone([ids[0]], "ready_for_pickup"), denied);
  await returnPhoto(ids[0], "returned_back");
  const before = await run("a", (db, a) => examWorkspace(db, a, ids[0]));
  assert.ok(
    before.revisions[0].photos.every((p) => !p.kind.startsWith("returned_")),
  );
  await milestone([ids[0]], "ready_for_pickup");
  await assert.rejects(
    run("b", (db, a) => authorizedExamPhoto(db, a, ids[0], returnFront)),
    denied,
  );
  assert.ok(
    (await run("a", portalData)).cards
      .find((c) => c.card_id === ids[0])!
      .photos.some((p) => p.kind === "returned_front"),
  );
});
test("missing storage bytes block release despite a completed upload row", async () => {
  const b = body({
    action: "milestone",
    cards: [{ card_id: ids[0], version: (await card(ids[0])).version }],
    status_key: "ready_for_pickup",
  });
  await assert.rejects(
    run("staff", (db, a) =>
      operationsAction(db, a, b, {
        put: async () => {},
        read: async () => {
          throw new AccessError(503, "missing_stored_photo");
        },
      }),
    ),
    denied,
  );
});
function pickupBody(id: string, c: Awaited<ReturnType<typeof card>>) {
  return body({
    action: "release",
    customer_id: previewId(1),
    recipient_name: "SAMPLE authorized recipient",
    recipient_kind: "representative",
    verification_method: "photo_id_in_person",
    verification_evidence:
      "SAMPLE verified identity in person without retaining ID number",
    authorization_evidence:
      "SAMPLE independent collector callback authorizing named representative",
    acknowledgment:
      "SAMPLE recipient acknowledges the selected physical card received",
    identity_verified: true,
    recipient_acknowledged: true,
    cards: [
      {
        card_id: id,
        version: c.version,
        method: "scanner",
        code: gradingLabel(id),
      },
    ],
  });
}
test("pickup requires matching collector, scan, independent verification and acknowledgment", async () => {
  const b = pickupBody(ids[0], await card(ids[0]));
  for (const change of [
    { customer_id: previewId(2) },
    { authorization_evidence: "" },
    { identity_verified: false },
    { recipient_acknowledged: false },
    { cards: [{ card_id: ids[0], version: (await card(ids[0])).version }] },
  ])
    await assert.rejects(
      operation({ ...b, ...change, request_id: randomUUID() }),
      denied,
    );
  assert.equal((await card(ids[0])).custody, "northside");
});
test("partial pickup is immutable, idempotent and prevents duplicate release", async () => {
  released = pickupBody(ids[0], await card(ids[0]));
  await operation(released);
  assert.equal((await operation(released)).duplicate, true);
  assert.equal((await card(ids[0])).custody, "released");
  assert.equal((await card(ids[1])).custody, "grader");
  assert.equal(
    (await run("staff", operationsOverview)).pickups[0].card_ids.length,
    1,
  );
  await assert.rejects(
    operation({ ...released, request_id: randomUUID() }),
    denied,
  );
  await assert.rejects(milestone([ids[0]], "on_hold"), denied);
  await assert.rejects(
    f.db.query("update ns.grading_pickups set recipient_name=$1", [
      "Different",
    ]),
    /Append-only/i,
  );
});
test("return without grading and pre-dispatch cancellation retain received records", async () => {
  await approveForTest(f, [ids[2]], "a", store);
  const canceled = (
    await run("staff", (db, a) =>
      batch(db, a, {
        operation: "create",
        provider: "psa",
        service: sampleService,
        reference: "SAMPLE cancelled before shipment",
        reason,
      }),
    )
  ).id!;
  await operation(
    body({
      action: "scan_batch",
      batch_id: canceled,
      batch_version: 1,
      code: ids[2],
      method: "manual",
    }),
  );
  await milestone([ids[2]], "cancelled");
  assert.equal((await card(ids[2])).batch_id, null);
  assert.equal(
    (await run("staff", (db, a) => batchWorkspace(db, a, canceled))).cards
      .length,
    0,
  );
  await milestone([ids[2]], "ready_for_pickup");
  const b = {
    ...pickupBody(ids[2], await card(ids[2])),
    recipient_kind: "collector",
    authorization_evidence: "",
  };
  await operation(b);
  assert.equal((await card(ids[2])).status_key, "completed");
  assert.equal((await card(ids[2])).result_kind, null);
});
const mapping = Object.fromEntries(statusImportFields.map((x) => [x, x]));
const csv = (row: string) => statusImportFields.join(",") + "\n" + row + "\n";
test("spreadsheet mapping rejects dispatch/release, foreign or duplicate IDs and missing outcome evidence", async () => {
  for (const row of [
    `X,${other},completed,,,,SAMPLE prohibited`,
    `X,${other},returned,,,,SAMPLE missing outcome`,
    `X,${randomUUID()},grading,,,,SAMPLE unknown`,
  ]) {
    const p = await run("staff", (db, a) =>
      statusImportPreview(db, a, {
        csv: csv(row),
        source: "SAMPLE-validation",
        mapping,
      }),
    );
    assert.equal(p.rows[0].state, "error");
    await assert.rejects(
      run("staff", (db, a) =>
        commitStatusImport(db, a, { id: p.id, confirmed: true, reason }, store),
      ),
      denied,
    );
  }
});
test("milestone CSV with blank outcome columns preserves the existing outcome", async () => {
  const before = await card(other);
  const p = await run("staff", (db, a) =>
    statusImportPreview(db, a, {
      csv: csv(
        `SAMPLE-receipt-1,${other},grader_received,,,,SAMPLE verified grader receipt`,
      ),
      source: "SAMPLE-milestones",
      mapping,
    }),
  );
  await run("staff", (db, a) =>
    commitStatusImport(db, a, { id: p.id, confirmed: true, reason }, store),
  );
  const after = await card(other);
  assert.equal(after.status_key, "grader_received");
  assert.equal(after.result_kind, before.result_kind);
  assert.equal(after.result, before.result);
  assert.equal(after.certificate, before.certificate);
  assert.equal(
    (await run("staff", (db, a) => operationsCard(db, a, other))).outcomes
      .length,
    0,
  );
});
test("reviewed spreadsheet records actual no-grade result, deduplicates and retains source/actor", async () => {
  const input = {
    csv: csv(
      `SAMPLE-no-grade-1,${other},returned,no_grade,SAMPLE altered card - no grade,,SAMPLE actual grader return checked`,
    ),
    source: "SAMPLE-returns",
    mapping,
  };
  const p = await run("staff", (db, a) => statusImportPreview(db, a, input));
  assert.equal(p.rows[0].state, "ready");
  await run("staff", (db, a) =>
    commitStatusImport(db, a, { id: p.id, confirmed: true, reason }, store),
  );
  assert.equal((await card(other)).result_kind, "no_grade");
  const again = await run("staff", (db, a) =>
    statusImportPreview(db, a, input),
  );
  assert.equal(again.rows[0].state, "duplicate");
  assert.equal(
    (
      await run("staff", (db, a) =>
        commitStatusImport(
          db,
          a,
          { id: again.id, confirmed: true, reason },
          store,
        ),
      )
    ).changed,
    0,
  );
  const history = await run("staff", (db, a) => operationsCard(db, a, other));
  assert.equal(history.outcomes[0].source, "import");
  assert.ok(
    history.audit.some(
      (a) => a.source === "import" && a.staff_id === previewId(10),
    ),
  );
  assert.equal(
    (await run("staff", (db, a) => readStatusImport(db, a, p.id))).status,
    "committed",
  );
});
test("stale spreadsheet reviews reject atomically instead of replacing later evidence", async () => {
  const p = await run("staff", (db, a) =>
    statusImportPreview(db, a, {
      csv: csv(
        `SAMPLE-stale,${ids[1]},grader_received,,,,SAMPLE receipt evidence`,
      ),
      source: "SAMPLE-stale",
      mapping,
    }),
  );
  await milestone([ids[1]], "on_hold");
  await assert.rejects(
    run("staff", (db, a) =>
      commitStatusImport(db, a, { id: p.id, confirmed: true, reason }, store),
    ),
    denied,
  );
  assert.equal((await card(ids[1])).status_key, "on_hold");
});
test("in-app decision/pickup notifications stay owner scoped and delivery rehearsals are UNSENT", async () => {
  const own = await run("a", inbox),
    rows = own.notifications as { topic: string; grading_card_id: string }[];
  assert.ok(rows.some((n) => n.topic === "decision_recorded"));
  assert.ok(rows.some((n) => n.topic === "pickup_ready"));
  assert.ok(rows.some((n) => n.topic === "pickup_completed"));
  assert.ok(rows.every((n) => n.grading_card_id !== other));
  await run("a", (db, a) =>
    preferences(
      db,
      a,
      { kind: "grading", in_app: true, email: true, push: false },
      undefined,
      true,
    ),
  );
  await milestone([ids[1]], "grader_received");
  let sends = 0;
  await runNotifications(
    25,
    (fn) => engagementSampleRun(f, fn),
    true,
    async () => {
      sends++;
      return { state: "unsent", code: "UNSENT_sample_only" };
    },
  );
  assert.ok(sends > 0);
  assert.ok(
    (await run("staff", operationsOverview)).notices.some(
      (n) => n.state === "unsent",
    ),
  );
});
test("notification failure and repeated worker retries do not repeat grading actions", async () => {
  await milestone([ids[1]], "grading");
  const snapshot = async () => ({
    cards: (
      await f.db.query(
        "select card_id,status_key,version from ns.grading_cards order by card_id",
      )
    ).rows,
    operations: (
      await f.db.query(
        "select (select count(*)::int from ns.grading_manifest_cards) manifests,(select count(*)::int from ns.grading_pickup_cards) releases,(select count(*)::int from ns.grading_outcomes) outcomes,(select count(*)::int from ns.grading_events) events,(select count(*)::int from ns.notifications) notices",
      )
    ).rows,
  });
  const before = await snapshot();
  let calls = 0;
  await runNotifications(
    25,
    (fn) => engagementSampleRun(f, fn),
    true,
    async () => {
      calls++;
      return { state: "pending", code: "network_failure" };
    },
  );
  assert.ok(calls > 0);
  const pending = (
    await f.db.query(
      "select id from ns.notification_jobs where state='pending' and last_error='network_failure'",
    )
  ).rows;
  assert.ok(pending.length > 0);
  await f.db.query(
    "update ns.notification_jobs set available_at=now()-interval '1 second' where state='pending' and last_error='network_failure'",
  );
  const beforeRetry = calls;
  for (let n = 0; n < 2; n++)
    await runNotifications(
      25,
      (fn) => engagementSampleRun(f, fn),
      true,
      async () => {
        calls++;
        return { state: "unsent", code: "UNSENT_sample_only" };
      },
    );
  assert.equal(calls - beforeRetry, pending.length);
  assert.deepEqual(await snapshot(), before);
});
test("customer exports and direct requests exclude mixed manifests and staff pickup evidence", async () => {
  const exportA = await run("a", portalExport);
  assert.ok(!exportA.includes(other));
  assert.ok(!exportA.includes("authorized recipient"));
  await assert.rejects(
    run("a", (db, a) => operationsCard(db, a, ids[0])),
    denied,
  );
  for (const table of [
    "grading_dispatches",
    "grading_manifest_cards",
    "grading_pickups",
    "grading_pickup_cards",
  ])
    assert.equal(
      (await run("a", (db) => db.query(`select * from ns.${table}`))).rows
        .length,
      0,
    );
});
test("dispatch, partial returns, pickup acknowledgment, photos and queue survive restart", async () => {
  await f.db.close();
  f = await openPreviewDatabase(join(directory, "db"));
  assert.equal((await state()).manifest.length, 3);
  assert.equal((await card(ids[0])).custody, "released");
  assert.equal((await card(other)).result_kind, "no_grade");
  assert.equal((await run("staff", operationsOverview)).pickups.length, 2);
  assert.ok(
    (await run("a", (db, a) => authorizedExamPhoto(db, a, ids[0], returnFront)))
      .ready,
  );
  assert.equal((await operation(released)).duplicate, true);
});
test.after(async () => {
  await f.db.close();
  await rm(directory, { recursive: true, force: true });
});
