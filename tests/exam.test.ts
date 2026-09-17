import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import { createIntake, gradingCards } from "../lib/server/grading";
import { authorizeOn, type Sql } from "../lib/server/db";
import {
  examFields,
  examWorkspace,
  prepareExamPhoto,
  completeExamPhoto,
  authorizedExamPhoto,
  saveExamDraft,
  publishExam,
  removeExamPhoto,
  verifyStoredPhoto,
} from "../lib/server/exam";
import {
  normalizePhoto,
  photoBytes,
  photoHash,
  localPhotoStore,
  examPhotoStore,
  type PhotoStore,
} from "../lib/server/exam-storage";
import { examReport } from "../lib/server/exam-report";
import { blankExam, MAX_PHOTO_BYTES, type PhotoKind } from "../lib/exam";
import { AccessError, hashToken, opaqueToken } from "../lib/server/security";
import { TENANT } from "../lib/server/providers";
const directory = await mkdtemp(join(tmpdir(), "northside-exam-"));
let fixture = await openPreviewDatabase(join(directory, "db"));
const run = <T>(who: string, fn: Parameters<typeof fixture.run<T>>[1]) =>
  fixture.run(who, fn);
const store = localPhotoStore(join(directory, "photos"));
const fail = (status: number) => (e: unknown) =>
  e instanceof AccessError && e.status === status;
const input = {
  customer_id: previewId(1),
  description: "SAMPLE Northside Exam <script>unsafe</script>",
  quantity: 1,
  sport: "",
  year: "",
  manufacturer: "",
  card_set: "",
  card_number: "",
  parallel: "",
};
const intake = await run("staff", (db, a) =>
  createIntake(db, a, input, randomUUID(), "SAMPLE receipt before photos"),
);
const card = (await run("staff", gradingCards)).find(
  (c) => c.case_id === intake.case_id,
)!;
const front = await sharp({
  create: { width: 120, height: 200, channels: 3, background: "blue" },
})
  .jpeg()
  .toBuffer();
const back = await sharp({
  create: { width: 120, height: 200, channels: 3, background: "green" },
})
  .png()
  .toBuffer();
const prepare = (
  kind: PhotoKind,
  bytes: Uint8Array,
  request_id = randomUUID(),
) =>
  run("staff", (db, a) =>
    prepareExamPhoto(db, a, card.card_id, {
      kind,
      source_hash: photoHash(bytes),
      request_id,
    }),
  );
const upload = (
  id: string,
  bytes = front,
  mime = "image/jpeg",
  adapter = store,
) =>
  run("staff", (db, a) =>
    completeExamPhoto(db, a, card.card_id, id, bytes, mime, adapter),
  );
const workspace = () =>
  run("staff", (db, a) => examWorkspace(db, a, card.card_id));
const fields = {
  ...blankExam,
  centering: 6,
  surface: 7,
  edges: 8,
  corners: 9,
  notes: "Public finding: corner wear <b>literal</b>",
  projected_grade: "Examiner estimate: 8.5",
};
let frontId = "",
  backId = "",
  paperId = "",
  publishedId = "";

