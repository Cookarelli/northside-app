import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { openPreviewDatabase } from "../lib/server/grading-preview";
import { localRequestPhotoStore } from "../lib/server/service-request-photo-local";
import { requestPhotoAction } from "../lib/server/service-request-photo-http";
import { normalizePhoto } from "../lib/server/exam-storage";
import { publishServiceTerms } from "../lib/server/card-tracking";
import { recoverRequest, submitRequest } from "../lib/server/service-requests";
import { serviceRequestAction } from "../lib/server/service-requests-http";
import { AccessError } from "../lib/server/security";
import { MAX_PHOTO_BYTES } from "../lib/exam";
import { TENANT } from "../lib/server/providers";

const previousEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  NORTHSIDE_FIXTURES: process.env.NORTHSIDE_FIXTURES,
};
Object.assign(process.env, { NODE_ENV: "test", NORTHSIDE_FIXTURES: "1" });
const directory = await mkdtemp(join(tmpdir(), "northside-photo-http-"));
let fixture = await openPreviewDatabase(join(directory, "db"));
const storageDirectory = join(directory, "private");
const store = localRequestPhotoStore(storageDirectory);
const image = await sharp({
  create: { width: 40, height: 60, channels: 3, background: "blue" },
})
  .png()
  .toBuffer();
const alternate = await sharp({
  create: { width: 40, height: 60, channels: 3, background: "red" },
})
  .png()
  .toBuffer();
const normalized = await normalizePhoto(image, "image/png");
const submission = randomUUID(),
  photo = randomUUID();
const origin = "https://local-photo-test.invalid";
const denied = (status: number) => (error: unknown) =>
  error instanceof AccessError && error.status === status;
const action = (who: string, request: Request) =>
  fixture.run(who, (db, actor) =>
    requestPhotoAction(request, db, actor, store),
  );
const upload = (
  requestId = submission,
  photoId = photo,
  bytes: Uint8Array = image,
) =>
  new Request(
    `${origin}/api/private/service-request-photos?request_id=${requestId}&photo_id=${photoId}`,
    {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(bytes),
    },
  );
const read = (id = photo) =>
  new Request(`${origin}/api/private/service-request-photos?photo_id=${id}`);
let saved: Awaited<ReturnType<typeof submitRequest>> | null = null;

