/** Independent adversarial acceptance tests. Copy into apps/customer/tests/.
 * Explicit local PGlite SAMPLE records only. No provider calls or env-file reads.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  createIntake,
  gradingCards,
  gradingCard,
  updateGradingCard,
  claimCode,
  requestClaim,
  reviewClaim,
  gradingDashboard,
} from "../lib/server/grading";
import { batch, contact } from "../lib/server/grading-operations";
import {
  createConsignment,
  consignmentItem,
  consignmentDetail,
  updateConsignment,
} from "../lib/server/consignment";
import {
  authorizedExamPhoto,
  completeExamPhoto,
  prepareExamPhoto,
} from "../lib/server/exam";
import { photoHash } from "../lib/server/exam-storage";
import { AccessError } from "../lib/server/security";
import {
  trackingList,
  trackingDetail,
  serviceTermsState,
  publishServiceTerms,
  acceptServiceTerms,
} from "../lib/server/card-tracking";
import { memoryPhotoStore, prepareExam } from "./support/grading-exam-fixture";

const directory = await mkdtemp(
  join(tmpdir(), "northside-tracking-adversarial-"),
);
let fixture = await openPreviewDatabase(join(directory, "database"));
const run = <T>(who: string, fn: Parameters<typeof fixture.run<T>>[1]) =>
  fixture.run(who, fn);
const store = memoryPhotoStore();
const PRIVATE = "PRIVATE-SHARED-PROVIDER-ORDER-DO-NOT-DISCLOSE";
const FAIL = (status: number) => (error: unknown) =>
  error instanceof AccessError && error.status === status;
const isDate = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const intakeInput = (customer: string, description: string, quantity = 1) => ({
  customer_id: customer,
  description,
  quantity,
  sport: "SAMPLE",
  year: "2025",
  manufacturer: "SAMPLE",
  card_set: "SAMPLE",
  card_number: "SAMPLE",
  parallel: "SAMPLE",
  received_date: "2026-09-01",
});
const aIntake = await run("staff", (db, actor) =>
  createIntake(
    db,
    actor,
    intakeInput(previewId(1), "SAMPLE A owned tracking card", 2),
    randomUUID(),
    "SAMPLE actual intake",
  ),
);
const bIntake = await run("staff", (db, actor) =>
  createIntake(
    db,
    actor,
    intakeInput(previewId(2), "SAMPLE B private tracking card"),
    randomUUID(),
    "SAMPLE actual intake",
  ),
);
const allGrading = await run("staff", gradingCards);
const aIds = allGrading
  .filter((card) => card.case_id === aIntake.case_id)
  .map((card) => card.card_id)
  .sort();
const bId = allGrading.find(
  (card) => card.case_id === bIntake.case_id,
)!.card_id;
const sharedBatch = await run("staff", (db, actor) =>
  batch(db, actor, {
    operation: "create",
    provider: "psa",
    reference: PRIVATE,
    carrier: "PRIVATE CARRIER",
    tracking: PRIVATE,
    service: "SAMPLE unshipped preparation only",
    reason: "PRIVATE INTERNAL BATCH REASON",
  }),
);
await run("staff", async (db, actor) =>
  batch(db, actor, {
    operation: "cards",
    id: sharedBatch.id,
    version: 1,
    assign: true,
    status_key: "received",
    cards: await Promise.all(
      [...aIds, bId].map(async (card_id) => ({
        card_id,
        version: (await gradingCard(db, actor, card_id)).version,
      })),
    ),
    reason: "PRIVATE MIXED OWNER ASSIGNMENT",
  }),
);
const consign = async (customer: string, title: string) =>
  run("staff", (db, actor) =>
    createConsignment(db, actor, {
      customer_id: customer,
      request_id: randomUUID(),
      description: title,
      received_date: "2026-09-01",
      currency: "USD",
      state_key: "received",
      provider_reference: PRIVATE,
      provider_card_reference:
        customer === previewId(1) ? "SAMPLE-A-CARD-REF" : "SAMPLE-B-CARD-REF",
      submission_reference: PRIVATE,
      listing_reference: "PRIVATE SHARED LISTING",
      customer_notes: "SAMPLE customer-visible consignment note",
      reason: "PRIVATE CONSIGNMENT INTAKE REASON",
    }),
  );
const aConsignment = await consign(previewId(1), "SAMPLE A owned consignment");
const bConsignment = await consign(
  previewId(2),
  "SAMPLE B private consignment",
);
const aConsignmentCard = (
  await run("a", (db, actor) => consignmentItem(db, actor, aConsignment.id))
).card_id;
const bConsignmentCard = (
  await run("b", (db, actor) => consignmentItem(db, actor, bConsignment.id))
).card_id;

function customerSafe(value: unknown) {
  const forbidden = new Set([
    "tenant_id",
    "customer_id",
    "staff_id",
    "batch_id",
    "dispatch_id",
    "manifest",
    "submission_reference",
    "listing_reference",
    "internal_notes",
    "revision_reasons",
    "approval_reference",
    "published_by",
    "object_key",
    "source_hash",
    "stored_hash",
    "encrypted_tokens",
    "access_token",
    "refresh_token",
    "session_hash",
    "token_hash",
  ]);
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      assert.equal(
        forbidden.has(key),
        false,
        `Private customer projection key ${key}`,
      );
      walk(child);
    }
  }
  walk(value);
  const serialized = JSON.stringify(value);
  for (const marker of [
    PRIVATE,
    "PRIVATE CARRIER",
    "PRIVATE EXAM INTERNAL NOTES",
    "PRIVATE MIXED OWNER",
    "PRIVATE CONSIGNMENT INTAKE REASON",
  ])
    assert.equal(
      serialized.includes(marker),
      false,
      `Private marker disclosed: ${marker}`,
    );
}
const publish = (
  service: "grading" | "consignment",
  version: string,
  previous_id: string | null = null,
  overrides: Record<string, unknown> = {},
) =>
  run("staff", (db, actor) =>
    publishServiceTerms(db, actor, {
      service,
      version,
      title: "SAMPLE test terms — not approved legal policy",
      body: `SAMPLE isolated acceptance content ${service}/${version}. No real terms are activated.`,
      approval_reference: "SAMPLE TEST APPROVAL REFERENCE ONLY",
      previous_id,
      ...overrides,
    }),
  );
const accept = (
  who: string,
  service: "grading" | "consignment",
  terms_id: string,
  card_id: string,
  extra: Record<string, unknown> = {},
) =>
  run(who, (db, actor) =>
    acceptServiceTerms(db, actor, {
      service,
      terms_id,
      card_id,
      confirmed: true,
      ...extra,
    }),
  );
let gradingTerms = "",
  consignmentTerms = "",
  revisedGradingTerms = "";
let acceptedAt = "";

test("tracking adversarial: physical intake persists with terms unconfigured and remains unpaid", async () => {
  const view = await run("a", (db, actor) =>
    trackingList(db, actor, "grading"),
  );
  assert.equal(view.terms.current, null);
  assert.equal(view.terms.acceptedAt, null);
  for (const id of aIds) assert.ok(view.cards.some((card) => card.id === id));
  assert.equal(view.cards.filter((card) => aIds.includes(card.id)).length, 2);
  const payments = await fixture.db.query(
    "select id from ns.grading_payments where case_id=$1",
    [aIntake.case_id],
  );
  assert.equal(payments.rows.length, 0);
  customerSafe(view);
});

test("tracking adversarial: customers sharing a provider batch see only their own physical records", async () => {
  const a = await run("a", (db, actor) => trackingList(db, actor, "grading"));
  const b = await run("b", (db, actor) => trackingList(db, actor, "grading"));
  assert.ok(a.cards.some((card) => card.id === aIds[0]));
  assert.equal(
    a.cards.some((card) => card.id === bId),
    false,
  );
  assert.ok(b.cards.some((card) => card.id === bId));
  assert.equal(
    b.cards.some((card) => aIds.includes(card.id)),
    false,
  );
  for (const id of aIds)
    await assert.rejects(
      run("b", (db, actor) => trackingDetail(db, actor, "grading", id)),
      FAIL(404),
    );
  await assert.rejects(
    run("a", (db, actor) => trackingDetail(db, actor, "grading", bId)),
    FAIL(404),
  );
  customerSafe(a);
  customerSafe(b);
});

test("tracking adversarial: grading status/history are current, dated and exclude staff reasons", async () => {
  const card = await run("staff", (db, actor) =>
    gradingCard(db, actor, aIds[0]),
  );
  await run("staff", (db, actor) =>
    updateGradingCard(db, actor, aIds[0], {
      version: card.version,
      status_key: "examining",
      customer_notes: "SAMPLE visible owner update",
      provider_card_reference: "SAMPLE-A-GRADING-REF",
      reason: "PRIVATE INTERNAL STATUS INVESTIGATION",
    }),
  );
  const result = await run("a", (db, actor) =>
    trackingDetail(db, actor, "grading", aIds[0]),
  );
  assert.equal(result.card.status, "Examination in progress");
  assert.equal(result.card.customerNotes, "SAMPLE visible owner update");
  assert.equal(result.card.providerCardReference, "SAMPLE-A-GRADING-REF");
  assert.ok(isDate(result.card.recordedAt));
  assert.ok(
    result.card.history.some(
      (event) => event.label === "Examination in progress",
    ),
  );
  assert.ok(result.card.history.every((event) => isDate(event.occurredAt)));
  assert.equal(
    JSON.stringify(result).includes("PRIVATE INTERNAL STATUS INVESTIGATION"),
    false,
  );
  customerSafe(result);
});

test("tracking adversarial: consignment is not duplicated or broadened by a shared submission reference", async () => {
  const a = await run("a", (db, actor) =>
    trackingList(db, actor, "consignment"),
  );
  assert.equal(a.cards.filter((card) => card.id === aConsignment.id).length, 1);
  assert.equal(
    a.cards.some(
      (card) => card.id === bConsignment.id || aIds.includes(card.id),
    ),
    false,
  );
  const result = await run("a", (db, actor) =>
    trackingDetail(db, actor, "consignment", aConsignment.id),
  );
  assert.equal(result.card.cardId, aConsignmentCard);
  assert.equal(result.card.providerCardReference, "SAMPLE-A-CARD-REF");
  const legacy = await run("a", (db, actor) =>
    consignmentDetail(db, actor, aConsignment.id),
  );
  assert.equal(legacy.item.provider_reference, null);
  assert.equal(legacy.item.submission_reference, "");
  assert.equal(legacy.item.listing_reference, "");
  assert.equal(result.card.receivedDate, "2026-09-01");
  assert.ok(result.card.history.every((event) => isDate(event.occurredAt)));
  await assert.rejects(
    run("b", (db, actor) =>
      trackingDetail(db, actor, "consignment", aConsignment.id),
    ),
    FAIL(404),
  );
  await assert.rejects(
    run("a", (db, actor) =>
      trackingDetail(db, actor, "consignment", bConsignment.id),
    ),
    FAIL(404),
  );
  await assert.rejects(
    run("a", (db, actor) =>
      trackingDetail(db, actor, "grading", aConsignmentCard),
    ),
    FAIL(404),
  );
  await assert.rejects(
    run("a", (db, actor) => trackingDetail(db, actor, "consignment", aIds[0])),
    FAIL(404),
  );
  customerSafe(a);
  customerSafe(result);
});

test("tracking adversarial: staff consignment updates persist as owned dated history without paying", async () => {
  const before = await run("staff", (db, actor) =>
    consignmentItem(db, actor, aConsignment.id),
  );
  await run("staff", (db, actor) =>
    updateConsignment(db, actor, aConsignment.id, {
      version: before.version,
      state_key: "preparing",
      reason: "PRIVATE OWNED CONSIGNMENT UPDATE",
    }),
  );
  const result = await run("a", (db, actor) =>
    trackingDetail(db, actor, "consignment", aConsignment.id),
  );
  assert.equal(result.card.status, "Preparing submission");
  assert.ok(
    result.card.history.some((event) => event.label === "Preparing submission"),
  );
  assert.equal(
    (await run("a", (db, actor) => consignmentItem(db, actor, aConsignment.id)))
      .payout_status,
    "unknown",
  );
  customerSafe(result);
});

test("tracking adversarial: customer and non-operational staff cannot mutate tracking or intake", async () => {
  for (const who of ["a", "b", "reader", "editor"]) {
    await assert.rejects(
      run(who, (db, actor) =>
        createIntake(
          db,
          actor,
          intakeInput(previewId(1), "SAMPLE forbidden intake"),
          randomUUID(),
          "SAMPLE forbidden",
        ),
      ),
      FAIL(403),
    );
    await assert.rejects(
      run(who, (db, actor) =>
        updateGradingCard(db, actor, aIds[0], {
          version: 1,
          status_key: "completed",
          reason: "SAMPLE forbidden shortcut",
        }),
      ),
      FAIL(403),
    );
  }
});

test("tracking adversarial: published photos remain exact-card scoped; paper and private exam notes stay private", async () => {
  await prepareExam(fixture, aIds[0], store);
  const bytes = await sharp({
    create: { width: 40, height: 60, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const paper = await run("staff", (db, actor) =>
    prepareExamPhoto(db, actor, aIds[0], {
      kind: "paper",
      source_hash: photoHash(bytes),
      request_id: randomUUID(),
    }),
  );
  await run("staff", (db, actor) =>
    completeExamPhoto(db, actor, aIds[0], paper.id, bytes, "image/png", store),
  );
  const result = await run("a", (db, actor) =>
    trackingDetail(db, actor, "grading", aIds[0]),
  );
  assert.equal(
    result.card.photos.filter((photo) => photo.format === "grading").length,
    2,
  );
  assert.equal(
    result.card.photos.some((photo) => photo.id === paper.id),
    false,
  );
  const photo = result.card.photos[0];
  await run("a", (db, actor) =>
    authorizedExamPhoto(db, actor, aIds[0], photo.id),
  );
  await assert.rejects(
    run("b", (db, actor) => authorizedExamPhoto(db, actor, aIds[0], photo.id)),
    FAIL(404),
  );
  await assert.rejects(
    run("a", (db, actor) => authorizedExamPhoto(db, actor, aIds[1], photo.id)),
    FAIL(404),
  );
  await assert.rejects(
    run("a", (db, actor) => authorizedExamPhoto(db, actor, aIds[0], paper.id)),
    FAIL(404),
  );
  customerSafe(result);
});

test("tracking adversarial: unconfirmed photographs never become customer tracking refs", async () => {
  const pending = await run("staff", (db, actor) =>
    prepareExamPhoto(db, actor, aIds[1], {
      kind: "front",
      source_hash: "a".repeat(64),
      request_id: randomUUID(),
    }),
  );
  const result = await run("a", (db, actor) =>
    trackingDetail(db, actor, "grading", aIds[1]),
  );
  assert.equal(
    result.card.photos.some((photo) => photo.id === pending.id),
    false,
  );
  await assert.rejects(
    run("a", (db, actor) =>
      authorizedExamPhoto(db, actor, aIds[1], pending.id),
    ),
    FAIL(404),
  );
});

test("tracking adversarial: exact approved receipt claim grants one grading case only", async () => {
  const receiptContact = await run("staff", (db, actor) =>
    contact(db, actor, {
      display_name: "SAMPLE unactivated receipt contact",
      reason: "SAMPLE physical intake",
    }),
  );
  const receipt = await run("staff", (db, actor) =>
    createIntake(
      db,
      actor,
      intakeInput(receiptContact.id, "SAMPLE claim-owned exact case"),
      randomUUID(),
      "SAMPLE receipt intake",
    ),
  );
  const owned = (await run("staff", gradingCards)).find(
    (card) => card.case_id === receipt.case_id,
  )!;
  const code = await run("staff", (db, actor) =>
    claimCode(db, actor, receipt.case_id, "SAMPLE private receipt handoff"),
  );
  await run("a", (db, actor) => requestClaim(db, actor, code.code));
  await assert.rejects(
    run("a", (db, actor) =>
      trackingDetail(db, actor, "grading", owned.card_id),
    ),
    FAIL(404),
  );
  const request = (await run("staff", gradingDashboard)).claims.find(
    (claim) => claim.case_id === receipt.case_id,
  )!;
  await run("staff", (db, actor) =>
    reviewClaim(db, actor, {
      id: request.id,
      approve: true,
      evidence: "receipt_and_in_person_identity",
      reason: "SAMPLE independent verification",
    }),
  );
  assert.equal(
    (
      await run("a", (db, actor) =>
        trackingDetail(db, actor, "grading", owned.card_id),
      )
    ).card.id,
    owned.card_id,
  );
  await assert.rejects(
    run("b", (db, actor) =>
      trackingDetail(db, actor, "grading", owned.card_id),
    ),
    FAIL(404),
  );
  await assert.rejects(
    run("a", (db, actor) =>
      trackingDetail(db, actor, "consignment", bConsignment.id),
    ),
    FAIL(404),
  );
});

test("tracking adversarial: only owner/admin may publish explicit complete terms", async () => {
  for (const who of ["a", "b", "reader", "editor"])
    await assert.rejects(
      run(who, (db, actor) =>
        publishServiceTerms(db, actor, {
          service: "grading",
          version: "SAMPLE forbidden",
          title: "SAMPLE",
          body: "SAMPLE",
          approval_reference: "SAMPLE",
          previous_id: null,
        }),
      ),
      FAIL(403),
    );
  for (const missing of ["version", "title", "body", "approval_reference"])
    await assert.rejects(
      publish("grading", "SAMPLE v1", null, { [missing]: "" }),
      FAIL(400),
    );
  gradingTerms = (await publish("grading", "SAMPLE v1")).id;
  consignmentTerms = (await publish("consignment", "SAMPLE c1")).id;
  const state = await run("a", (db, actor) =>
    serviceTermsState(db, actor, "grading"),
  );
  assert.equal(state.current?.id, gradingTerms);
  assert.equal(state.acceptedAt, null);
  customerSafe(state);
});

test("tracking adversarial: operations role cannot publish through application or direct SQL", async () => {
  await fixture.db.query(
    "update ns.staff_memberships set role='operations' where id=$1",
    [previewId(10)],
  );
  try {
    await assert.rejects(
      publish("grading", "SAMPLE forbidden operations", gradingTerms),
      FAIL(403),
    );
    await assert.rejects(
      run("staff", (db) =>
        db.query(
          "select ns.publish_service_terms('grading','SAMPLE forged operations','SAMPLE','SAMPLE','SAMPLE',$1)",
          [gradingTerms],
        ),
      ),
      /Terms publisher permission required/,
    );
  } finally {
    await fixture.db.query(
      "update ns.staff_memberships set role='owner' where id=$1",
      [previewId(10)],
    );
  }
});

test("tracking adversarial: terms content and version are immutable, replay is idempotent", async () => {
  assert.equal((await publish("grading", "SAMPLE v1")).id, gradingTerms);
  await assert.rejects(
    publish("grading", "SAMPLE v1", null, { body: "SAMPLE altered terms" }),
    FAIL(409),
  );
  await assert.rejects(
    fixture.db.query(
      "update ns.service_terms set body='SAMPLE changed' where id=$1",
      [gradingTerms],
    ),
    /Append-only/,
  );
  await assert.rejects(
    fixture.db.query("delete from ns.service_terms where id=$1", [
      gradingTerms,
    ]),
    /Append-only/,
  );
});

test("tracking adversarial: acceptance requires explicit confirmation and strict server-owned identity", async () => {
  await assert.rejects(
    accept("a", "grading", gradingTerms, aIds[0], { confirmed: false }),
    FAIL(400),
  );
  for (const forged of [
    { customer_id: previewId(2) },
    { accepted_at: "2000-01-01T00:00:00Z" },
    { version: "forged" },
  ])
    await assert.rejects(
      accept("a", "grading", gradingTerms, aIds[0], forged),
      FAIL(400),
    );
  for (const who of ["staff", "reader", "editor"])
    await assert.rejects(
      accept(who, "grading", gradingTerms, aIds[0]),
      FAIL(403),
    );
  await assert.rejects(
    accept("b", "grading", gradingTerms, aIds[0]),
    FAIL(409),
  );
  await assert.rejects(accept("a", "grading", gradingTerms, bId), FAIL(409));
  await assert.rejects(
    accept("a", "grading", gradingTerms, aConsignmentCard),
    FAIL(409),
  );
  await assert.rejects(
    accept("a", "consignment", gradingTerms, aConsignmentCard),
    FAIL(409),
  );
  await assert.rejects(
    accept("a", "consignment", consignmentTerms, bConsignmentCard),
    FAIL(409),
  );
});

test("tracking adversarial: acceptance records authenticated customer and stable server date exactly once", async () => {
  const before = Date.now();
  const accepted = await accept("a", "grading", gradingTerms, aIds[0]);
  assert.ok(isDate(accepted.acceptedAt));
  acceptedAt = accepted.acceptedAt!;
  assert.ok(Date.parse(acceptedAt) >= before - 1000);
  assert.ok(Date.parse(acceptedAt) <= Date.now() + 1000);
  const repeated = await accept("a", "grading", gradingTerms, aIds[1]);
  assert.equal(repeated.acceptedAt, acceptedAt);
  const rows = (
    await fixture.db.query<{
      customer_id: string;
      terms_id: string;
      first_card_id: string;
      accepted_at: string;
    }>(
      "select customer_id,terms_id,first_card_id,accepted_at from ns.service_terms_acceptances where terms_id=$1",
      [gradingTerms],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_id, previewId(1));
  assert.equal(rows[0].first_card_id, aIds[0]);
  const b = await run("b", (db, actor) =>
    serviceTermsState(db, actor, "grading"),
  );
  assert.equal(b.acceptedAt, null);
  await run("b", async (db) => {
    assert.equal(
      (
        await db.query(
          "select id from ns.service_terms_acceptances where terms_id=$1",
          [gradingTerms],
        )
      ).rows.length,
      0,
    );
  });
});

test("tracking adversarial: direct runtime SQL cannot forge actor acceptance or rewrite evidence", async () => {
  await assert.rejects(
    run("a", (db) =>
      db.query(
        "insert into ns.service_terms_acceptances(tenant_id,customer_id,service,terms_id,version,first_card_id) values($1,$2,'grading',$3,'SAMPLE v1',$4)",
        [previewId(999), previewId(2), gradingTerms, bId],
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    run("b", (db) =>
      db.query("select ns.accept_service_terms('grading',$1,$2)", [
        gradingTerms,
        aIds[0],
      ]),
    ),
    /Owned service card required/,
  );
  await assert.rejects(
    run("staff", (db) =>
      db.query("select ns.accept_service_terms('grading',$1,$2)", [
        gradingTerms,
        aIds[0],
      ]),
    ),
    /Verified customer acceptance required/,
  );
  await assert.rejects(
    fixture.db.query(
      "update ns.service_terms_acceptances set accepted_at=now() where terms_id=$1",
      [gradingTerms],
    ),
    /Append-only/,
  );
  await assert.rejects(
    fixture.db.query(
      "delete from ns.service_terms_acceptances where terms_id=$1",
      [gradingTerms],
    ),
    /Append-only/,
  );
});

test("tracking adversarial: new terms require current-version review and do not rewrite old consent", async () => {
  await assert.rejects(publish("grading", "SAMPLE v2", null), FAIL(409));
  revisedGradingTerms = (await publish("grading", "SAMPLE v2", gradingTerms))
    .id;
  const state = await run("a", (db, actor) =>
    serviceTermsState(db, actor, "grading"),
  );
  assert.equal(state.current?.id, revisedGradingTerms);
  assert.equal(state.acceptedAt, null);
  await assert.rejects(
    accept("a", "grading", gradingTerms, aIds[0]),
    FAIL(409),
  );
  const historic = (
    await fixture.db.query<{ accepted_at: string }>(
      "select accepted_at from ns.service_terms_acceptances where terms_id=$1",
      [gradingTerms],
    )
  ).rows;
  assert.equal(new Date(historic[0].accepted_at).toISOString(), acceptedAt);
  assert.ok(
    (await accept("a", "grading", revisedGradingTerms, aIds[0])).acceptedAt,
  );
  assert.equal(
    (await fixture.db.query("select id from ns.grading_approval_requests")).rows
      .length,
    0,
  );
  assert.equal(
    (await fixture.db.query("select id from ns.grading_payments")).rows.length,
    0,
  );
});

test("tracking adversarial: service terms cannot cross into another service or customer", async () => {
  assert.ok(
    (await accept("a", "consignment", consignmentTerms, aConsignmentCard))
      .acceptedAt,
  );
  assert.equal(
    (await run("b", (db, actor) => serviceTermsState(db, actor, "consignment")))
      .acceptedAt,
    null,
  );
  assert.equal(
    (await run("a", (db, actor) => serviceTermsState(db, actor, "grading")))
      .current?.id,
    revisedGradingTerms,
  );
  for (const invalid of ["staff", "all", "GRADING", "", null])
    await assert.rejects(
      run("a", (db, actor) => trackingList(db, actor, invalid)),
      FAIL(400),
    );
  await assert.rejects(
    run("a", (db, actor) => trackingDetail(db, actor, "grading", "not-a-uuid")),
    FAIL(400),
  );
});

test("tracking adversarial: reopening database preserves owned history, photos and immutable acceptances", async () => {
  const before = await run("a", (db, actor) =>
    trackingDetail(db, actor, "grading", aIds[0]),
  );
  await fixture.db.close();
  fixture = await openPreviewDatabase(join(directory, "database"));
  const afterReopen = await run("a", (db, actor) =>
    trackingDetail(db, actor, "grading", aIds[0]),
  );
  assert.deepEqual(afterReopen, before);
  assert.equal(afterReopen.card.photos.length, 2);
  assert.equal(
    (
      await fixture.db.query(
        "select id from ns.service_terms_acceptances where customer_id=$1",
        [previewId(1)],
      )
    ).rows.length,
    3,
  );
  assert.equal(
    (await fixture.db.query("select 1 from ns.grading_dispatches")).rows.length,
    0,
  );
  assert.equal(
    (await fixture.db.query("select id from ns.grading_payments")).rows.length,
    0,
  );
  customerSafe(afterReopen);
});

after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
});
