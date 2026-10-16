/** Destructive setup is restricted to an empty, explicitly named loopback test DB. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { authorizeOn, type Sql, type Actor } from "../lib/server/db";
import { opaqueToken, hashToken, AccessError } from "../lib/server/security";
import { TENANT, SHOP } from "../lib/server/providers";
import { createIntake, gradingCards, gradingCard } from "../lib/server/grading";
import { previewId } from "../lib/server/grading-preview";
import {
  operationsAction,
  batchWorkspace,
} from "../lib/server/grading-fulfillment";
import { batch } from "../lib/server/grading-operations";
import {
  portalData,
  cardQuotes,
  saveQuote,
  recordPortalDecision,
} from "../lib/server/grading-portal";
import { examWorkspace, saveExamDraft, publishExam } from "../lib/server/exam";
import { decisionSelection } from "../lib/grading-portal";
import {
  approveForTest,
  memoryPhotoStore,
  sampleQuote,
  sampleService,
} from "../tests/support/grading-exam-fixture";
const url = new URL(
  process.env.GRADING_TEST_DATABASE_URL || "postgres://invalid/",
);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !/^\/northside_grading_acceptance_[a-z0-9_]+$/.test(url.pathname)
)
  throw Error(
    "Use an empty loopback database named northside_grading_acceptance_<suffix>. Never use hosted credentials.",
  );
const pool = new Pool({
  connectionString: url.toString(),
  max: 5,
  application_name: "northside-grading-concurrency",
});
const tokens = { staff: opaqueToken(), a: opaqueToken() };
const store = memoryPhotoStore(),
  reason = "SAMPLE concurrent grading acceptance";
type Action<T> = (db: Sql, a: Actor) => Promise<T>;
async function begin(c: PoolClient, who: keyof typeof tokens) {
  await c.query("begin");
  await c.query("set local statement_timeout='6s'");
  await c.query("set local role northside_runtime");
  return authorizeOn(c as Sql, tokens[who]);
}
async function run<T>(who: string, fn: Action<T>): Promise<T> {
  assert.ok(who === "a" || who === "staff");
  const c = await pool.connect();
  try {
    const a = await begin(c, who);
    const r = await fn(c as Sql, a);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
const body = (v: Record<string, unknown>) => ({
  request_id: randomUUID(),
  reason,
  ...v,
});
async function prepare() {
  const r = await run("staff", (db, a) =>
    createIntake(
      db,
      a,
      {
        customer_id: previewId(1),
        description: "SAMPLE concurrency " + randomUUID(),
        quantity: 1,
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
  const card = (await run("staff", gradingCards)).find(
    (c) => c.case_id === r.case_id,
  )!;
  await approveForTest({ run }, [card.card_id], "a", store);
  const b = await run("staff", (db, a) =>
    batch(db, a, {
      operation: "create",
      provider: "psa",
      service: sampleService,
      reference: "SAMPLE concurrency",
      carrier: "SAMPLE carrier",
      tracking: "SAMPLE tracking",
      reason,
    }),
  );
  await run("staff", (db, a) =>
    operationsAction(
      db,
      a,
      body({
        action: "scan_batch",
        batch_id: b.id,
        batch_version: 1,
        code: card.card_id,
        method: "manual",
      }),
      store,
    ),
  );
  const w = await run("staff", (db, a) => batchWorkspace(db, a, b.id!));
  const dispatch = body({
    action: "dispatch",
    batch_id: b.id,
    batch_version: w.batch.version,
    cards: w.cards.map((c) => ({ card_id: c.card_id, version: c.version })),
    confirmed: true,
  });
  const owned = (await run("a", portalData)).cards.filter(
    (c) => c.card_id === card.card_id,
  );
  const withdraw = body({
    choice: "return",
    confirmed: true,
    cards: decisionSelection(owned),
  });
  const q = await run("staff", async (db, a) => ({
    ...sampleQuote,
    card_id: card.card_id,
    request_id: randomUUID(),
    previous_id: (await cardQuotes(db, a, card.card_id))[0].id,
    grading_cents: 3500,
  }));
  return { id: card.card_id, batch: b.id!, dispatch, withdraw, q };
}
// Hold the winning transaction open, observe the second connection waiting for
// its real PostgreSQL lock, then commit. Promise.all on PGlite cannot prove this.
async function overlap(
  firstWho: keyof typeof tokens,
  first: Action<unknown>,
  secondWho: keyof typeof tokens,
  second: Action<unknown>,
) {
  const c1 = await pool.connect(),
    c2 = await pool.connect();
  let waiting: Promise<{ value?: unknown; error?: unknown }> | undefined;
  try {
    const a1 = await begin(c1, firstWho);
    await first(c1 as Sql, a1);
    const a2 = await begin(c2, secondWho),
      pid = (await c2.query("select pg_backend_pid() pid")).rows[0].pid;
    waiting = second(c2 as Sql, a2).then(
      async (value) => {
        await c2.query("commit");
        return { value };
      },
      async (error) => {
        await c2.query("rollback");
        return { error };
      },
    );
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      blocked = (
        await pool.query("select cardinality(pg_blocking_pids($1))>0 blocked", [
          pid,
        ])
      ).rows[0].blocked;
      if (blocked) break;
      await delay(20);
    }
    assert.equal(
      blocked,
      true,
      "The competing operation must actually wait on another DB connection",
    );
    await c1.query("commit");
    return await waiting;
  } finally {
    await c1.query("rollback");
    if (waiting) await waiting;
    else await c2.query("rollback");
    c1.release();
    c2.release();
  }
}
try {
  assert.equal(
    (await pool.query("select to_regnamespace('ns')::text n")).rows[0].n,
    null,
    "Refuse to use an existing app database",
  );
  await pool.query(
    "create role anon; create role authenticated; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id int,bucket_id text); alter table storage.objects enable row level security;",
  );
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(await readFile("supabase/migrations/" + f, "utf8"));
  await pool.query(
    "insert into ns.customers(tenant_id,id,display_name) values($1,$2,$3)",
    [TENANT, previewId(1), "SAMPLE concurrency collector"],
  );
  await pool.query(
    "insert into ns.customer_identities(tenant_id,customer_id,shop,provider,subject) values($1,$2,$3,'shopify','SAMPLE-concurrency')",
    [TENANT, previewId(1), SHOP],
  );
  await pool.query(
    "insert into ns.staff_memberships(tenant_id,id,auth_user_id,role) values($1,$2,$3,'operations')",
    [TENANT, previewId(10), previewId(110)],
  );
  for (const who of ["a", "staff"] as const)
    await pool.query(
      "insert into ns.sessions(token_hash,tenant_id,customer_id,staff_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,$4,$5,'SAMPLE',now()+interval '1 hour',now()+interval '1 hour')",
      [
        hashToken(tokens[who]),
        TENANT,
        who === "a" ? previewId(1) : null,
        who === "staff" ? previewId(10) : null,
        who === "a" ? "shopify" : "supabase",
      ],
    );
  for (const mode of [
    "quote-before-dispatch",
    "return-before-dispatch",
    "exam-before-dispatch",
    "dispatch-before-quote",
    "dispatch-before-return",
    "duplicate-dispatch",
  ] as const) {
    const x = await prepare(),
      dispatch: Action<unknown> = (db, a) =>
        operationsAction(db, a, x.dispatch, store),
      quote: Action<unknown> = (db, a) => saveQuote(db, a, x.q),
      withdraw: Action<unknown> = (db, a) =>
        recordPortalDecision(db, a, x.withdraw);
    let result: { value?: unknown; error?: unknown };
    if (mode === "quote-before-dispatch")
      result = await overlap("staff", quote, "staff", dispatch);
    else if (mode === "return-before-dispatch")
      result = await overlap("a", withdraw, "staff", dispatch);
    else if (mode === "exam-before-dispatch")
      result = await overlap(
        "staff",
        async (db, a) => {
          const ex = await examWorkspace(db, a, x.id);
          const d = await saveExamDraft(db, a, x.id, {
            version: ex.draft!.version,
            fields: {
              ...ex.draft!.fields,
              projected_grade: "SAMPLE corrected estimate 6",
            },
            internal_notes: "SAMPLE private",
          });
          return publishExam(
            db,
            a,
            x.id,
            { version: d.version, signoff: true, reason },
            store,
          );
        },
        "staff",
        dispatch,
      );
    else if (mode === "dispatch-before-quote")
      result = await overlap("staff", dispatch, "staff", quote);
    else if (mode === "dispatch-before-return")
      result = await overlap("staff", dispatch, "a", withdraw);
    else result = await overlap("staff", dispatch, "staff", dispatch);
    if (mode === "duplicate-dispatch") {
      assert.ifError(result.error);
      assert.equal((result.value as { duplicate: boolean }).duplicate, true);
    } else
      assert.ok(
        result.error instanceof AccessError && result.error.status === 409,
        `${mode}: expected stale/conflicting action rejection, got ${String(result.error)}`,
      );
    const c = await run("staff", (db, a) => gradingCard(db, a, x.id));
    const count = (
      await pool.query(
        "select count(*)::int n from ns.grading_dispatches where batch_id=$1",
        [x.batch],
      )
    ).rows[0].n;
    if (mode.endsWith("before-dispatch")) {
      assert.equal(count, 0);
      assert.equal(c.custody, "northside");
    } else {
      assert.equal(count, 1);
      assert.equal(c.custody, "grader");
    }
    console.log("PASS real PostgreSQL concurrent " + mode);
  }
  console.log(
    "PASS six actual overlapping transaction checks on " +
      (await pool.query("select version() v")).rows[0].v,
  );
} finally {
  await pool.end();
}
