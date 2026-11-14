import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { openPreviewDatabase } from "../lib/server/grading-preview";
import { publishServiceTerms } from "../lib/server/card-tracking";
import { AccessError, hashToken } from "../lib/server/security";
import {
  normalizePhoto,
  photoHash,
  type PhotoStore,
} from "../lib/server/exam-storage";
import {
  uploadRequestPhoto,
  readRequestPhoto,
  verifyRequestPhotos,
} from "../lib/server/service-request-photos";
import { TENANT } from "../lib/server/providers";

const directory = await mkdtemp(join(tmpdir(), "northside-request-photos-"));
let fixture = await openPreviewDatabase(join(directory, "db"));
const migration =
  process.env.NORTHSIDE_REQUEST_PHOTO_TEST_MIGRATION ??
  resolve("supabase/migrations/20261114233721_service_request_photos.sql");
if (
  !(
    await fixture.db.query<{ present: string | null }>(
      "select to_regclass('ns.service_request_photos') as present",
    )
  ).rows[0].present
) {
  await fixture.db.exec(
    "do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;",
  );
  await fixture.db.exec(await readFile(migration, "utf8"));
}
const run = <T>(who: string, fn: Parameters<typeof fixture.run<T>>[1]) =>
  fixture.run(who, fn);
const denied = (status: number) => (error: unknown) =>
  error instanceof AccessError && error.status === status;
let puts = 0;
const store: PhotoStore = {
  async put(key, bytes) {
    const path = join(directory, "private", key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" });
      puts++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  },
  read: (key) => readFile(join(directory, "private", key)),
};
const image = await sharp({
  create: { width: 40, height: 60, channels: 3, background: "blue" },
})
  .withExif({ IFD0: { Artist: "SAMPLE private metadata" } })
  .png()
  .toBuffer();
const otherImage = await sharp({
  create: { width: 40, height: 60, channels: 3, background: "green" },
})
  .png()
  .toBuffer();
const submission = randomUUID(),
  photo = randomUUID();
const upload = (
  requestId = submission,
  id = photo,
  bytes = image,
  adapter = store,
) =>
  run("a", (db, actor) =>
    uploadRequestPhoto(db, actor, requestId, id, bytes, "image/png", adapter),
  );
const originalCardCount = (
  await fixture.db.query<{ n: number }>(
    "select count(*)::int n from ns.card_items",
  )
).rows[0].n;

after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
});

test("request photos: private normalized bytes are confirmed without creating received-card records", async () => {
  assert.deepEqual(await upload(), { id: photo });
  const result = await run("a", (db, actor) =>
    readRequestPhoto(db, actor, photo, store),
  );
  const expected = await normalizePhoto(image, "image/png");
  assert.equal(result.mime, "image/jpeg");
  assert.deepEqual(Buffer.from(result.bytes), expected.bytes);
  assert.equal((await sharp(result.bytes).metadata()).exif, undefined);
  const record = (
    await fixture.db.query<{
      ready: boolean;
      content_sha256: string;
      byte_length: number;
    }>(
      "select ready,content_sha256,byte_length from ns.service_request_photos where id=$1",
      [photo],
    )
  ).rows[0];
  assert.equal(record.ready, true);
  assert.equal(record.content_sha256, photoHash(result.bytes));
  assert.equal(record.byte_length, result.bytes.length);
  assert.equal(
    (
      await fixture.db.query<{ n: number }>(
        "select count(*)::int n from ns.card_items",
      )
    ).rows[0].n,
    originalCardCount,
  );
});

test("request photos: owner, tenant and staff draft isolation precedes private storage access", async () => {
  let reads = 0;
  const watched = {
    ...store,
    read: async (key: string) => {
      reads++;
      return store.read(key);
    },
  };
  for (const who of ["b", "staff", "reader"])
    await assert.rejects(
      run(who, (db, actor) => readRequestPhoto(db, actor, photo, watched)),
      denied(404),
    );
  await assert.rejects(
    run("editor", (db, actor) => readRequestPhoto(db, actor, photo, watched)),
    denied(403),
  );
  await assert.rejects(
    run("a", (db, actor) =>
      readRequestPhoto(
        db,
        { ...actor, tenant_id: randomUUID() },
        photo,
        watched,
      ),
    ),
    denied(404),
  );
  assert.equal(reads, 0);
  for (const who of ["b", "staff", "reader"])
    assert.equal(
      (
        await run(who, (db) =>
          db.query("select id from ns.service_request_photos where id=$1", [
            photo,
          ]),
        )
      ).rows.length,
      0,
    );
  await assert.rejects(
    run("staff", (db, actor) =>
      uploadRequestPhoto(
        db,
        actor,
        submission,
        randomUUID(),
        image,
        "image/png",
        store,
      ),
    ),
    denied(403),
  );
});

