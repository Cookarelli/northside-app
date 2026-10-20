import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  createIntake,
  gradingCards,
  gradingCard,
  updateGradingCard,
  decide,
} from "../lib/server/grading";
import { batch } from "../lib/server/grading-operations";
import {
  portalData,
  portalDetail,
  portalExport,
  cardQuotes,
  quoteWorkspace,
  saveQuote,
  recordPortalDecision,
} from "../lib/server/grading-portal";
import {
  decisionSelection,
  quoteComplete,
  submissionReady,
} from "../lib/grading-portal";
import {
  examWorkspace,
  saveExamDraft,
  publishExam,
  authorizedExamPhoto,
  prepareExamPhoto,
  completeExamPhoto,
} from "../lib/server/exam";
import { photoHash, localPhotoStore } from "../lib/server/exam-storage";
import {
  AccessError,
  safeReturn,
  hashToken,
  opaqueToken,
} from "../lib/server/security";
import { gradingReceipt } from "../lib/server/grading-receipt";
import {
  batchWorkspace,
  operationsAction,
  recordOutcome,
} from "../lib/server/grading-fulfillment";
import { TENANT } from "../lib/server/providers";
import { authorizeOn, type Sql } from "../lib/server/db";
import {
  prepareExam,
  dispatchForTest,
  sampleQuote,
  sampleService,
} from "./support/grading-exam-fixture";
const directory = await mkdtemp(join(tmpdir(), "northside-portal-"));
let fixture = await openPreviewDatabase(join(directory, "db"));
const run = <T>(who: string, fn: Parameters<typeof fixture.run<T>>[1]) =>
  fixture.run(who, fn);
const store = localPhotoStore(join(directory, "photos"));
const intake = await run("staff", (db, a) =>
  createIntake(
    db,
    a,
    {
      customer_id: previewId(1),
      description: "SAMPLE collector <script>receipt</script>",
      quantity: 3,
      sport: "",
      year: "",
      manufacturer: "",
      card_set: "",
      card_number: "",
      parallel: "",
    },
    randomUUID(),
    "SAMPLE portal receipt",
  ),
);
const ids = (await run("a", gradingCards))
  .filter((c) => c.case_id === intake.case_id)
  .map((c) => c.card_id)
  .sort();
const fail = (n: number) => (e: unknown) =>
  e instanceof AccessError && e.status === n;
const view = async () =>
  (await run("a", portalData)).cards.filter((c) => ids.includes(c.card_id));
const selection = async (cardIds = ids) =>
  (await view()).filter((c) => cardIds.includes(c.card_id));
const decideCards = async (
  cardIds: string[],
  choice = "submit",
  extra: Record<string, unknown> = {},
) => {
  const b = {
    choice,
    cards: decisionSelection(await selection(cardIds)),
    request_id: randomUUID(),
    confirmed: true,
    ...extra,
  };
  await run("a", (db, a) => recordPortalDecision(db, a, b));
  return b;
};
const quote = async (id: string, overrides: Record<string, unknown> = {}) =>
  run("staff", async (db, a) =>
    saveQuote(db, a, {
      ...sampleQuote,
      card_id: id,
      request_id: randomUUID(),
      previous_id: (await cardQuotes(db, a, id))[0]?.id ?? null,
      ...overrides,
    }),
  );
let approval: Record<string, unknown>,
  dispatchBatch = "";

