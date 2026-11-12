import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import { publishServiceTerms } from "../lib/server/card-tracking";
import {
  submitRequest,
  listRequests,
  staffRequestData,
  updateRequest,
  convertRequest,
  requestClaim,
  reviewRequestClaim,
  drainRequestOutbox,
} from "../lib/server/service-requests";
import {
  serviceRequestHttp,
  publicServiceRequestHttp,
  serviceRequestAction,
} from "../lib/server/service-requests-http";
import { AccessError, hashToken } from "../lib/server/security";
import { requestSchema } from "../../../packages/customer-contracts/src/service-requests";
import { consignmentPayoutCents } from "../../../packages/customer-contracts/src/service-money";
import { TENANT } from "../lib/server/providers";
const dir = await mkdtemp(join(tmpdir(), "northside-service-requests-")),
  f = await openPreviewDatabase(dir);
after(async () => {
  await f.db.close();
  await rm(dir, { recursive: true, force: true });
});
const body = () => ({
  request_id: randomUUID(),
  claim_token: randomBytes(32).toString("base64url"),
  kind: "inquiry",
  service: "consignment",
  contact: {
    name: "SAMPLE request collector",
    email: "sample@example.invalid",
    phone: "8155550100",
  },
  details: { question: "SAMPLE availability question" },
  terms_id: null as string | null,
  terms_accepted: false,
});
const denied = (n: number) => (e: unknown) =>
  e instanceof AccessError && e.status === n;
const guest = (b: unknown) =>
  f.db.transaction(async (db) => {
    await db.exec("set local role northside_runtime");
    return submitRequest(
      db,
      null,
      b,
      "shopify_website",
      hashToken("SAMPLE test origin"),
    );
  });