test("exam: blank scores and missing photos; received card exists independently of files", async () => {
  const data = await workspace();
  assert.deepEqual(data.draft?.fields, blankExam);
  assert.equal(data.photos_complete, false);
  assert.equal(
    (await run("staff", gradingCards)).find((c) => c.card_id === card.card_id)
      ?.photos_complete,
    false,
  );
  assert.equal(data.revisions.length, 0);
});
test("exam: strict integer scores and explicit manual estimate never derive an average", () => {
  for (const value of [0, 11, 1.5, "7", NaN])
    assert.throws(() => examFields({ ...fields, centering: value }), fail(400));
  assert.throws(
    () => examFields({ ...fields, unable_to_estimate: true }),
    fail(400),
  );
  assert.equal(examFields(fields).projected_grade, "Examiner estimate: 8.5");
  assert.equal(examFields({ ...blankExam, centering: 10 }).projected_grade, "");
});
test("exam: drafts are durable but hidden from customers and read-only staff", async () => {
  await run("staff", (db, a) =>
    saveExamDraft(db, a, card.card_id, {
      version: 0,
      fields,
      internal_notes: "PRIVATE NEVER IN REPORT",
    }),
  );
  const data = await workspace();
  assert.equal(data.draft?.fields.projected_grade, fields.projected_grade);
  for (const who of ["a", "reader"]) {
    const view = await run(who, (db, a) => examWorkspace(db, a, card.card_id));
    assert.equal(view.draft, null);
    assert.equal(view.revisions.length, 0);
    assert.ok(!JSON.stringify(view).includes("PRIVATE"));
    assert.equal(
      (await run(who, (db) => db.query("select * from ns.grading_exam_drafts")))
        .rows.length,
      0,
    );
  }
  await assert.rejects(
    run("staff", (db, a) =>
      saveExamDraft(db, a, card.card_id, { version: 0, fields }),
    ),
    fail(409),
  );
});
test("exam: publishing is refused before storage confirmation and signature", async () => {
  const version = (await workspace()).draft!.version;
  await assert.rejects(
    run("staff", (db, a) =>
      publishExam(
        db,
        a,
        card.card_id,
        { version, reason: "Reviewed", signoff: false },
        store,
      ),
    ),
    fail(400),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      publishExam(
        db,
        a,
        card.card_id,
        { version, reason: "Reviewed", signoff: true },
        store,
      ),
    ),
    fail(409),
  );
});
test("photos: full decoding, type/size/pixel bounds and EXIF orientation; metadata stripped", async () => {
  await assert.rejects(normalizePhoto(front, "image/heic"), fail(415));
  await assert.rejects(normalizePhoto(front, "image/png"), fail(415));
  await assert.rejects(
    normalizePhoto(Buffer.from([255, 216, 255, 0]), "image/jpeg"),
    fail(415),
  );
  await assert.rejects(
    normalizePhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1), "image/jpeg"),
    fail(413),
  );
  const huge = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(normalizePhoto(huge, "image/png"), fail(415));
  const rotated = await sharp(front)
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const normalized = await normalizePhoto(rotated, "image/jpeg");
  assert.equal(normalized.width, 200);
  assert.equal(normalized.height, 120);
  const metadata = await sharp(normalized.bytes).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  await assert.rejects(
    photoBytes(
      new Request("http://test.invalid", {
        method: "PUT",
        body: stream,
        duplex: "half",
      } as RequestInit),
    ),
    fail(413),
  );
});
test("photos: failed upload preserves receipt; successful-looking upload without stored bytes is not complete", async () => {
  const p = await prepare("front", front);
  frontId = p.id;
  const count = (await run("staff", gradingCards)).length;
  const unavailable: PhotoStore = {
    put: async () => {
      throw new AccessError(503, "offline");
    },
    read: store.read,
  };
  await assert.rejects(
    upload(frontId, front, "image/jpeg", unavailable),
    fail(503),
  );
  const lyingStore: PhotoStore = {
    put: async () => {},
    read: async () => new Uint8Array(),
  };
  await assert.rejects(
    upload(frontId, front, "image/jpeg", lyingStore),
    fail(503),
  );
  const data = await workspace();
  assert.equal(data.photos[0].ready, false);
  assert.equal(data.photos_complete, false);
  assert.equal((await run("staff", gradingCards)).length, count);
  await assert.rejects(
    run("a", (db, a) => authorizedExamPhoto(db, a, card.card_id, frontId)),
    fail(404),
  );
});
test("photos: recover storage success before DB commit, retry and reselect without duplicate cards or photos", async () => {
  const uncertain: PhotoStore = {
    put: async (key, bytes) => {
      await store.put(key, bytes);
      throw new AccessError(503, "lost_acknowledgement");
    },
    read: store.read,
  };
  await assert.rejects(
    upload(frontId, front, "image/jpeg", uncertain),
    fail(503),
  );
  assert.equal((await workspace()).photos[0].ready, false);
  assert.equal((await prepare("front", front)).id, frontId);
  await upload(frontId);
  assert.equal((await upload(frontId)).duplicate, true);
  assert.equal(
    (await workspace()).photos.filter((p) => p.kind === "front").length,
    1,
  );
  await assert.rejects(upload(frontId, back, "image/png"), fail(409));
  backId = (await prepare("back", back)).id;
  await upload(backId, back, "image/png");
  paperId = (await prepare("paper", front)).id;
  await upload(paperId);
  assert.equal((await workspace()).photos_complete, true);
  const savedCards = (await run("staff", gradingCards)).filter(
    (c) => c.case_id === intake.case_id,
  );
  assert.equal(
    savedCards.reduce((sum, c) => sum + c.examination_cents, 0),
    500,
  );
  assert.equal(
    (await run("staff", gradingCards)).filter(
      (c) => c.case_id === intake.case_id,
    ).length,
    1,
  );
});
test("exam: storage verification is repeated at publication; missing/corrupt object blocks publication", async () => {
  const version = (await workspace()).draft!.version;
  const broken: PhotoStore = {
    ...store,
    read: async () => new Uint8Array([1, 2, 3]),
  };
  await assert.rejects(
    run("staff", (db, a) =>
      publishExam(
        db,
        a,
        card.card_id,
        { version, reason: "First exam", signoff: true },
        broken,
      ),
    ),
    fail(503),
  );
  assert.equal((await workspace()).revisions.length, 0);
});
test("exam: each missing score and a missing estimate independently block publication even with confirmed photos", async () => {
  for (const incomplete of [
    { ...fields, centering: null },
    { ...fields, surface: null },
    { ...fields, edges: null },
    { ...fields, corners: null },
    { ...fields, projected_grade: "" },
  ]) {
    const version = (await workspace()).draft!.version;
    const saved = await run("staff", (db, a) =>
      saveExamDraft(db, a, card.card_id, {
        version,
        fields: incomplete,
        internal_notes: "PRIVATE NEVER IN REPORT",
      }),
    );
    await assert.rejects(
      run("staff", (db, a) =>
        publishExam(
          db,
          a,
          card.card_id,
          {
            version: saved.version,
            signoff: true,
            reason: "Incomplete exam must not publish",
          },
          store,
        ),
      ),
      fail(409),
    );
  }
  const version = (await workspace()).draft!.version;
  await run("staff", (db, a) =>
    saveExamDraft(db, a, card.card_id, {
      version,
      fields,
      internal_notes: "PRIVATE NEVER IN REPORT",
    }),
  );
  assert.equal((await workspace()).revisions.length, 0);
});
test("exam: complete signed publication is idempotent and exposes only public assessment/photos", async () => {
  const version = (await workspace()).draft!.version;
  const body = {
    version,
    reason: "PRIVATE CORRECTION REASON",
    signoff: true,
    signed_by: previewId(11),
    signed_at: "1900-01-01",
  };
  const results = await Promise.all([
    run("staff", (db, a) => publishExam(db, a, card.card_id, body, store)),
    run("staff", (db, a) => publishExam(db, a, card.card_id, body, store)),
  ]);
  assert.equal(results[0].id, results[1].id);
  publishedId = results[0].id;
  const data = await run("a", (db, a) => examWorkspace(db, a, card.card_id));
  assert.equal(data.revisions.length, 1);
  const rev = data.revisions[0];
  assert.equal(rev.signed_by, previewId(10));
  assert.ok(new Date(rev.signed_at).getFullYear() >= 2026);
  assert.equal(rev.projected_grade, fields.projected_grade);
  assert.equal(rev.photos.length, 2);
  assert.ok(!JSON.stringify(data).includes("PRIVATE"));
  assert.ok(!JSON.stringify(data).includes(paperId));
  await assert.rejects(
    run("a", (db, a) => authorizedExamPhoto(db, a, card.card_id, paperId)),
    fail(404),
  );
  await run("a", async (db, a) =>
    verifyStoredPhoto(
      await authorizedExamPhoto(db, a, card.card_id, frontId),
      store,
    ),
  );
  assert.equal(
    (
      await run("a", (db) =>
        db.query("select * from ns.grading_exam_revision_private"),
      )
    ).rows.length,
    0,
  );
});
test("exam: customer, read-only and content-editor mutations denied; other card/customer/tenant denied by server and RLS", async () => {
  for (const who of ["a", "reader", "editor"]) {
    await assert.rejects(
      run(who, (db, a) =>
        saveExamDraft(db, a, card.card_id, { version: 0, fields }),
      ),
      fail(403),
    );
    await assert.rejects(
      run(who, (db, a) =>
        prepareExamPhoto(db, a, card.card_id, {
          kind: "back",
          request_id: randomUUID(),
          source_hash: photoHash(back),
        }),
      ),
      fail(403),
    );
    await assert.rejects(
      run(who, (db, a) =>
        completeExamPhoto(
          db,
          a,
          card.card_id,
          frontId,
          front,
          "image/jpeg",
          store,
        ),
      ),
      fail(403),
    );
    await assert.rejects(
      run(who, (db, a) =>
        publishExam(db, a, card.card_id, { signoff: true }, store),
      ),
      fail(403),
    );
  }
  await assert.rejects(
    run("b", (db, a) => examWorkspace(db, a, card.card_id)),
    fail(404),
  );
  await assert.rejects(
    run("b", (db, a) => authorizedExamPhoto(db, a, card.card_id, frontId)),
    fail(404),
  );
  assert.equal(
    (
      await run("b", (db) =>
        db.query("select * from ns.grading_exam_revisions"),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await run("b", (db) => db.query("select * from ns.grading_photos"))).rows
      .length,
    0,
  );
  const otherCard = (await run("b", gradingCards))[0];
  await assert.rejects(
    run("staff", (db, a) =>
      authorizedExamPhoto(db, a, otherCard.card_id, frontId),
    ),
    fail(404),
  );
  const tenant = randomUUID(),
    customer = randomUUID(),
    token = opaqueToken();
  await fixture.db.query(
    "insert into ns.tenants(id,slug,shop,is_test) values($1,'exam-other','exam-other.myshopify.com',true)",
    [tenant],
  );
  await fixture.db.query(
    "insert into ns.customers(tenant_id,id,display_name) values($1,$2,'OTHER TENANT TEST')",
    [tenant, customer],
  );
  await fixture.db.query(
    "insert into ns.sessions(token_hash,tenant_id,customer_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'shopify','TEST',now()+interval '1 day',now()+interval '1 day')",
    [hashToken(token), tenant, customer],
  );
  await fixture.db.transaction(async (tx) => {
    await tx.exec("set local role northside_runtime");
    const db = tx as unknown as Sql;
    const a = await authorizeOn(db, token);
    await assert.rejects(examWorkspace(db, a, card.card_id), fail(404));
    assert.equal(
      (await db.query("select * from ns.grading_photos")).rows.length,
      0,
    );
  });
});
test("exam: corrections keep published fields and original photos; require reason and fresh signature", async () => {
  const version = (await workspace()).draft!.version;
  await run("staff", (db, a) =>
    saveExamDraft(db, a, card.card_id, {
      version,
      fields: {
        ...fields,
        projected_grade: "",
        unable_to_estimate: true,
        notes: "Corrected public note",
      },
      internal_notes: "PRIVATE REVISION 2",
    }),
  );
  const replacement = (await prepare("front", back)).id;
  await upload(replacement, back, "image/png");
  const data = await workspace(),
    body = { version: data.draft!.version, signoff: true, reason: "" };
  await assert.rejects(
    run("staff", (db, a) => publishExam(db, a, card.card_id, body, store)),
    fail(400),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      publishExam(
        db,
        a,
        card.card_id,
        { ...body, reason: "Correction", signoff: false },
        store,
      ),
    ),
    fail(400),
  );
  await run("staff", (db, a) =>
    publishExam(
      db,
      a,
      card.card_id,
      { ...body, reason: "Further inspection prevented an estimate" },
      store,
    ),
  );
  const corrected = await workspace();
  assert.equal(corrected.revisions.length, 2);
  assert.equal(corrected.revisions[0].unable_to_estimate, true);
  assert.equal(corrected.revisions[1].notes, fields.notes);
  assert.equal(
    corrected.revisions[1].photos.find((p) => p.kind === "front")?.id,
    frontId,
  );
  assert.equal(
    corrected.revisions[0].photos.find((p) => p.kind === "front")?.id,
    replacement,
  );
  await assert.rejects(
    fixture.db.query(
      "update ns.grading_exam_revisions set notes='overwrite' where id=$1",
      [publishedId],
    ),
    /immutable|append|rewrit/i,
  );
  await assert.rejects(
    fixture.db.query(
      "delete from ns.grading_exam_revision_photos where revision_id=$1",
      [publishedId],
    ),
    /immutable|append|rewrit/i,
  );
  await assert.rejects(
    run("staff", (db) =>
      db.query(
        "insert into ns.grading_exam_revision_photos(tenant_id,card_id,revision_id,photo_id) values($1,$2,$3,$4)",
        [TENANT, card.card_id, publishedId, replacement],
      ),
    ),
    /only be snapshotted/,
  );
});
test("report: printable signed revision uses escaped public fields, excludes internal notes/reason/paper", async () => {
  const revision = (await workspace()).revisions.find(
    (r) => r.id === publishedId,
  )!;
  const html = examReport(
    revision,
    card.card_id,
    Object.fromEntries(
      revision.photos.map((p) => [
        p.id,
        `/api/preview/grading/exam?card=${card.card_id}&photo=${p.id}&actor=a`,
      ]),
    ),
    true,
  );
  assert.match(html, /SAMPLE — LOCAL PREVIEW/);
  assert.match(html, /@media print/);
  assert.match(html, /\/api\/preview\/grading\/exam/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>unsafe"));
  assert.ok(!html.includes("PRIVATE"));
  assert.ok(!html.includes(paperId));
  assert.match(html, /Examiner estimate: 8.5/);
  assert.match(html, /authenticated Northside examiner/);
});
test("exam: removing draft photo creates missing task without changing published revision or card", async () => {
  const frontPhoto = (await workspace()).photos.find(
    (p) => p.kind === "front" && p.active,
  )!;
  await run("staff", (db, a) =>
    removeExamPhoto(db, a, card.card_id, frontPhoto.id),
  );
  assert.equal((await workspace()).photos_complete, false);
  assert.equal((await workspace()).revisions[0].photos.length, 2);
  await assert.rejects(
    run("staff", (db, a) =>
      publishExam(
        db,
        a,
        card.card_id,
        { version: 0, reason: "Invalid", signoff: true },
        store,
      ),
    ),
    fail(409),
  );
  const pending = await prepare("closeup", front);
  await run("staff", (db, a) =>
    removeExamPhoto(db, a, card.card_id, pending.id),
  );
  assert.ok(!(await workspace()).photos.some((p) => p.id === pending.id));
  await assert.rejects(upload(pending.id), fail(404));
});
test("exam: close/reopen retains receipt, draft notes, revisions, original private photo bytes and missing task", async () => {
  const before = await workspace();
  await fixture.db.close();
  fixture = await openPreviewDatabase(join(directory, "db"));
  const after = await workspace();
  assert.deepEqual(after.draft, before.draft);
  assert.deepEqual(after.revisions, before.revisions);
  assert.equal(after.photos_complete, false);
  await run("a", async (db, a) =>
    verifyStoredPhoto(
      await authorizedExamPhoto(db, a, card.card_id, frontId),
      localPhotoStore(join(directory, "photos")),
    ),
  );
  assert.equal(
    (await run("staff", gradingCards)).filter(
      (c) => c.case_id === intake.case_id,
    ).length,
    1,
  );
});
test("photos: Supabase adapter uses only private immutable keys, bounded server requests and authenticated downloads", async () => {
  const originalFetch = globalThis.fetch,
    oldUrl = process.env.SUPABASE_URL,
    oldSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://exam-storage-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY =
    "SYNTHETIC-LOCAL-TEST-NOT-A-REAL-CREDENTIAL";
  const calls: { url: string; method: string; signal: boolean }[] = [];
  const key = `${TENANT}/grading/${card.card_id}/${randomUUID()}.jpg`;
  globalThis.fetch = async (request, init) => {
    const url = String(request),
      method = init?.method || "GET",
      headers = new Headers(init?.headers);
    calls.push({ url, method, signal: !!init?.signal });
    assert.equal(
      headers.get("authorization"),
      "Bearer SYNTHETIC-LOCAL-TEST-NOT-A-REAL-CREDENTIAL",
    );
    assert.ok(!url.includes("/public/"));
    if (method === "POST") {
      assert.equal(headers.get("x-upsert"), "false");
      assert.equal(headers.get("content-type"), "image/jpeg");
      return Response.json({
        Key: `northside-private/${key}`,
        Id: randomUUID(),
      });
    }
    return new Response(new Uint8Array(front), {
      headers: { "Content-Type": "image/jpeg" },
    });
  };
  try {
    const adapter = examPhotoStore(false);
    await adapter.put(key, front);
    assert.deepEqual(Buffer.from(await adapter.read(key)), front);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.signal));
    assert.ok(
      calls.every(
        (c) =>
          c.url.includes(`/storage/v1/object`) &&
          c.url.includes(`northside-private/${key}`),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldSecret;
  }
});
test.after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
});
