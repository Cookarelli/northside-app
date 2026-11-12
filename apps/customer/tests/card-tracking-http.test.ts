import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import sharp from "sharp";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import {
  createConsignment,
  consignmentItem,
  updateConsignment,
} from "../lib/server/consignment";
import { gradingCards, receivedDate } from "../lib/server/grading";
import { gradingApi } from "../lib/server/grading-api";
import {
  cardTrackingAction,
  cardTrackingHttp,
} from "../lib/server/card-tracking-http";
import { trackingCustomers, trackingDetail } from "../lib/server/card-tracking";
import {
  uploadCardFile,
  readCardFile,
  cardFileResponse,
} from "../lib/server/card-files";
import { authorizedFile, prepareUpload } from "../lib/server/records";
import { normalizePhoto } from "../lib/server/exam-storage";
import { mobileHandler } from "../lib/server/mobile/http";
import { safeReturn, AccessError } from "../lib/server/security";
const dir = await mkdtemp(join(tmpdir(), "northside-tracking-http-")),
  f = await openPreviewDatabase(join(dir, "database"));
const run = <T>(who: string, fn: Parameters<typeof f.run<T>>[1]) =>
  f.run(who, fn);
const denied = (status: number) => (e: unknown) =>
  e instanceof AccessError && e.status === status;
const data = new Map<string, Uint8Array>();
const store = {
  async put(key: string, b: Uint8Array) {
    data.set(key, b);
  },
  async read(key: string) {
    const b = data.get(key);
    if (!b) throw Error("SAMPLE unavailable");
    return b;
  },
};
const item = await run("staff", (db, a) =>
  createConsignment(db, a, {
    customer_id: previewId(1),
    request_id: randomUUID(),
    description: "SAMPLE isolated photographed card",
    received_date: "2026-09-01",
    currency: "USD",
    reason: "PRIVATE staff intake evidence",
    submission_reference: "PRIVATE SHARED ORDER",
  }),
);
const cardId = (await run("staff", (db, a) => consignmentItem(db, a, item.id)))
  .card_id;
const image = await sharp({
  create: { width: 60, height: 90, channels: 3, background: "#0263cd" },
})
  .withMetadata({ exif: { IFD0: { Artist: "PRIVATE SAMPLE IMAGE METADATA" } } })
  .png()
  .toBuffer();
let photo = "";

