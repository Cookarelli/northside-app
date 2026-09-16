import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  gradingCards,
  gradingCard,
  gradingDetail,
  gradingDashboard,
  createIntake,
  updateGradingCard,
  decide,
  claimCode,
  requestClaim,
  reviewClaim,
  payment,
  gradingExport,
} from "../lib/server/grading";
import { batch, settings, contact } from "../lib/server/grading-operations";
import {
  previewImport,
  commitImport,
  reverseImport,
} from "../lib/server/grading-import";
import { gradingFields } from "../lib/grading";
import { gradingApi } from "../lib/server/grading-api";
import { TENANT } from "../lib/server/providers";
const directory = await mkdtemp(join(tmpdir(), "northside-grading-tests-"));
let fixture = await openPreviewDatabase(directory);
const run = <T>(who: string, fn: Parameters<typeof fixture.run<T>>[1]) =>
  fixture.run(who, fn);
const input = (
  customer = previewId(1),
  description = "SAMPLE test intake",
  quantity = 3,
) => ({
  customer_id: customer,
  description,
  quantity,
  sport: "Basketball",
  year: "2025",
  manufacturer: "Example",
  card_set: "Sample",
  card_number: "1",
  parallel: "Base",
});
const fail = (status: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === status;
let caseId = "";
test("grading: three physical cards have unique IDs and a $15 examination snapshot", async () => {
  const request = randomUUID();
  const r = await run("staff", (db, a) =>
    createIntake(db, a, input(), request, "Test physical receipt"),
  );
  caseId = r.case_id;
  assert.equal(r.subtotal_cents, 1500);
  const cards = (await run("a", gradingCards)).filter(
    (c) => c.case_id === caseId,
  );
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map((c) => c.card_id)).size, 3);
  const retry = await run("staff", (db, a) =>
    createIntake(db, a, input(), request, "Retry"),
  );
  assert.equal(retry.case_id, caseId);
  assert.equal(retry.duplicate, true);
  const detail = await run("a", (db, a) =>
    gradingDetail(db, a, cards[0].card_id),
  );
  assert.equal(detail.intake_card_count, 3);
  assert.equal(detail.payments.length, 0);
  assert.equal(detail.events[0].source, "northside");
});
test("grading: future rates do not rewrite intake amounts or history", async () => {
  const before = await run("staff", gradingDashboard);
  await run("staff", (db, a) =>
    settings(db, a, {
      kind: "rate",
      version: before.settings.version,
      examination_cents: 650,
      reason: "New rate test",
    }),
  );
  assert.ok(
    (await run("a", gradingCards))
      .filter((c) => c.case_id === caseId)
      .every((c) => c.examination_cents === 500),
  );
  const r = await run("staff", (db, a) =>
    createIntake(db, a, input(), randomUUID(), "New rate intake"),
  );
  assert.equal(r.subtotal_cents, 1950);
  await assert.rejects(
    fixture.db.query(
      "update ns.grading_intakes set examination_cents=1 where case_id=$1",
      [caseId],
    ),
    /immutable/,
  );
  const now = await run("staff", gradingDashboard);
  await run("staff", (db, a) =>
    settings(db, a, {
      kind: "rate",
      version: now.settings.version,
      examination_cents: 500,
      reason: "Restore fixture default",
    }),
  );
});
test("grading: shared batch events reach only selected cards; partial returns preserve other items", async () => {
  const a = (await run("a", gradingCards)).find((c) => c.case_id === caseId)!;
  const b = (await run("b", gradingCards))[0];
  const created = await run("staff", (db, s) =>
    batch(db, s, {
      operation: "create",
      reference: "PRIVATE POOLED REFERENCE",
      provider: "psa",
      carrier: "Example carrier",
      tracking: "PRIVATE TRACKING",
      reason: "Group sample cards",
    }),
  );
  const id = created.id!;
  await run("staff", (db, s) =>
    batch(db, s, {
      operation: "cards",
      id,
      version: 1,
      assign: true,
      cards: [a, b].map((c) => ({ card_id: c.card_id, version: c.version })),
      status_key: "sent_to_grader",
      reason: "Sample shipping recorded",
    }),
  );
  const shipped = await run("a", (db, s) => gradingCard(db, s, a.card_id));
  await run("staff", (db, s) =>
    batch(db, s, {
      operation: "cards",
      id,
      version: 2,
      assign: false,
      cards: [{ card_id: a.card_id, version: shipped.version }],
      status_key: "returned",
      reason: "One sample card physically returned",
    }),
  );
  assert.equal(
    (await run("a", (db, s) => gradingCard(db, s, a.card_id))).status_key,
    "returned",
  );
  assert.equal(
    (await run("b", (db, s) => gradingCard(db, s, b.card_id))).status_key,
    "sent_to_grader",
  );
  const payload = JSON.stringify(await run("a", gradingDashboard));
  assert.ok(!payload.includes("PRIVATE POOLED"));
  assert.ok(!payload.includes("PRIVATE TRACKING"));
  assert.ok(!payload.includes(b.card_id));
  assert.ok(!payload.includes("BGP"));
  assert.deepEqual((await run("a", gradingDashboard)).batches, []);
  await run("a", async (db) => {
    assert.equal(
      (await db.query("select * from ns.grading_batches")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from ns.grading_audit")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from ns.grading_cards where card_id=$1", [
          b.card_id,
        ])
      ).rows.length,
      0,
    );
  });
  await assert.rejects(
    run("a", (db, s) => gradingDetail(db, s, b.card_id)),
    fail(404),
  );
});
test("grading: authenticated submit/return decisions are allowed only at the decision step and are idempotent", async () => {
  const cards = (await run("a", gradingCards)).filter(
    (c) => c.case_id === caseId && c.status_key === "received",
  );
  for (const [index, choice] of ["submit", "return"].entries()) {
    const c = cards[index];
    await run("staff", (db, a) =>
      updateGradingCard(db, a, c.card_id, {
        version: c.version,
        status_key: "awaiting_decision",
        findings: "Sample findings",
        reason: "Exam complete",
      }),
    );
    const body = { version: c.version + 1, choice, request_id: randomUUID() };
    await run("a", (db, a) => decide(db, a, c.card_id, body));
    await run("a", (db, a) => decide(db, a, c.card_id, body));
    const d = await run("a", (db, a) => gradingDetail(db, a, c.card_id));
    assert.equal(
      d.card.status_key,
      choice === "submit" ? "ready_to_submit" : "return_requested",
    );
    assert.equal(d.events.filter((e) => e.source === "customer").length, 1);
    await assert.rejects(
      run("a", (db, a) =>
        decide(db, a, c.card_id, { ...body, request_id: randomUUID() }),
      ),
      /Decision unavailable/,
    );
  }
});
test("grading: customer, content editor and read-only staff cannot write status or intake", async () => {
  const card = (await run("a", gradingCards))[0];
  for (const who of ["a", "reader", "editor"]) {
    await assert.rejects(
      run(who, (db, a) =>
        updateGradingCard(db, a, card.card_id, {
          version: card.version,
          status_key: "completed",
          reason: "Forbidden",
        }),
      ),
      fail(403),
    );
    await assert.rejects(
      run(who, (db, a) =>
        createIntake(db, a, input(), randomUUID(), "Forbidden"),
      ),
      fail(403),
    );
  }
  await run("a", async (db) => {
    const r = await db.query(
      "update ns.grading_cards set status_key='completed' returning card_id",
    );
    assert.equal(r.rows.length, 0);
  });
  await assert.rejects(
    run("a", (db) => db.query("update ns.customers set display_name='hijack'")),
    /permission denied/,
  );
  await assert.rejects(
    run("staff", (db) =>
      db.query("update ns.card_items set customer_id=$1", [previewId(2)]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    fixture.db.query("delete from ns.grading_events"),
    /Append-only/,
  );
});
test("grading: unactivated receipt contact requires code plus independent staff approval", async () => {
  const c = await run("staff", (db, a) =>
    contact(db, a, {
      display_name: "SAMPLE receipt contact",
      reason: "Receipt intake",
    }),
  );
  const i = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      input(c.id, "SAMPLE unclaimed", 1),
      randomUUID(),
      "Receipt received",
    ),
  );
  const card = (await run("staff", gradingCards)).find(
    (c) => c.case_id === i.case_id,
  )!;
  const claim = await run("staff", (db, a) =>
    claimCode(db, a, i.case_id, "Private receipt handoff"),
  );
  await run("a", (db, a) => requestClaim(db, a, claim.code));
  await assert.rejects(
    run("a", (db, a) => gradingCard(db, a, card.card_id)),
    fail(404),
  );
  const request = (await run("staff", gradingDashboard)).claims.find(
    (c) => c.case_id === i.case_id,
  )!;
  await assert.rejects(
    run("staff", (db, a) =>
      reviewClaim(db, a, {
        id: request.id,
        approve: true,
        evidence: "email_match",
        reason: "Unsafe matching",
      }),
    ),
    fail(400),
  );
  await run("staff", (db, a) =>
    reviewClaim(db, a, {
      id: request.id,
      approve: true,
      evidence: "receipt_and_in_person_identity",
      reason: "Sample receipt and independent identity checked",
    }),
  );
  assert.equal(
    (await run("a", (db, a) => gradingCard(db, a, card.card_id))).case_id,
    i.case_id,
  );
  await assert.rejects(
    run("b", (db, a) => gradingCard(db, a, card.card_id)),
    fail(404),
  );
  await run("staff", (db, a) =>
    updateGradingCard(db, a, card.card_id, {
      version: card.version,
      status_key: "awaiting_decision",
      reason: "Examined claimed sample",
    }),
  );
  await run("a", (db, a) =>
    decide(db, a, card.card_id, {
      version: card.version + 1,
      choice: "submit",
      request_id: randomUUID(),
    }),
  );
  await assert.rejects(
    run("a", (db, a) => requestClaim(db, a, "someone@example.test")),
    fail(400),
  );
});
const mapping = Object.fromEntries(gradingFields.map((k) => [k, k]));
let importId = "";
test("grading: CSV maps headers, validates rows, rejects ambiguous customers and duplicate IDs within a file", async () => {
  const template = await readFile("public/samples/grading-intake.csv", "utf8");
  const good = await run("staff", (db, a) =>
    previewImport(db, a, { source: "tests", csv: template, mapping }),
  );
  assert.equal(good.card_count, 4);
  assert.equal(good.subtotal_cents, 2000);
  importId = good.id;
  const bad = template.replace(previewId(1), "email@example.test");
  const invalid = await run("staff", (db, a) =>
    previewImport(db, a, { source: "invalid", csv: bad, mapping }),
  );
  assert.equal(invalid.rows[0].state, "error");
  await assert.rejects(
    run("staff", (db, a) =>
      commitImport(db, a, {
        id: invalid.id,
        confirm: true,
        reason: "Reject invalid rows",
      }),
    ),
    fail(409),
  );
  const repeated = await run("staff", (db, a) =>
    previewImport(db, a, {
      source: "invalid",
      csv: template.replace("SAMPLE-EXAM-002", "SAMPLE-EXAM-001"),
      mapping,
    }),
  );
  assert.equal(repeated.rows[1].state, "error");
  await assert.rejects(
    run("staff", (db, a) =>
      commitImport(db, a, { id: good.id, reason: "Missing review" }),
    ),
    fail(400),
  );
});
test("grading: reviewed imports commit atomically and repeated files never duplicate cards", async () => {
  await run("staff", (db, a) =>
    commitImport(db, a, {
      id: importId,
      confirm: true,
      reason: "Reviewed sample matches",
    }),
  );
  const before = (await run("staff", gradingCards)).length;
  await run("staff", (db, a) =>
    commitImport(db, a, { id: importId, confirm: true, reason: "Retry" }),
  );
  assert.equal((await run("staff", gradingCards)).length, before);
  const csv = await readFile("public/samples/grading-intake.csv", "utf8");
  const p = await run("staff", (db, a) =>
    previewImport(db, a, { source: "tests", csv, mapping }),
  );
  assert.equal(p.card_count, 0);
  assert.ok(p.rows.every((r) => r.state === "duplicate"));
  await run("staff", (db, a) =>
    commitImport(db, a, { id: p.id, confirm: true, reason: "Reviewed repeat" }),
  );
  assert.equal((await run("staff", gradingCards)).length, before);
  const changed = await run("staff", (db, a) =>
    previewImport(db, a, {
      source: "tests",
      csv: csv.replace(
        "SAMPLE ONLY basketball card",
        "Changed customer or description",
      ),
      mapping,
    }),
  );
  assert.equal(changed.rows[0].state, "error");
});
test("grading: reversal retains history and IDs; later activity blocks reversal", async () => {
  await run("staff", (db, a) =>
    reverseImport(db, a, {
      id: importId,
      confirm: true,
      reason: "Undo untouched sample import",
    }),
  );
  const csv = await readFile("public/samples/grading-intake.csv", "utf8");
  const p = await run("staff", (db, a) =>
    previewImport(db, a, { source: "tests", csv, mapping }),
  );
  assert.ok(p.rows.every((r) => r.state === "duplicate"));
  assert.equal(
    (
      await fixture.db.query(
        "select * from ns.grading_intakes where import_id=$1 and voided_at is not null",
        [importId],
      )
    ).rows.length,
    2,
  );
  const later = await run("staff", (db, a) =>
    previewImport(db, a, { source: "later", csv, mapping }),
  );
  await run("staff", (db, a) =>
    commitImport(db, a, {
      id: later.id,
      confirm: true,
      reason: "Reviewed later test",
    }),
  );
  const c = (await run("staff", gradingCards)).find(
    (c) => c.description === "SAMPLE ONLY basketball card" && !c.voided_at,
  )!;
  await run("staff", (db, a) =>
    updateGradingCard(db, a, c.card_id, {
      version: c.version,
      status_key: "examining",
      reason: "Later examination",
    }),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      reverseImport(db, a, {
        id: later.id,
        confirm: true,
        reason: "Must refuse",
      }),
    ),
    fail(409),
  );
});
test("grading: payment references are separate, owned, immutable and cannot duplicate revenue", async () => {
  const c = (await run("a", gradingCards)).find((c) => c.case_id === caseId)!;
  const b = {
    card_id: c.card_id,
    source: "external_staff_record",
    reference: "SAMPLE-EXTERNAL-001",
    recorded_date: "2026-09-01",
    amount_cents: 1500,
    reason: "Sample external receipt",
  };
  await run("staff", (db, a) => payment(db, a, b));
  await assert.rejects(
    run("staff", (db, a) => payment(db, a, b)),
    /unique constraint/,
  );
  await assert.rejects(
    run("staff", (db, a) =>
      payment(db, a, {
        ...b,
        source: "shopify_order_link",
        reference: "gid://shopify/Order/999",
      }),
    ),
    fail(409),
  );
  assert.equal(
    (await fixture.db.query("select * from ns.order_ledger")).rows.length,
    0,
  );
  const detail = await run("a", (db, a) => gradingDetail(db, a, c.card_id));
  assert.equal(detail.payments[0].amount_cents, 1500);
  assert.ok(!JSON.stringify(detail).includes("SAMPLE-EXTERNAL-001"));
  assert.ok(!JSON.stringify(detail).includes("Sample external receipt"));
});
test("grading: exports neutralize formulas; sample image authorization follows physical-card ownership", async () => {
  const i = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      input(previewId(1), '=HYPERLINK("https://example.test")', 1),
      randomUUID(),
      "Formula sample",
    ),
  );
  assert.ok((await run("a", gradingExport)).includes("'=HYPERLINK"));
  const c = (await run("a", gradingCards)).find(
    (c) => c.case_id === i.case_id,
  )!;
  const request = new Request("http://127.0.0.1:3000/api/preview/grading", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "sample-image", card_id: c.card_id }),
  });
  const file = (await run("staff", (db, a) =>
    gradingApi(request, db, a, true),
  )) as { id: string };
  assert.deepEqual(
    await run("a", (db, a) =>
      gradingApi(
        new Request(
          "http://127.0.0.1:3000/api/preview/grading?file=" + file.id,
        ),
        db,
        a,
        true,
      ),
    ),
    { url: "/grading-sample.svg" },
  );
  await assert.rejects(
    run("b", (db, a) =>
      gradingApi(
        new Request(
          "http://127.0.0.1:3000/api/preview/grading?file=" + file.id,
        ),
        db,
        a,
        true,
      ),
    ),
    fail(404),
  );
});
test("grading: claimed intakes can link only their verified owner's reconciled Shopify order", async () => {
  const c = (await run("a", gradingCards)).find(
    (c) => c.description === "SAMPLE unclaimed",
  )!;
  await fixture.db.query(
    "insert into ns.shopify_customers(tenant_id,customer_id,shop,shopify_id) values($1,$2,'9i3hnb-jw.myshopify.com','gid://shopify/Customer/100')",
    [TENANT, previewId(1)],
  );
  await fixture.db.query(
    "insert into ns.shopify_orders(tenant_id,shop,order_id,shopify_customer_id,name,financial_status,currency,total_cents,received_cents,refunded_cents,provider_updated_at,fingerprint) values($1,'9i3hnb-jw.myshopify.com','gid://shopify/Order/100','gid://shopify/Customer/100','TEST ORDER ONLY','PAID','USD',500,500,0,now(),'LOCAL TEST')",
    [TENANT],
  );
  const body = {
    card_id: c.card_id,
    source: "shopify_order_link",
    reference: "gid://shopify/Order/100",
    recorded_date: "2026-09-01",
    reason: "Verified owned test order linkage",
  };
  const foreign = (await run("b", gradingCards))[0];
  await assert.rejects(
    run("staff", (db, a) =>
      payment(db, a, { ...body, card_id: foreign.card_id }),
    ),
    fail(409),
  );
  await run("staff", (db, a) => payment(db, a, body));
  const detail = await run("a", (db, a) => gradingDetail(db, a, c.card_id));
  assert.equal(detail.payments[0].amount_cents, null);
  assert.equal(detail.payments[0].source, "shopify_order_link");
  assert.equal(
    (await fixture.db.query("select * from ns.order_ledger")).rows.length,
    0,
  );
});
test("grading: closed database reopens with intakes, decisions, payments and import history intact", async () => {
  const before = await run("a", gradingCards);
  const count = (
    await fixture.db.query("select count(*) from ns.grading_events")
  ).rows;
  await fixture.db.close();
  fixture = await openPreviewDatabase(directory);
  assert.equal((await run("a", gradingCards)).length, before.length);
  assert.deepEqual(
    (await fixture.db.query("select count(*) from ns.grading_events")).rows,
    count,
  );
  assert.equal(
    (
      await fixture.db.query<{ n: number }>(
        "select count(*) as n from ns.grading_payments",
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await fixture.db.query<{ status: string }>(
        "select status from ns.imports where tenant_id=$1 and id=$2",
        [TENANT, importId],
      )
    ).rows[0].status,
    "reversed",
  );
});
test.after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
});