test("portal: owned received cards and receipt exclude batch manifests and preserve unset charges", async () => {
  const cards = await view();
  assert.equal(cards.length, 3);
  assert.equal(cards[0].quote, null);
  assert.equal(quoteComplete(null), false);
  assert.equal(submissionReady(cards[0]), false);
  for (const c of cards) {
    assert.equal("customer_id" in c, false);
    assert.equal("batch_id" in c, false);
    assert.equal("tenant_id" in c, false);
  }
  const d = await run("a", (db, a) => portalDetail(db, a, ids[0]));
  assert.equal(d.receipt.cards.length, 3);
  assert.equal(d.receipt.examination_subtotal_cents, 1500);
  assert.ok(d.receipt.received_at);
  const html = gradingReceipt(d.receipt, true);
  assert.match(html, /SAMPLE/);
  assert.match(html, /not free/);
  assert.ok(!html.includes("<script>receipt</script>"));
  assert.ok(html.includes("&lt;script&gt;receipt"));
  await assert.rejects(
    run("b", (db, a) => portalDetail(db, a, ids[0])),
    fail(404),
  );
});
test("portal: manual quotes start incomplete, require confirmed provider, and retain immutable revisions", async () => {
  await quote(ids[0], {
    service: "",
    grading_cents: null,
    shipping_cents: null,
    insurance_cents: null,
    other_cents: null,
  });
  const c = (await selection([ids[0]]))[0];
  assert.equal(c.quote?.grading_cents, null);
  assert.equal(quoteComplete(c.quote), false);
  await assert.rejects(quote(ids[0], { provider: "unconfirmed" }), fail(400));
  for (const who of ["a", "reader", "editor"])
    await assert.rejects(
      run(who, (db, a) =>
        saveQuote(db, a, { ...sampleQuote, card_id: ids[0] }),
      ),
      fail(403),
    );
  await assert.rejects(
    fixture.db.query("update ns.grading_quotes set grading_cents=0"),
    /Append-only/,
  );
});
test("portal: published exams, confirmed photos and explicitly configured zero charges become reviewable", async () => {
  for (const id of ids) {
    await prepareExam(fixture, id, store);
    await quote(id);
  }
  for (const c of await view()) {
    assert.equal(c.photos.length, 2);
    assert.ok(c.exam);
    assert.ok(submissionReady(c));
    assert.equal(c.quote?.other_cents, 0);
  }
  const d = await run("a", (db, a) => portalDetail(db, a, ids[0]));
  assert.equal(d.exams[0].projected_grade, "SAMPLE manual estimate 7");
  assert.ok(!JSON.stringify(d).includes("PRIVATE EXAM"));
  assert.ok(!JSON.stringify(d).includes("BGP"));
  const photoId = (await selection([ids[0]]))[0].photos[0].id;
  await run("a", (db, a) => authorizedExamPhoto(db, a, ids[0], photoId));
});
test("portal: partial approval binds exact cards, examiner revisions and quote revisions; retry records once", async () => {
  await assert.rejects(
    decideCards(ids.slice(0, 2), "submit", { confirmed: false }),
    fail(400),
  );
  approval = await decideCards(ids.slice(0, 2), "submit", {
    customer_id: previewId(2),
    signed_at: "fake",
  });
  await run("a", (db, a) => recordPortalDecision(db, a, approval));
  const cards = await view();
  assert.equal(cards.filter((c) => c.approval_current).length, 2);
  assert.equal(
    cards.find((c) => c.card_id === ids[2])!.status_key,
    "awaiting_decision",
  );
  const rows = (
    await fixture.db.query<{ customer_id: string; selection: unknown[] }>(
      "select customer_id,selection from ns.grading_approval_requests where id=$1",
      [approval.request_id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_id, previewId(1));
  assert.equal(rows[0].selection.length, 2);
  const items = (
    await fixture.db.query<{ quote_id: string; exam_revision_id: string }>(
      "select * from ns.grading_approval_cards where request_id=$1",
      [approval.request_id],
    )
  ).rows;
  assert.equal(items.length, 2);
  assert.ok(items.every((c) => c.quote_id && c.exam_revision_id));
  await assert.rejects(
    run("a", (db, a) =>
      recordPortalDecision(db, a, { ...approval, choice: "return" }),
    ),
    fail(409),
  );
});
test("portal: old and forged decisions cannot authorize dispatch; mixed-owner selections are atomic", async () => {
  await assert.rejects(
    run("a", (db, a) => decide(db, a, ids[2], {})),
    fail(409),
  );
  await assert.rejects(
    run("a", (db) =>
      db.query("select ns.grading_decide($1,1,'submit',$2)", [
        ids[2],
        randomUUID(),
      ]),
    ),
    /current exam/,
  );
  const b = (await run("b", portalData)).cards[0];
  const payload = {
    choice: "submit",
    cards: decisionSelection([...(await selection([ids[2]])), b]),
    request_id: randomUUID(),
    confirmed: true,
  };
  await assert.rejects(
    run("a", (db, a) => recordPortalDecision(db, a, payload)),
    fail(404),
  );
  assert.equal((await selection([ids[2]]))[0].approval_current, false);
  await assert.rejects(
    run("a", (db) =>
      db.query(
        "insert into ns.grading_approval_requests(tenant_id,id,customer_id,choice,selection) values($1,$2,$3,'submit','[{}]')",
        [TENANT, randomUUID(), previewId(1)],
      ),
    ),
    /permission denied/,
  );
});
test("portal: a new quote makes only that card approval stale; stale review and stale quote saves fail", async () => {
  const before = (await selection([ids[0]]))[0],
    body = {
      ...sampleQuote,
      card_id: ids[0],
      previous_id: before.quote!.id,
      request_id: randomUUID(),
      reason: "Changed material fees",
      grading_cents: 3000,
    };
  await run("staff", (db, a) => saveQuote(db, a, body));
  await run("staff", (db, a) => saveQuote(db, a, body));
  assert.equal((await selection([ids[0]]))[0].approval_current, false);
  assert.equal((await selection([ids[1]]))[0].approval_current, true);
  await assert.rejects(
    run("a", (db, a) =>
      recordPortalDecision(db, a, {
        choice: "submit",
        confirmed: true,
        request_id: randomUUID(),
        cards: decisionSelection([before]),
      }),
    ),
    fail(409),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      saveQuote(db, a, { ...body, request_id: randomUUID() }),
    ),
    fail(409),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      updateGradingCard(db, a, ids[0], {
        version: before.version,
        status_key: "sent_to_grader",
        reason: "Cannot bypass stale approval",
      }),
    ),
    /approval/,
  );
  await decideCards([ids[0]]);
  assert.equal((await selection([ids[0]]))[0].approval_current, true);
});
test("portal: corrected exam requires renewed approval and preserves earlier approved evidence", async () => {
  const old = (await selection([ids[1]]))[0];
  const draft = (await run("staff", (db, a) => examWorkspace(db, a, ids[1])))
    .draft!;
  const saved = await run("staff", (db, a) =>
    saveExamDraft(db, a, ids[1], {
      version: draft.version,
      fields: { ...draft.fields, notes: "SAMPLE corrected findings" },
      internal_notes: "PRIVATE correction",
    }),
  );
  await run("staff", (db, a) =>
    publishExam(
      db,
      a,
      ids[1],
      { version: saved.version, signoff: true, reason: "SAMPLE correction" },
      store,
    ),
  );
  assert.equal((await selection([ids[1]]))[0].approval_current, false);
  const detail = await run("a", (db, a) => portalDetail(db, a, ids[1]));
  assert.equal(detail.exams.length, 2);
  assert.equal(detail.decisions[0].exam_revision_id, old.exam!.id);
  await assert.rejects(
    run("a", (db, a) =>
      recordPortalDecision(db, a, {
        choice: "submit",
        confirmed: true,
        request_id: randomUUID(),
        cards: decisionSelection([old]),
      }),
    ),
    fail(409),
  );
});
test("portal: selected return requests supersede submission approval without returning other cards", async () => {
  await decideCards([ids[1]]);
  assert.equal((await selection([ids[1]]))[0].approval_current, true);
  const body = await decideCards([ids[1], ids[2]], "return");
  await run("a", (db, a) => recordPortalDecision(db, a, body));
  const cards = await view();
  assert.equal(
    cards.filter((c) => c.status_key === "return_requested").length,
    2,
  );
  assert.equal(cards.find((c) => c.card_id === ids[0])!.approval_current, true);
  assert.equal(
    cards.find((c) => c.card_id === ids[0])!.status_key,
    "ready_to_submit",
  );
  for (const id of ids.slice(1))
    assert.equal(cards.find((c) => c.card_id === id)!.approval_current, false);
});
test("portal: dispatch matches exact approved provider/service and rejects mixed unapproved batch atomically", async () => {
  const wrong = await run("staff", (db, a) =>
    batch(db, a, {
      operation: "create",
      reference: "PRIVATE wrong service batch",
      provider: "psa",
      service: "Different service",
      reason: "SAMPLE",
    }),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      operationsAction(
        db,
        a,
        {
          action: "scan_batch",
          request_id: randomUUID(),
          batch_id: wrong.id,
          batch_version: 1,
          code: ids[0],
          method: "manual",
          reason: "SAMPLE mismatch",
        },
        store,
      ),
    ),
    /provider.and.service/,
  );
  const created = await run("staff", (db, a) =>
    batch(db, a, {
      operation: "create",
      reference: "PRIVATE manifest",
      provider: "psa",
      service: sampleService,
      reason: "SAMPLE dispatch",
    }),
  );
  dispatchBatch = created.id!;
  await assert.rejects(
    run("staff", (db, a) =>
      operationsAction(
        db,
        a,
        {
          action: "scan_batch",
          request_id: randomUUID(),
          batch_id: dispatchBatch,
          batch_version: 1,
          code: ids[1],
          method: "manual",
          reason: "SAMPLE no approval",
        },
        store,
      ),
    ),
    /approval/,
  );
  assert.equal(
    (await run("staff", (db, a) => gradingCard(db, a, ids[0]))).batch_id,
    null,
  );
  await dispatchForTest(fixture, dispatchBatch, [ids[0]]);
  assert.equal((await selection([ids[0]]))[0].status_key, "sent_to_grader");
  await assert.rejects(decideCards([ids[0]], "return"), fail(409));
  await assert.rejects(
    run("staff", (db) =>
      db.query(
        "update ns.grading_batches set service='switched' where tenant_id=$1 and id=$2",
        [TENANT, dispatchBatch],
      ),
    ),
    /new batch/,
  );
  await assert.rejects(
    run("staff", (db) =>
      db.query(
        "update ns.card_items set batch_id=$3 where tenant_id=$1 and id=$2",
        [TENANT, ids[0], wrong.id],
      ),
    ),
    /cannot change/,
  );
});
test("portal: received and final records remain scoped across photos, reports, quotes, receipts and exports", async () => {
  const c = (await selection([ids[0]]))[0];
  await run("staff", (db, a) =>
    recordOutcome(db, a, {
      card_id: ids[0],
      version: c.version,
      result_kind: "graded",
      result: "PSA 8 (SAMPLE)",
      certificate: "SAMPLE-123",
      reason: "Sample final result",
    }),
  );
  const detail = await run("a", (db, a) => portalDetail(db, a, ids[0]));
  assert.equal(detail.card.result, "PSA 8 (SAMPLE)");
  assert.notEqual(detail.card.result, detail.exams[0].projected_grade);
  const csv = await run("a", portalExport);
  assert.match(csv, /SAMPLE-123/);
  assert.ok(!csv.includes("PRIVATE"));
  assert.ok(!(await run("b", portalExport)).includes(ids[0]));
  for (const who of ["b", "editor"]) {
    await assert.rejects(
      run(who, (db, a) => portalDetail(db, a, ids[0])),
      who === "b" ? fail(404) : fail(403),
    );
    await assert.rejects(
      run(who, (db, a) =>
        authorizedExamPhoto(db, a, ids[0], detail.card.photos[0].id),
      ),
      who === "b" ? fail(404) : fail(403),
    );
  }
  const customer = JSON.stringify(detail);
  assert.ok(!customer.includes("PRIVATE"));
  assert.ok(!customer.includes(dispatchBatch));
  assert.ok(!customer.includes("internal_notes"));
  await assert.rejects(
    fixture.db.query("delete from ns.grading_approval_cards"),
    /Append-only/,
  );
});
test("portal: tenant boundaries and absent sessions cannot inspect approvals or receipt contents", async () => {
  const tenant = randomUUID(),
    customer = randomUUID(),
    token = opaqueToken();
  await fixture.db.query(
    "insert into ns.tenants(id,slug,shop,is_test) values($1,'portal-other','portal-other.myshopify.com',true)",
    [tenant],
  );
  await fixture.db.query(
    "insert into ns.customers(tenant_id,id,display_name) values($1,$2,'OTHER TENANT')",
    [tenant, customer],
  );
  await fixture.db.query(
    "insert into ns.sessions(token_hash,tenant_id,customer_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'shopify','TEST',now()+interval '1 day',now()+interval '1 day')",
    [hashToken(token), tenant, customer],
  );
  await fixture.db.transaction(async (tx) => {
    await tx.exec("set local role northside_runtime");
    const db = tx as unknown as Sql,
      a = await authorizeOn(db, token);
    await assert.rejects(portalDetail(db, a, ids[0]), fail(404));
    for (const t of [
      "grading_quotes",
      "grading_approval_requests",
      "grading_approval_cards",
    ])
      assert.equal((await db.query(`select * from ns.${t}`)).rows.length, 0);
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select ns.grading_approval_current($1,$2) as ok",
          [TENANT, ids[0]],
        )
      ).rows[0].ok,
      false,
    );
  });
});
test("portal: login return paths preserve card/exam destinations and reject open redirects", () => {
  for (const path of [
    "/my-cards/grading",
    `/my-cards/grading/card/${ids[0]}`,
    `/my-cards/grading/exam/${ids[0]}`,
    "/grading",
  ])
    assert.equal(safeReturn(path), path);
  for (const path of [
    "//evil.test",
    "https://evil.test",
    "/my-cards/grading/../../api/private",
    "/my-cards/grading?returnTo=https://evil.test",
    "/my-cards/grading/card/not-a-uuid",
    "/%2f%2fevil.test",
  ])
    assert.equal(safeReturn(path), "/account");
});
test("portal: database and private photos survive close/reopen with quotes, approvals and returns intact", async () => {
  const before = await view();
  await fixture.db.close();
  fixture = await openPreviewDatabase(join(directory, "db"));
  const after = await view();
  assert.deepEqual(
    after.map((c) => [
      c.card_id,
      c.status_key,
      c.quote?.id,
      c.exam?.id,
      c.approval_current,
    ]),
    before.map((c) => [
      c.card_id,
      c.status_key,
      c.quote?.id,
      c.exam?.id,
      c.approval_current,
    ]),
  );
  assert.equal(
    (await run("a", (db, a) => portalDetail(db, a, ids[1]))).decisions.length,
    3,
  );
  const photos = (
    await fixture.db.query<{ object_key: string }>(
      "select object_key from ns.grading_photos where card_id=$1",
      [ids[0]],
    )
  ).rows;
  assert.ok((await store.read(photos[0].object_key)).length > 0);
  assert.equal(
    (await run("staff", (db, a) => quoteWorkspace(db, a, ids[1])))
      .approval_current,
    false,
  );
});