const serviceBody = async () => {
  const term = await f.run("staff", (db, a) =>
    publishServiceTerms(db, a, {
      service: "consignment",
      version: randomUUID(),
      title: "SAMPLE isolated terms",
      body: "SAMPLE fixture consent only. This is not a business rate or legal activation.",
      approval_reference: "SAMPLE local test evidence",
      previous_id: null,
    }),
  );
  return {
    ...body(),
    kind: "service_request",
    terms_id: term.id,
    terms_accepted: true,
    details: {
      listing_count: 7,
      delivery_method: "planning_delivery",
      inbound_carrier: "",
      inbound_tracking_number: "",
      instructions: "None",
    },
  };
};
test("staff request queue exposes editing only to existing writer roles", async () => {
  for (const role of ["owner", "admin", "operations", "read_only"] as const) {
    const result = await f.run("staff", (db, actor) =>
      staffRequestData(db, { ...actor, staff_role: role }),
    );
    assert.equal(result.can_edit, role !== "read_only");
  }
  await assert.rejects(
    f.run("staff", (db, actor) =>
      staffRequestData(db, { ...actor, staff_role: "content_editor" }),
    ),
    denied(403),
  );
});
test("request contract separates inquiry authorization and validates integer listings, explicit terms and manual address", () => {
  assert.equal(requestSchema.safeParse(body()).success, true);
  const s = {
    ...body(),
    kind: "service_request",
    terms_id: randomUUID(),
    terms_accepted: true,
    details: {
      listing_count: 1,
      delivery_method: "shipped",
      inbound_carrier: "",
      inbound_tracking_number: "optional plain text",
      instructions: "None",
    },
  };
  assert.equal(requestSchema.safeParse(s).success, true);
  for (const count of [0, -1, 1.5])
    assert.equal(
      requestSchema.safeParse({
        ...s,
        details: { ...s.details, listing_count: count },
      }).success,
      false,
    );
  assert.equal(
    requestSchema.safeParse({ ...s, terms_accepted: false }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({ ...body(), customer_id: previewId(2) }).success,
    false,
  );
  const g = {
    ...s,
    service: "grading",
    details: {
      provider: "SGC",
      service_level_id: null,
      declared_value_cents: null,
      address: {
        line1: "SAMPLE address",
        line2: "",
        city: "SAMPLE city",
        region: "IL",
        postal_code: "00000",
        country: "US",
      },
      instructions: "",
    },
  };
  assert.equal(requestSchema.safeParse(g).success, true);
  assert.equal(
    requestSchema.safeParse({
      ...g,
      details: {
        ...g.details,
        address: { ...g.details.address, postal_code: "" },
      },
    }).success,
    false,
  );
});
test("guest capture is durable, email grants no access, and canonical retry preserves one reference", async () => {
  const b = body(),
    first = await guest(b),
    second = await guest({ ...b, details: { question: b.details.question } });
  assert.equal(first.id, second.id);
  assert.equal(second.duplicate, true);
  await assert.rejects(
    guest({ ...b, contact: { ...b.contact, name: "Changed" } }),
    denied(409),
  );
  assert.equal(
    (await f.run("a", listRequests)).requests.some((r) => r.id === first.id),
    false,
  );
  const saved = (await f.run("staff", listRequests)).requests.find(
    (r) => r.id === first.id,
  )!;
  assert.equal(saved.customer_id, null);
  assert.equal(saved.received_at, null);
  assert.equal(saved.intake_result, null);
  assert.equal(JSON.stringify(saved).includes(b.claim_token), false);
  await assert.rejects(f.run("editor", listRequests), denied(403));
});
test("actual read-only database session cannot read private request notes", async () => {
  const receipt = await guest(body());
  await f.run("staff", (db, actor) => updateRequest(db, actor, {
    id: receipt.id, version: 1, state: "review", staff_owner: null,
    follow_up_at: null, staff_note: "PRIVATE regression note",
    reason: "PRIVATE regression reason", customer_message: "SAMPLE public update",
  }));
  const writer = await f.run("staff", staffRequestData);
  assert.ok(writer.notes.some((n) => n.request_id === receipt.id));
  const reader = await f.run("reader", staffRequestData);
  assert.deepEqual(reader.notes, []);
  assert.equal(JSON.stringify(reader).includes("PRIVATE regression"), false);
  const raw = await f.run("reader", (db) => db.query("select * from ns.service_request_notes where request_id=$1", [receipt.id]));
  assert.deepEqual(raw.rows, []);
  await assert.rejects(f.run("editor", staffRequestData), denied(403));
});
test("rejected claims never report pending or reopen; pending retries recover the same claim", async () => {
  const b = body(), receipt = await guest(b);
  const claim = () => f.run("a", (db, actor) => requestClaim(db, actor, { id: receipt.id, claim_token: b.claim_token }));
  const first = await claim();
  assert.equal((await claim()).claim_id, first.claim_id);
  await f.run("staff", (db, actor) => reviewRequestClaim(db, actor, {
    claim_id: first.claim_id, approved: false,
    verification_reference: "SAMPLE independent evidence insufficient", reason: "SAMPLE reject",
  }));
  await assert.rejects(claim(), denied(409));
  assert.equal((await f.db.query<{status: string}>("select status from ns.service_request_claims where id=$1", [first.claim_id])).rows[0].status, "rejected");
  assert.equal((await f.run("a", listRequests)).requests.some((r) => r.id === receipt.id), false);
});
test("saved grading receipt recovers after level and terms change, but new submissions must use current configuration", async () => {
  const term = await f.run("staff", (db, actor) => publishServiceTerms(db, actor, {
    service: "grading", version: randomUUID(), title: "SAMPLE local grading terms",
    body: "SAMPLE local consent only", approval_reference: "SAMPLE isolated fixture", previous_id: null,
  }));
  const level = randomUUID();
  await f.db.query("insert into ns.request_grading_service_levels(tenant_id,id,provider,name,declared_value_limit_cents,active,approval_reference) values($1,$2,'PSA','SAMPLE level',10000,true,'SAMPLE local fixture')", [TENANT, level]);
  const b = { ...body(), service: "grading", kind: "service_request", terms_id: term.id, terms_accepted: true,
    details: { provider: "PSA", service_level_id: level, declared_value_cents: 10000,
      address: {line1: "SAMPLE address", line2: "", city: "SAMPLE city", region: "IL", postal_code: "00000", country: "US"}, instructions: "" } };
  const receipt = await guest(b);
  await f.db.query("update ns.request_grading_service_levels set active=false where tenant_id=$1 and id=$2", [TENANT, level]);
  assert.equal((await guest(b)).id, receipt.id);
  await assert.rejects(guest({...b, request_id: randomUUID()}), (e) => e instanceof AccessError && e.message === "request_service_level_changed");
  await f.run("staff", (db, actor) => publishServiceTerms(db, actor, {
    service: "grading", version: randomUUID(), title: "SAMPLE revised local terms",
    body: "SAMPLE revised consent only", approval_reference: "SAMPLE isolated revision", previous_id: term.id,
  }));
  assert.equal((await guest(b)).id, receipt.id);
  await assert.rejects(guest({...b, request_id: randomUUID()}), (e) => e instanceof AccessError && e.message === "request_terms_changed");
  const counts = (await f.db.query<{requests:number;events:number;secrets:number}>("select (select count(*)::int from ns.service_requests where id=$1) requests,(select count(*)::int from ns.service_request_events where request_id=$1) events,(select count(*)::int from ns.service_request_secrets where request_id=$1) secrets", [receipt.id])).rows[0];
  assert.deepEqual(counts, {requests:1, events:1, secrets:1});
});
test("unclassified database failure remains an uncertain save rather than a definitive conflict", async () => {
  const db = { query: async () => { throw new Error("SAMPLE connection lost after commit"); } };
  await assert.rejects(submitRequest(db, null, body(), "shopify_website", hashToken("SAMPLE")), (e) => e instanceof AccessError && e.status === 503 && e.message === "service_unavailable");
});
test("verified customer + secret + independent staff review links guest; exactly-once intake uses actual card count", async () => {
  const b = await serviceBody(),
    receipt = await guest(b);
  await assert.rejects(
    f.run("a", (db, a) =>
      requestClaim(db, a, { id: receipt.id, claim_token: body().claim_token }),
    ),
    denied(409),
  );
  const claim = await f.run("a", (db, a) =>
    requestClaim(db, a, { id: receipt.id, claim_token: b.claim_token }),
  );
  assert.equal(
    (await f.run("a", listRequests)).requests.some((r) => r.id === receipt.id),
    false,
  );
  await f.run("staff", (db, a) =>
    reviewRequestClaim(db, a, {
      claim_id: claim.claim_id,
      approved: true,
      verification_reference:
        "SAMPLE independent receipt and identity evidence",
      reason: "SAMPLE reviewed identity",
    }),
  );
  assert.equal((await guest(b)).reference, receipt.reference);
  let r = (await f.run("staff", listRequests)).requests.find(
    (r) => r.id === receipt.id,
  )!;
  await f.run("staff", (db, a) =>
    updateRequest(db, a, {
      id: r.id,
      version: r.version,
      state: "review",
      staff_owner: null,
      follow_up_at: null,
      staff_note: "PRIVATE staff-only note",
      reason: "PRIVATE staff-only reason",
      customer_message: "SAMPLE review started",
    }),
  );
  r = (await f.run("staff", listRequests)).requests.find(
    (r) => r.id === receipt.id,
  )!;
  assert.equal(
    JSON.stringify(await f.run("a", listRequests)).includes("PRIVATE"),
    false,
  );
  const conversion = {
    id: r.id,
    version: r.version,
    quantity: 2,
    received_date: "2026-11-06",
    description: "SAMPLE physical cards",
    receipt_evidence: "SAMPLE physical receipt evidence",
    reason: "SAMPLE physical intake",
  };
  await assert.rejects(
    f.run("reader", (db, a) => convertRequest(db, a, conversion)),
    denied(403),
  );
  const first = await f.run("staff", (db, a) =>
    convertRequest(db, a, conversion),
  );
  const retry = await f.run("staff", (db, a) =>
    convertRequest(db, a, conversion),
  );
  assert.equal(retry.duplicate, true);
  assert.deepEqual(first.intake, retry.intake);
  assert.equal((first.intake.items as string[]).length, 2);
  for (const state of [
    "in_progress",
    "follow_up",
    "in_progress",
    "completed",
    "review",
    "in_progress",
  ]) {
    const current = (await f.run("staff", listRequests)).requests.find(
      (x) => x.id === r.id,
    )!;
    await f.run("staff", (db, a) =>
      updateRequest(db, a, {
        id: current.id,
        version: current.version,
        state,
        staff_owner: null,
        follow_up_at: state === "follow_up" ? "2026-11-07T18:00:00.000Z" : null,
        reason: "SAMPLE pause, resume and reopen without duplicate intake",
      }),
    );
  }
  assert.deepEqual(
    (await f.run("staff", (db, a) => convertRequest(db, a, conversion))).intake,
    first.intake,
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      convertRequest(db, a, { ...conversion, quantity: 3 }),
    ),
    denied(409),
  );
  assert.equal(
    (await f.run("b", listRequests)).requests.some((x) => x.id === r.id),
    false,
  );
  await assert.rejects(
    f.run("a", (db, a) =>
      requestClaim(db, a, { id: r.id, claim_token: b.claim_token }),
    ),
    denied(409),
  );
});
test("outbox only writes a redacted test sink and keeps successful request commits independent of delivery failure", async () => {
  const b = body();
  await guest(b);
  const failed = await f.run("staff", (db, a) =>
    drainRequestOutbox(db, a, true),
  );
  assert.equal(failed.real_messages_sent, 0);
  assert.ok(
    (
      await f.db.query(
        "select id from ns.service_requests where submission_id=$1",
        [b.request_id],
      )
    ).rows.length,
  );
  await f.db.query(
    "update ns.service_request_outbox set next_attempt_at=now()-interval '1 second' where state='failed'",
  );
  const done = await f.run("staff", (db, a) => drainRequestOutbox(db, a));
  assert.equal(done.sink, "test_only");
  const sink = JSON.stringify(
    (await f.db.query("select * from ns.service_request_test_sink")).rows,
  );
  assert.equal(sink.includes(b.contact.email), false);
  assert.equal(
    (await f.run("staff", (db, a) => drainRequestOutbox(db, a))).processed,
    0,
  );
});
test("exact half-up currency fixtures use hammer only and reject invalid money", () => {
  assert.equal(consignmentPayoutCents(10000, 10500), 10500);
  assert.equal(consignmentPayoutCents(100000, 10500), 105000);
  assert.equal(consignmentPayoutCents(1, 15000), 2);
  assert.throws(() => consignmentPayoutCents(1.5, 10500));
  assert.throws(() => consignmentPayoutCents(-1, 10500));
});
test("staff captures a bounded inquiry without email linking or accepting service terms for a collector", async () => {
  const b = body();
  const req = (input: unknown) =>
    new Request(
      "http://127.0.0.1:3104/api/preview/service-requests?actor=staff",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit", input }),
      },
    );
  const saved = (await f.run("staff", (db, a) =>
    serviceRequestAction(req(b), db, a),
  )) as { id: string; reference: string; requires_claim: boolean };
  const repeat = (await f.run("staff", (db, a) =>
    serviceRequestAction(req(b), db, a),
  )) as { id: string };
  assert.equal(saved.id, repeat.id);
  assert.equal(saved.requires_claim, true);
  const r = (await f.run("staff", listRequests)).requests.find(
    (x) => x.id === saved.id,
  )!;
  assert.equal(r.source, "staff");
  assert.equal(r.customer_id, null);
  assert.equal(r.received_at, null);
  assert.equal(r.terms_id, null);
  await assert.rejects(
    f.run("reader", (db, a) => serviceRequestAction(req(body()), db, a)),
    denied(403),
  );
  await assert.rejects(
    f.run("editor", (db, a) => serviceRequestAction(req(body()), db, a)),
    denied(403),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      serviceRequestAction(req({ ...b, kind: "service_request" }), db, a),
    ),
    denied(403),
  );
});
test("HTTP rejects cross-origin private mutation and unconfigured public transport; preview cannot activate in production", async () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    NORTHSIDE_FIXTURES: process.env.NORTHSIDE_FIXTURES,
    SERVICE_REQUEST_ALLOWED_ORIGINS:
      process.env.SERVICE_REQUEST_ALLOWED_ORIGINS,
  };
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.NORTHSIDE_FIXTURES = "1";
    delete process.env.SERVICE_REQUEST_ALLOWED_ORIGINS;
    assert.equal(
      (
        await serviceRequestHttp(
          new Request(
            "https://stage.example.test/api/preview/service-requests",
          ),
          true,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await publicServiceRequestHttp(
          new Request(
            "https://stage.example.test/api/public/v1/service-requests",
            { headers: { origin: "https://shop.example.test" } },
          ),
        )
      ).status,
      503,
    );
    process.env.SERVICE_REQUEST_ALLOWED_ORIGINS = "https://shop.example.test";
    assert.equal(
      (
        await publicServiceRequestHttp(
          new Request(
            "https://stage.example.test/api/public/v1/service-requests",
            {
              method: "OPTIONS",
              headers: { origin: "https://shop.example.test" },
            },
          ),
        )
      ).status,
      204,
    );
    assert.equal(
      (
        await publicServiceRequestHttp(
          new Request(
            "https://stage.example.test/api/public/v1/service-requests",
            {
              method: "POST",
              headers: { origin: "https://evil.example.test" },
            },
          ),
        )
      ).status,
      403,
    );
    const request = new Request(
      "http://127.0.0.1:3000/api/preview/service-requests?actor=a",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit", input: body() }),
      },
    );
    await f.run("a", (db, a) => serviceRequestAction(request, db, a));
  } finally {
    for (const [k, v] of Object.entries(original))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