test("request photos: retries reuse one identity and reject changed content or submission", async () => {
  const before = puts;
  assert.deepEqual(await upload(), { id: photo });
  assert.equal(puts, before);
  await assert.rejects(upload(submission, photo, otherImage), denied(409));
  await assert.rejects(upload(randomUUID(), photo), denied(409));
  assert.equal(
    (
      await fixture.db.query<{ n: number }>(
        "select count(*)::int n from ns.service_request_photos where id=$1",
        [photo],
      )
    ).rows[0].n,
    1,
  );
});

test("request photos: submission validation rejects unknown, foreign, unready and mismatched draft evidence", async () => {
  await run("a", (db, actor) =>
    verifyRequestPhotos(db, actor, {
      request_id: submission,
      photo_ids: [photo],
    }),
  );
  for (const input of [
    { request_id: submission, photo_ids: [randomUUID()] },
    { request_id: randomUUID(), photo_ids: [photo] },
    { request_id: submission, photo_ids: [photo, photo] },
  ])
    await assert.rejects(
      run("a", (db, actor) => verifyRequestPhotos(db, actor, input)),
      denied(400),
    );
  await assert.rejects(
    run("b", (db, actor) =>
      verifyRequestPhotos(db, actor, {
        request_id: submission,
        photo_ids: [photo],
      }),
    ),
    denied(400),
  );
  await assert.rejects(
    run("a", (db) =>
      verifyRequestPhotos(db, null, {
        request_id: submission,
        photo_ids: [photo],
      }),
    ),
    denied(403),
  );
  await run("a", (db) =>
    verifyRequestPhotos(db, null, { request_id: submission, photo_ids: [] }),
  );
  await fixture.db.query(
    "update ns.service_request_photos set ready=false where id=$1",
    [photo],
  );
  await assert.rejects(
    run("a", (db, actor) =>
      verifyRequestPhotos(db, actor, {
        request_id: submission,
        photo_ids: [photo],
      }),
    ),
    denied(400),
  );
  await upload();
});