test("portal: drop-off photos are available before publication; paper evidence stays private and unquoted cards can be returned", async () => {
  const intake = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      {
        customer_id: previewId(1),
        description: "SAMPLE received before exam",
        quantity: 1,
      },
      randomUUID(),
      "SAMPLE receipt",
    ),
  );
  const card = (await run("a", portalData)).cards.find(
    (c) => c.case_id === intake.case_id,
  )!;
  const key = (
    await fixture.db.query<{ object_key: string }>(
      "select object_key from ns.grading_photos where card_id=$1 limit 1",
      [ids[0]],
    )
  ).rows[0].object_key;
  const bytes = await store.read(key);
  let paper = "";
  for (const kind of ["front", "paper"]) {
    const p = await run("staff", (db, a) =>
      prepareExamPhoto(db, a, card.card_id, {
        kind,
        request_id: randomUUID(),
        source_hash: photoHash(bytes),
      }),
    );
    await run("staff", (db, a) =>
      completeExamPhoto(db, a, card.card_id, p.id, bytes, "image/jpeg", store),
    );
    if (kind === "paper") paper = p.id;
  }
  const c = (await run("a", portalData)).cards.find(
    (c) => c.card_id === card.card_id,
  )!;
  assert.equal(c.exam, null);
  assert.equal(c.quote, null);
  assert.equal(c.photos.length, 1);
  await run("a", (db, a) =>
    authorizedExamPhoto(db, a, c.card_id, c.photos[0].id),
  );
  await assert.rejects(
    run("a", (db, a) => authorizedExamPhoto(db, a, c.card_id, paper)),
    fail(404),
  );
  await run("a", (db, a) =>
    recordPortalDecision(db, a, {
      choice: "return",
      confirmed: true,
      request_id: randomUUID(),
      cards: decisionSelection([c]),
    }),
  );
  const d = await run("a", (db, a) => portalDetail(db, a, c.card_id));
  assert.equal(d.card.status_key, "return_requested");
  assert.equal(d.decisions[0].quote_id, null);
  assert.equal(d.decisions[0].exam_revision_id, null);
});
test("portal: every unset charge blocks approval; explicit zero is distinct from unset and service changes invalidate approval", async () => {
  const intake = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      {
        customer_id: previewId(1),
        description: "SAMPLE unquoted charge checks",
        quantity: 1,
      },
      randomUUID(),
      "SAMPLE receipt",
    ),
  );
  const id = (await run("a", portalData)).cards.find(
    (c) => c.case_id === intake.case_id,
  )!.card_id;
  await prepareExam(fixture, id, store);
  for (const field of [
    "grading_cents",
    "shipping_cents",
    "insurance_cents",
    "other_cents",
  ]) {
    await quote(id, { [field]: null });
    const c = (await run("a", portalData)).cards.find((c) => c.card_id === id)!;
    assert.equal(quoteComplete(c.quote), false);
    await assert.rejects(
      run("a", (db, a) =>
        recordPortalDecision(db, a, {
          choice: "submit",
          confirmed: true,
          request_id: randomUUID(),
          cards: decisionSelection([c]),
        }),
      ),
      fail(409),
    );
  }
  await quote(id, {
    grading_cents: 0,
    shipping_cents: 0,
    insurance_cents: 0,
    other_cents: 0,
  });
  const c = (await run("a", portalData)).cards.find((c) => c.card_id === id)!;
  assert.equal(quoteComplete(c.quote), true);
  await run("a", (db, a) =>
    recordPortalDecision(db, a, {
      choice: "submit",
      confirmed: true,
      request_id: randomUUID(),
      cards: decisionSelection([c]),
    }),
  );
  await quote(id, {
    service: "SAMPLE different configured PSA service",
    grading_cents: 0,
    shipping_cents: 0,
    insurance_cents: 0,
    other_cents: 0,
  });
  assert.equal(
    (await run("a", portalData)).cards.find((c) => c.card_id === id)!
      .approval_current,
    false,
  );
});
test("portal: duplicate cards, mismatched quote references and changed request payloads fail atomically", async () => {
  const cs = await view(),
    c = cs.find((c) => c.card_id === ids[1])!,
    other = cs.find((c) => c.card_id === ids[2])!;
  const payload = {
    choice: "return",
    confirmed: true,
    request_id: randomUUID(),
    cards: decisionSelection([c, c]),
  };
  await assert.rejects(
    run("a", (db, a) => recordPortalDecision(db, a, payload)),
    fail(400),
  );
  await assert.rejects(
    run("a", (db, a) =>
      recordPortalDecision(db, a, {
        ...payload,
        request_id: randomUUID(),
        cards: [{ ...decisionSelection([c])[0], quote_id: other.quote!.id }],
      }),
    ),
    fail(409),
  );
});