test("card files: staff uploads decoded normalized photo and confirms readback before customer visibility", async () => {
  photo = (
    await run("staff", (db, a) =>
      uploadCardFile(db, a, cardId, image, "image/png", store),
    )
  ).id;
  const saved = await run("a", (db, a) => readCardFile(db, a, photo, store));
  assert.equal(saved.mime, "image/jpeg");
  assert.equal((await sharp(saved.bytes).metadata()).exif, undefined);
  const detail = await run("a", (db, a) =>
    trackingDetail(db, a, "consignment", item.id),
  );
  assert.ok(detail.card.photos.some((p) => p.id === photo));
  assert.equal(JSON.stringify(detail).includes("PRIVATE"), false);
  const file = await run("a", (db, a) => authorizedFile(db, a, photo));
  assert.match(file.content_sha256!, /^[a-f0-9]{64}$/);
  assert.equal(file.byte_length, saved.bytes.length);
});
test("card files: cross-customer and unauthorized staff cannot read photos or upload attachments", async () => {
  await assert.rejects(
    run("b", (db, a) => readCardFile(db, a, photo, store)),
    denied(404),
  );
  for (const who of ["a", "b", "reader", "editor"])
    await assert.rejects(
      run(who, (db, a) =>
        uploadCardFile(db, a, cardId, image, "image/png", store),
      ),
      denied(403),
    );
  await assert.rejects(
    run("editor", (db, a) => readCardFile(db, a, photo, store)),
    denied(403),
  );
});
test("card files: corrupt storage never confirms an upload or serves mismatched stored bytes", async () => {
  const before = (
    await f.db.query(
      "select id from ns.file_objects where card_id=$1 and ready",
      [cardId],
    )
  ).rows.length;
  await assert.rejects(
    run("staff", (db, a) =>
      uploadCardFile(db, a, cardId, image, "image/png", {
        async put() {},
        async read() {
          return new Uint8Array([1, 2, 3]);
        },
      }),
    ),
    denied(503),
  );
  assert.equal(
    (
      await f.db.query(
        "select id from ns.file_objects where card_id=$1 and ready",
        [cardId],
      )
    ).rows.length,
    before,
  );
  const file = await run("a", (db, a) => authorizedFile(db, a, photo)),
    original = data.get(file.object_key)!;
  data.set(file.object_key, original.slice(0, 10));
  await assert.rejects(
    run("a", (db, a) => readCardFile(db, a, photo, store)),
    denied(503),
  );
  data.set(file.object_key, original);
});
test("card files: invalid image content is rejected while PDF attachment support is preserved", async () => {
  await assert.rejects(
    run("staff", (db, a) =>
      uploadCardFile(
        db,
        a,
        cardId,
        new Uint8Array([1, 2, 3]),
        "image/png",
        store,
      ),
    ),
    denied(415),
  );
  const pdf = await run("staff", (db, a) =>
    uploadCardFile(
      db,
      a,
      cardId,
      Buffer.from("%PDF-1.7\nSAMPLE attachment\n%%EOF"),
      "application/pdf",
      store,
    ),
  );
  const body = await run("a", (db, a) => readCardFile(db, a, pdf.id, store));
  assert.equal(body.mime, "application/pdf");
  const detail = await run("a", (db, a) =>
    trackingDetail(db, a, "consignment", item.id),
  );
  assert.equal(
    detail.card.photos.some((p) => p.id === pdf.id),
    false,
  );
  const response = cardFileResponse(body);
  assert.match(response.headers.get("content-disposition")!, /^attachment/);
});
test("card files: authenticated content responses forbid caching and never reveal storage URLs", async () => {
  const response = cardFileResponse(
    await run("a", (db, a) => readCardFile(db, a, photo, store)),
  );
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
});
test("legacy grading API: single customer selector is safe and mixed/duplicate selectors fail closed", async () => {
  const id = (await run("a", gradingCards))[0].card_id;
  for (const suffix of [
    `card=${id}&export=1`,
    `card=${id}&file=${photo}`,
    `card=${id}&card=${id}`,
    "export=1&file=" + photo,
  ])
    await assert.rejects(
      run("a", (db, a) =>
        gradingApi(
          new Request(
            "https://stage.example.test/api/private/grading?" + suffix,
          ),
          db,
          a,
        ),
      ),
      denied(400),
    );
  const detail = await run("a", (db, a) =>
    gradingApi(
      new Request("https://stage.example.test/api/private/grading?card=" + id),
      db,
      a,
    ),
  );
  const raw = JSON.stringify(detail);
  assert.equal(raw.includes('"batch_id"'), false);
  assert.equal(raw.includes('"customer_id"'), false);
  assert.equal(raw.includes('"internal_notes"'), false);
  const unknown = await run("a", (db, a) =>
    gradingApi(
      new Request("https://stage.example.test/api/private/grading?extra=1"),
      db,
      a,
    ),
  );
  assert.equal(JSON.stringify(unknown).includes('"batch_id"'), false);
});
test("staff search: exact customer identity remains server-scoped and private from customers/read-only/content roles", async () => {
  const found = await run("staff", (db, a) =>
    trackingCustomers(db, a, previewId(2)),
  );
  assert.equal(found.customers.length, 1);
  assert.equal(found.customers[0].id, previewId(2));
  for (const who of ["a", "b", "reader", "editor"])
    await assert.rejects(
      run(who, (db, a) => trackingCustomers(db, a, "Sample")),
      denied(403),
    );
  const literal = await run("staff", (db, a) => trackingCustomers(db, a, "%%"));
  assert.equal(literal.customers.length, 0);
});
test("private tracking action: dated status/history persist and requests cannot choose another customer", async () => {
  const before = await run("staff", (db, a) => consignmentItem(db, a, item.id));
  await run("staff", (db, a) =>
    updateConsignment(db, a, item.id, {
      version: before.version,
      state_key: "preparing",
      customer_notes: "SAMPLE public preparation note",
      reason: "PRIVATE staff status evidence",
    }),
  );
  const own = await run("a", (db, a) =>
    cardTrackingAction(
      new Request(
        `https://stage.example.test/api/private/card-tracking?service=consignment&id=${item.id}`,
      ),
      db,
      a,
    ),
  );
  assert.ok("card" in own);
  assert.equal(own.card.status, "Preparing submission");
  assert.ok(own.card.history.length >= 2);
  assert.equal(JSON.stringify(own).includes("PRIVATE"), false);
  await assert.rejects(
    run("b", (db, a) =>
      cardTrackingAction(
        new Request(
          `https://stage.example.test/api/private/card-tracking?service=consignment&id=${item.id}`,
        ),
        db,
        a,
      ),
    ),
    denied(404),
  );
  await assert.rejects(
    run("a", (db, a) =>
      cardTrackingAction(
        new Request(
          "https://stage.example.test/api/private/card-tracking?service=consignment&customer_id=" +
            previewId(2),
        ),
        db,
        a,
      ),
    ),
    denied(400),
  );
  const notices = (
    await f.db.query(
      "select id from ns.notifications where customer_id=$1 and kind='consignment'",
      [previewId(1)],
    )
  ).rows;
  assert.ok(notices.length >= 2);
  assert.equal(
    (await f.db.query("select id from ns.notification_attempts")).rows.length,
    0,
  );
});
test("return paths: grading and consignment return safely to the requested account section", () => {
  assert.equal(safeReturn("/my-cards/consignment"), "/my-cards/consignment");
  assert.equal(safeReturn("/my-cards/grading"), "/my-cards/grading");
  for (const value of [
    "//untrusted.invalid/my-cards",
    "https://untrusted.invalid/my-cards",
    "/my-cards/consignment?customer_id=x",
    "/my-cards/../staff",
    "/my-cards%2fconsignment",
  ])
    assert.equal(safeReturn(value), "/account");
  for (const value of ["2026-02-30", "2999-01-01", "2026-13-01", "invalid"])
    assert.throws(() => receivedDate(value), denied(400));
});
test("native transport: card/photo/accept endpoints require bearer auth and refuse browser-cookie borrowing", async () => {
  const base = "https://stage.example.test/api/mobile/v1/me/tracking/grading";
  for (const url of [
    base,
    base + "/" + randomUUID(),
    base + "/" + randomUUID() + "/photos/" + randomUUID(),
  ]) {
    const r = await mobileHandler(new Request(url));
    assert.equal(r.status, 401);
    assert.match(r.headers.get("cache-control")!, /no-store/);
    const cookie = await mobileHandler(
      new Request(url, {
        headers: {
          authorization: "Bearer " + "A".repeat(43),
          cookie: "__Host-ns_session=" + "B".repeat(43),
        },
      }),
    );
    assert.equal(cookie.status, 401);
  }
  const post = await mobileHandler(
    new Request("https://stage.example.test/api/mobile/v1/me/tracking/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "grading",
        terms_id: randomUUID(),
        card_id: randomUUID(),
        confirmed: true,
      }),
    }),
  );
  assert.equal(post.status, 401);
});
test("web tracking: cross-origin mutations and hosted fixture mode are denied before provider access", async () => {
  const original = {
    origin: process.env.APP_ORIGIN,
    mode: process.env.NODE_ENV,
    fixtures: process.env.NORTHSIDE_FIXTURES,
  };
  process.env.APP_ORIGIN = "https://stage.example.test";
  try {
    const cross = await cardTrackingHttp(
      new Request("https://stage.example.test/api/private/card-tracking", {
        method: "POST",
        headers: {
          Origin: "https://untrusted.invalid",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    assert.equal(cross.status, 403);
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.NORTHSIDE_FIXTURES = "1";
    const fixture = await cardTrackingHttp(
      new Request(
        "https://stage.example.test/api/preview/card-tracking?actor=staff&service=grading",
      ),
      true,
    );
    assert.equal(fixture.status, 404);
  } finally {
    for (const [key, value] of Object.entries({
      APP_ORIGIN: original.origin,
      NODE_ENV: original.mode,
      NORTHSIDE_FIXTURES: original.fixtures,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("card files: valid 4–5 MiB generic and legacy photos remain supported while exam limit stays 4 MiB", async () => {
  const large = await sharp(randomBytes(1400 * 1100 * 3), {
    raw: { width: 1400, height: 1100, channels: 3 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(large.length > 4194304 && large.length <= 5242880);
  await assert.rejects(normalizePhoto(large, "image/png"), denied(413));
  const fresh = await run("staff", (db, a) =>
    uploadCardFile(db, a, cardId, large, "image/png", store),
  );
  assert.equal(
    (await run("a", (db, a) => readCardFile(db, a, fresh.id, store))).mime,
    "image/jpeg",
  );
  const legacy = await run("staff", async (db, a) => {
    const file = await prepareUpload(db, a, cardId, "image/png");
    await store.put(file.key, large);
    await db.query(
      "update ns.file_objects set ready=true where tenant_id=$1 and id=$2",
      [a.tenant_id, file.id],
    );
    return file;
  });
  const delivered = await run("a", (db, a) =>
    readCardFile(db, a, legacy.id, store),
  );
  assert.equal(delivered.mime, "image/jpeg");
  assert.equal((await sharp(delivered.bytes).metadata()).width, 1400);
  assert.deepEqual(data.get(legacy.key), large);
});

after(async () => {
  await f.db.close();
  await rm(dir, { recursive: true, force: true });
});