test("request photos: malformed images and failed readback never acknowledge an attachment", async () => {
  await assert.rejects(
    upload(submission, randomUUID(), Buffer.from("not an image")),
    denied(415),
  );
  const id = randomUUID();
  const broken: PhotoStore = {
    put: store.put,
    read: async () => Buffer.from("corrupt bytes"),
  };
  await assert.rejects(upload(submission, id, image, broken), denied(503));
  assert.equal(
    (
      await fixture.db.query(
        "select id from ns.service_request_photos where id=$1",
        [id],
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    run("a", (db, actor) => readRequestPhoto(db, actor, id, store)),
    denied(404),
  );
  await upload(submission, id);
  const corruptExisting: PhotoStore = {
    put: store.put,
    read: async () => Buffer.from("corrupt existing bytes"),
  };
  await assert.rejects(
    run("a", (db, actor) => readRequestPhoto(db, actor, id, corruptExisting)),
    denied(503),
  );
});

test("request photos: storage success followed by lost response recovers without overwrite", async () => {
  const id = randomUUID();
  const uncertain: PhotoStore = {
    put: async (key, bytes) => {
      await store.put(key, bytes);
      throw Error("SAMPLE response lost after storage save");
    },
    read: store.read,
  };
  await assert.rejects(upload(submission, id, image, uncertain), denied(503));
  assert.equal(
    (
      await fixture.db.query(
        "select id from ns.service_request_photos where id=$1",
        [id],
      )
    ).rows.length,
    0,
  );
  const savedCount = puts;
  assert.deepEqual(await upload(submission, id), { id });
  assert.equal(puts, savedCount);
});

test("request photos: no more than ten draft identities can be uploaded for one request", async () => {
  const request = randomUUID();
  for (let i = 0; i < 10; i++) await upload(request, randomUUID());
  await assert.rejects(upload(request, randomUUID()), denied(400));
  assert.equal(
    (
      await fixture.db.query<{ n: number }>(
        "select count(*)::int n from ns.service_request_photos where submission_id=$1",
        [request],
      )
    ).rows[0].n,
    10,
  );
});

test("request photos: rolling customer upload quota includes pending rows without blocking recovery", async () => {
  const customer = (await run("a", async (_db, actor) => actor.customer_id))!;
  const count = (
    await fixture.db.query<{ n: number }>(
      "select count(*)::int n from ns.service_request_photos where tenant_id=$1 and customer_id=$2 and created_at>=now()-interval '24 hours'",
      [TENANT, customer],
    )
  ).rows[0].n;
  const inserted: string[] = [];
  for (let n = count; n < 100; n++) {
    const id = randomUUID(),
      request = randomUUID();
    inserted.push(id);
    await fixture.db.query(
      "insert into ns.service_request_photos(tenant_id,id,customer_id,submission_id,object_key,content_sha256,byte_length,ready) values($1,$2,$3,$4,$5,$6,1,false)",
      [
        TENANT,
        id,
        customer,
        request,
        `${TENANT}/${customer}/requests/${request}/${id}.jpg`,
        "0".repeat(64),
      ],
    );
  }
  try {
    await assert.rejects(
      upload(randomUUID(), randomUUID()),
      (error) =>
        error instanceof AccessError &&
        error.status === 429 &&
        error.message === "upload_limit_reached",
    );
    assert.deepEqual(await upload(), { id: photo });
  } finally {
    await fixture.db.query(
      "delete from ns.service_request_photos where tenant_id=$1 and id=any($2::uuid[])",
      [TENANT, inserted],
    );
  }
});

test("request photos: staff sees only photos attached to the saved request snapshot", async () => {
  const term = await run("staff", (db, actor) =>
    publishServiceTerms(db, actor, {
      service: "consignment",
      version: randomUUID(),
      title: "SAMPLE photo test terms",
      body: "SAMPLE isolated database test only. No business activation.",
      approval_reference: "SAMPLE test evidence",
      previous_id: null,
    }),
  );
  const unlisted = randomUUID();
  await upload(submission, unlisted);
  const detail = {
    listing_count: 1,
    delivery_method: "planning_delivery",
    inbound_carrier: "",
    inbound_tracking_number: "",
    instructions: "SAMPLE local request",
    photo_ids: [photo],
  };
  await run("a", async (db, actor) => {
    await verifyRequestPhotos(db, actor, {
      request_id: submission,
      photo_ids: [photo],
    });
    await db.query(
      "select ns.submit_service_request($1,$2,$3,$4,'native_ios','service_request','consignment',$5,$6,$7,null)",
      [
        actor.tenant_id,
        submission,
        "a".repeat(64),
        hashToken("SAMPLE photo request private code"),
        JSON.stringify({
          name: "SAMPLE",
          email: "sample@example.invalid",
          phone: "SAMPLE",
        }),
        JSON.stringify(detail),
        term.id,
      ],
    );
  });
  for (const who of ["staff", "reader"]) {
    assert.equal(
      (await run(who, (db, actor) => readRequestPhoto(db, actor, photo, store)))
        .mime,
      "image/jpeg",
    );
    await assert.rejects(
      run(who, (db, actor) => readRequestPhoto(db, actor, unlisted, store)),
      denied(404),
    );
  }
  assert.equal(
    (
      await run("reader", (db) =>
        db.query(
          "select id from ns.service_request_photos where submission_id=$1",
          [submission],
        ),
      )
    ).rows.length,
    1,
  );
  await assert.rejects(upload(submission, randomUUID()), denied(409));
  assert.deepEqual(await upload(), { id: photo });
  await assert.rejects(
    run("b", (db, actor) => readRequestPhoto(db, actor, photo, store)),
    denied(404),
  );
});

test("request photos: confirmed files and retry identity survive database restart", async () => {
  await fixture.db.close();
  fixture = await openPreviewDatabase(join(directory, "db"));
  const before = puts;
  assert.deepEqual(await upload(), { id: photo });
  assert.equal(puts, before);
  assert.equal(
    (await run("a", (db, actor) => readRequestPhoto(db, actor, photo, store)))
      .mime,
    "image/jpeg",
  );
});

test("request photos: real Supabase SDK contract uses no-overwrite private uploads and bounded authenticated readback", async () => {
  const originalFetch = globalThis.fetch,
    oldUrl = process.env.SUPABASE_URL,
    oldSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://request-photo-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY =
    "SYNTHETIC-LOCAL-TEST-NOT-A-REAL-CREDENTIAL";
  const calls: { method: string; url: string }[] = [];
  const normalized = await normalizePhoto(image, "image/png");
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET",
      headers = new Headers(init?.headers);
    calls.push({ url, method });
    assert.equal(
      headers.get("authorization"),
      "Bearer SYNTHETIC-LOCAL-TEST-NOT-A-REAL-CREDENTIAL",
    );
    assert.ok(init?.signal);
    assert.equal(init?.cache, "no-store");
    assert.ok(!url.includes("/public/"));
    if (method === "POST") {
      assert.equal(headers.get("x-upsert"), "false");
      assert.equal(headers.get("content-type"), "image/jpeg");
      return Response.json(
        {
          statusCode: "409",
          error: "Duplicate",
          message: "The resource already exists",
        },
        { status: 409 },
      );
    }
    return new Response(normalized.bytes, {
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    const request = randomUUID(),
      id = randomUUID();
    await run("a", (db, actor) =>
      uploadRequestPhoto(db, actor, request, id, image, "image/png"),
    );
    assert.equal(calls.length, 2);
    assert.ok(
      calls.every(
        (call) =>
          call.url.includes(`/storage/v1/object`) &&
          call.url.includes(`northside-private/${TENANT}/`),
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