test("portal: older batches can configure an unset service before dispatch, never after recorded dispatch", async () => {
  const intake = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      {
        customer_id: previewId(1),
        description: "SAMPLE legacy batch setup",
        quantity: 1,
      },
      randomUUID(),
      "SAMPLE receipt",
    ),
  );
  let c = (await run("a", portalData)).cards.find(
    (c) => c.case_id === intake.case_id,
  )!;
  const b = await run("staff", (db, a) =>
    batch(db, a, {
      operation: "create",
      reference: "SAMPLE older batch",
      provider: "psa",
      reason: "SAMPLE",
    }),
  );
  await run("staff", (db, a) =>
    batch(db, a, {
      operation: "cards",
      id: b.id,
      version: 1,
      assign: true,
      cards: [{ card_id: c.card_id, version: c.version }],
      status_key: "examining",
      reason: "SAMPLE pending exam",
    }),
  );
  await run("staff", (db, a) =>
    batch(db, a, {
      operation: "tracking",
      id: b.id,
      version: 2,
      reference: "SAMPLE older batch",
      service: sampleService,
      reason: "SAMPLE service configured before dispatch",
    }),
  );
  await prepareExam(fixture, c.card_id, store);
  await quote(c.card_id);
  c = (await run("a", portalData)).cards.find((x) => x.card_id === c.card_id)!;
  await run("a", (db, a) =>
    recordPortalDecision(db, a, {
      choice: "submit",
      confirmed: true,
      request_id: randomUUID(),
      cards: decisionSelection([c]),
    }),
  );
  c = (await run("a", portalData)).cards.find((x) => x.card_id === c.card_id)!;
  await dispatchForTest(fixture, b.id!, [c.card_id]);
  c = (await run("a", portalData)).cards.find((x) => x.card_id === c.card_id)!;
  await run("staff", (db, a) =>
    updateGradingCard(db, a, c.card_id, {
      version: c.version,
      status_key: "on_hold",
      reason: "SAMPLE later status cannot erase dispatched history",
    }),
  );
  await assert.rejects(
    run("staff", (db) =>
      db.query(
        "update ns.card_items set batch_id=$3 where tenant_id=$1 and id=$2",
        [TENANT, c.card_id, dispatchBatch],
      ),
    ),
    /cannot change/,
  );
  await assert.rejects(
    run("staff", async (db, a) =>
      batch(db, a, {
        operation: "tracking",
        id: b.id,
        version: (await batchWorkspace(db, a, b.id!)).batch.version,
        reference: "SAMPLE older batch",
        service: "Different",
        reason: "Should be blocked",
      }),
    ),
    /after.dispatch/,
  );
});
test.after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
});