after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("photo HTTP action confirms actual private bytes and immutable retry identity", async () => {
  const first = await action("a", upload());
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { id: photo });
  const customer = (await fixture.run(
    "a",
    async (_db, actor) => actor.customer_id,
  ))!;
  const file = join(
    storageDirectory,
    `${TENANT}/${customer}/requests/${submission}/${photo}.jpg`,
  );
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const received = await action("a", read());
  assert.equal(received.status, 200);
  assert.deepEqual(Buffer.from(await received.arrayBuffer()), normalized.bytes);
  assert.equal(received.headers.get("content-type"), "image/jpeg");
  assert.match(
    received.headers.get("cache-control") ?? "",
    /private.*no-store/,
  );
  assert.equal(
    received.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.equal(received.headers.get("referrer-policy"), "no-referrer");
  assert.equal(received.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await (await action("a", upload())).json(), { id: photo });
  assert.equal(
    (
      await fixture.db.query<{ n: number }>(
        "select count(*)::int n from ns.service_request_photos where id=$1",
        [photo],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    action("a", upload(submission, photo, alternate)),
    denied(409),
  );
});

test("photo HTTP query and body validation fail before creating records", async () => {
  const before = (
    await fixture.db.query<{ n: number }>(
      "select count(*)::int n from ns.service_request_photos",
    )
  ).rows[0].n;
  for (const query of [
    "photo_id=not-a-uuid",
    `photo_id=${photo}&photo_id=${randomUUID()}`,
    `photo_id=${photo}&unexpected=1`,
    `photo_id=${photo}&request_id=${submission}`,
    `photo_id=${photo}&actor=b`,
  ])
    await assert.rejects(
      action(
        "a",
        new Request(`${origin}/api/private/service-request-photos?${query}`),
      ),
      denied(400),
    );
  await assert.rejects(
    action(
      "a",
      new Request(
        `${origin}/api/private/service-request-photos?photo_id=${photo}`,
        { method: "DELETE" },
      ),
    ),
    denied(405),
  );
  await assert.rejects(
    action(
      "a",
      new Request(
        `${origin}/api/private/service-request-photos?photo_id=${randomUUID()}`,
        {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: image,
        },
      ),
    ),
    denied(400),
  );
  await assert.rejects(
    action(
      "a",
      upload(randomUUID(), randomUUID(), Buffer.from("not an image")),
    ),
    denied(415),
  );
  const oversized = upload(randomUUID(), randomUUID(), image);
  oversized.headers.set("content-length", String(MAX_PHOTO_BYTES + 1));
  await assert.rejects(action("a", oversized), denied(413));
  await assert.rejects(
    action(
      "a",
      upload(randomUUID(), randomUUID(), new Uint8Array(MAX_PHOTO_BYTES + 1)),
    ),
    denied(413),
  );
  assert.equal(
    (
      await fixture.db.query<{ n: number }>(
        "select count(*)::int n from ns.service_request_photos",
      )
    ).rows[0].n,
    before,
  );
});

test("photo HTTP owner and staff authorization protects drafts", async () => {
  for (const who of ["b", "staff", "reader"])
    await assert.rejects(action(who, read()), denied(404));
  await assert.rejects(action("editor", read()), denied(403));
  await assert.rejects(
    action("staff", upload(randomUUID(), randomUUID())),
    denied(403),
  );
  await assert.rejects(action("a", read(randomUUID())), denied(404));
});

test("saved request photos are staff-readable only after exact attachment snapshot", async () => {
  const unattached = randomUUID();
  await action("a", upload(submission, unattached));
  const term = await fixture.run("staff", (db, actor) =>
    publishServiceTerms(db, actor, {
      service: "consignment",
      version: randomUUID(),
      title: "SAMPLE HTTP terms",
      body: "SAMPLE local test terms only. No business activation.",
      approval_reference: "SAMPLE local verification",
      previous_id: null,
    }),
  );
  saved = await fixture.run("a", (db, actor) =>
    submitRequest(
      db,
      actor,
      {
        request_id: submission,
        claim_token: randomBytes(32).toString("base64url"),
        kind: "service_request",
        service: "consignment",
        contact: {
          name: "SAMPLE collector",
          email: "sample@example.invalid",
          phone: "8155550100",
        },
        details: {
          listing_count: 1,
          delivery_method: "planning_delivery",
          inbound_carrier: "",
          inbound_tracking_number: "",
          instructions: "SAMPLE",
          items: [{ description: "SAMPLE card for review", quantity: 1 }],
          photo_ids: [photo],
        },
        terms_id: term.id,
        terms_accepted: true,
      },
      "customer_web",
    ),
  );
  assert.ok(saved.reference);
  assert.equal(saved.state, "new");
  for (const who of ["staff", "reader"]) {
    const response = await action(who, read());
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      normalized.bytes,
    );
    await assert.rejects(action(who, read(unattached)), denied(404));
  }
  await assert.rejects(action("b", read()), denied(404));
  await assert.rejects(
    action("a", upload(submission, randomUUID())),
    denied(409),
  );
});

test("receipt recovery is owner-scoped, independent of private claim code", async () => {
  if (!saved) throw new Error("SAMPLE saved request required");
  const response = await fixture.run("a", (db, actor) =>
    serviceRequestAction(
      new Request(
        `${origin}/api/private/service-requests?recover=${submission}`,
      ),
      db,
      actor,
    ),
  );
  assert.ok("receipt" in response);
  assert.equal(response.receipt?.id, saved.id);
  assert.equal(response.receipt?.reference, saved.reference);
  assert.equal(response.receipt?.duplicate, true);
  assert.equal(response.receipt?.requires_claim, false);
  assert.equal("claim_token" in (response.receipt ?? {}), false);
  assert.deepEqual(
    await fixture.run("b", (db, actor) =>
      recoverRequest(db, actor, submission),
    ),
    { receipt: null },
  );
  await assert.rejects(
    fixture.run("staff", (db, actor) => recoverRequest(db, actor, submission)),
    denied(403),
  );
  assert.deepEqual(
    await fixture.run("a", (db, actor) =>
      recoverRequest(db, actor, randomUUID()),
    ),
    { receipt: null },
  );
});

test("photo and receipt HTTP actions survive database reopen", async () => {
  if (!saved) throw new Error("SAMPLE saved request required");
  const reference = saved.reference;
  await fixture.db.close();
  fixture = await openPreviewDatabase(join(directory, "db"));
  const receipt = await fixture.run("a", (db, actor) =>
    recoverRequest(db, actor, submission),
  );
  assert.equal(receipt.receipt?.reference, reference);
  assert.deepEqual(
    Buffer.from(await (await action("a", read())).arrayBuffer()),
    normalized.bytes,
  );
  assert.deepEqual(await (await action("a", upload())).json(), { id: photo });
});

test("fixture photo store rejects unsafe keys, preserves bytes, and closes in production", async () => {
  const customer = randomUUID(),
    request = randomUUID(),
    id = randomUUID();
  const key = `${TENANT}/${customer}/requests/${request}/${id}.jpg`;
  for (const invalid of [
    "../outside.jpg",
    key.replace(".jpg", "Xjpg"),
    key.toUpperCase(),
    `${key}/extra`,
    `/${key}`,
  ]) {
    await assert.rejects(store.put(invalid, normalized.bytes), denied(400));
    await assert.rejects(store.read(invalid), denied(400));
  }
  await store.put(key, normalized.bytes);
  await store.put(key, Buffer.from("different bytes"));
  assert.deepEqual(Buffer.from(await store.read(key)), normalized.bytes);
  Object.assign(process.env, {
    NODE_ENV: "production",
    NORTHSIDE_FIXTURES: "1",
  });
  try {
    assert.throws(() => localRequestPhotoStore(storageDirectory), denied(404));
    await assert.rejects(store.read(key), denied(404));
    await assert.rejects(store.put(key, normalized.bytes), denied(404));
  } finally {
    Object.assign(process.env, { NODE_ENV: "test", NORTHSIDE_FIXTURES: "1" });
  }
});
