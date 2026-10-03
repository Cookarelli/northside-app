import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { authorizeOn, type Sql, type Actor } from "../lib/server/db";
import {
  listCards,
  readCard,
  appendStatus,
  exportCards,
  authorizedFile,
} from "../lib/server/records";
import {
  hashToken,
  opaqueToken,
  seal,
  unseal,
  sameOrigin,
  safeReturn,
  AccessError,
} from "../lib/server/security";
import {
  revokeSession,
  refreshOn,
  establishCustomer,
} from "../lib/server/sessions";
const T = "11111111-1111-4111-8111-111111111111",
  T2 = "22222222-2222-4222-8222-222222222222";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const db = await PGlite.create();
process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APP_ORIGIN = "https://preview.example.test";
await db.exec(
  await readFile(
    "supabase/migrations/202609120001_identity_and_records.sql",
    "utf8",
  ),
);
const tokens = {
  a: opaqueToken(),
  b: opaqueToken(),
  other: opaqueToken(),
  owner: opaqueToken(),
  admin: opaqueToken(),
  ops: opaqueToken(),
  editor: opaqueToken(),
  reader: opaqueToken(),
};
await db.query(
  "insert into ns.tenants(id,slug,shop,is_test) values($1,'isolation-only','test-shop.myshopify.com',true)",
  [T2],
);
for (const [tenant, c] of [
  [T, 1],
  [T, 2],
  [T2, 3],
] as const) {
  await db.query("insert into ns.customers(tenant_id,id) values($1,$2)", [
    tenant,
    id(c),
  ]);
  await db.query(
    "insert into ns.service_cases(tenant_id,id,customer_id,kind) values($1,$2,$3,'grading')",
    [tenant, id(c + 10), id(c)],
  );
}
await db.query(
  "insert into ns.grading_batches(tenant_id,id,reference) values($1,$2,'SAMPLE POOLED BATCH')",
  [T, id(20)],
);
for (const [tenant, c] of [
  [T, 1],
  [T, 2],
  [T2, 3],
] as const)
  await db.query(
    "insert into ns.card_items(tenant_id,id,customer_id,case_id,batch_id,description) values($1,$2,$3,$4,$5,$6)",
    [
      tenant,
      id(c + 30),
      id(c),
      id(c + 10),
      tenant === T ? id(20) : null,
      c === 1 ? '=HYPERLINK("sample")' : `SAMPLE CARD ${c}`,
    ],
  );
await db.query(
  "insert into ns.staff_notes(tenant_id,card_id,body) values($1,$2,'PRIVATE STAFF NOTE')",
  [T, id(31)],
);
await db.query(
  "insert into ns.file_objects(tenant_id,id,card_id,customer_id,object_key,mime_type,ready) values($1,$2,$3,$4,'11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000001/a','image/png',true),($1,$5,$6,$7,'11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000002/b','image/png',true)",
  [T, id(50), id(31), id(1), id(51), id(32), id(2)],
);
for (const [name, tenant, c] of [
  ["a", T, 1],
  ["b", T, 2],
  ["other", T2, 3],
] as const) {
  const h = hashToken(tokens[name]);
  await db.query(
    "insert into ns.sessions(token_hash,tenant_id,customer_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'shopify',$4,now()+interval '1 hour',now()+interval '8 hours')",
    [
      h,
      tenant,
      id(c),
      seal(
        {
          access_token: "LOCAL TEST ONLY",
          refresh_token: "test",
          subject: `test:${c}`,
        },
        h,
      ),
    ],
  );
}
for (const [i, name, role] of [
  [0, "owner", "owner"],
  [1, "admin", "admin"],
  [2, "ops", "operations"],
  [3, "editor", "content_editor"],
  [4, "reader", "read_only"],
] as const) {
  await db.query(
    "insert into ns.staff_memberships(tenant_id,id,auth_user_id,role) values($1,$2,$3,$4)",
    [T, id(60 + i), id(70 + i), role],
  );
  const h = hashToken(tokens[name]);
  await db.query(
    "insert into ns.sessions(token_hash,tenant_id,staff_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'supabase',$4,now()+interval '1 hour',now()+interval '8 hours')",
    [
      h,
      T,
      id(60 + i),
      seal({ access_token: "TEST ONLY", subject: id(70 + i) }, h),
    ],
  );
}
async function run<T>(
  token: string,
  fn: (sql: Sql, actor: Actor) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role northside_runtime");
    const sql = tx as unknown as Sql;
    return fn(sql, await authorizeOn(sql, token));
  });
}
const forbidden = (s: number) => (e: unknown) =>
  e instanceof AccessError && e.status === s;
test("two customers in one pooled batch see only their own card; other tenant isolated", async () => {
  assert.equal((await run(tokens.a, listCards))[0].id, id(31));
  assert.equal((await run(tokens.a, listCards)).length, 1);
  assert.equal((await run(tokens.b, listCards))[0].id, id(32));
  assert.equal((await run(tokens.other, listCards))[0].id, id(33));
  await assert.rejects(
    run(tokens.a, (q, a) => readCard(q, a, id(32))),
    forbidden(404),
  );
  await assert.rejects(
    run(tokens.a, (q, a) => readCard(q, a, id(33))),
    forbidden(404),
  );
});
test("database RLS independently hides other cards, private notes and pooled batch totals", async () => {
  await run(tokens.a, async (q) => {
    assert.equal((await q.query("select * from ns.card_items")).rows.length, 1);
    assert.equal(
      (await q.query("select * from ns.staff_notes")).rows.length,
      0,
    );
    assert.equal(
      (await q.query("select * from ns.grading_batches")).rows.length,
      0,
    );
  });
  await assert.rejects(
    run(tokens.a, (q) => q.query("select encrypted_tokens from ns.sessions")),
    /permission denied/,
  );
});
test("forged identity settings cannot override the authenticated session", async () => {
  await run(tokens.a, async (q) => {
    await q.query(
      "select set_config('ns.customer_id',$1,true),set_config('ns.tenant_id',$2,true)",
      [id(2), T2],
    );
    assert.equal(
      (await q.query<{ id: string }>("select id from ns.card_items")).rows[0]
        .id,
      id(31),
    );
  });
  await assert.rejects(run(opaqueToken(), listCards), forbidden(401));
  await assert.rejects(run("bad", listCards), forbidden(401));
});
test("tenant and ownership composite foreign keys reject forged children", async () => {
  await assert.rejects(
    db.query(
      "insert into ns.card_items(tenant_id,id,customer_id,case_id,description) values($1,$2,$3,$4,'bad')",
      [T, id(98), id(2), id(11)],
    ),
    /foreign key/,
  );
  await assert.rejects(
    db.query(
      "insert into ns.card_items(tenant_id,id,customer_id,case_id,batch_id,description) values($1,$2,$3,$4,$5,'bad')",
      [T2, id(97), id(3), id(13), id(20)],
    ),
    /foreign key/,
  );
});
test("operations status edits audit actor/time/source/reason; read-only and editor cannot write", async () => {
  const result = await run(tokens.ops, (q, a) =>
    appendStatus(q, a, id(31), {
      label: "Reviewed",
      reason: "Local privacy test",
      actor_id: id(1),
    }),
  );
  assert.ok(result.id);
  const audit = (
    await db.query<{ actor_id: string; reason: string }>(
      "select actor_id,reason from ns.audit_records",
    )
  ).rows[0];
  assert.equal(audit.actor_id, id(62));
  assert.equal(audit.reason, "Local privacy test");
  for (const t of [tokens.a, tokens.reader, tokens.editor])
    await assert.rejects(
      run(t, (q, a) =>
        appendStatus(q, a, id(31), { label: "Forged", reason: "Bad" }),
      ),
      forbidden(403),
    );
  await assert.rejects(
    run(tokens.reader, (q) =>
      q.query(
        "insert into ns.status_events(tenant_id,card_id,customer_id,label,reason,source,actor_id) values($1,$2,$3,'Forged','Bad','staff',$4)",
        [T, id(31), id(1), id(64)],
      ),
    ),
    /row-level security/,
  );
});
test("customer event projection excludes audit reasons and staff identifiers", async () => {
  const c = await run(tokens.a, (q, a) => readCard(q, a, id(31)));
  assert.ok(c.events.length);
  assert.ok(!JSON.stringify(c).includes("Local privacy test"));
  assert.ok(!JSON.stringify(c).includes("PRIVATE STAFF NOTE"));
  assert.ok(!("batch_id" in c));
});
test("file lookup is authorized before any signing; unknown/foreign IDs denied", async () => {
  assert.equal(
    (await run(tokens.a, (q, a) => authorizedFile(q, a, id(50)))).object_key,
    "11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000001/a",
  );
  await assert.rejects(
    run(tokens.a, (q, a) => authorizedFile(q, a, id(51))),
    forbidden(404),
  );
  await assert.rejects(
    run(tokens.editor, (q, a) => authorizedFile(q, a, id(50))),
    forbidden(403),
  );
});
test("CSV exports only owned records and neutralizes formula execution", async () => {
  const csv = await run(tokens.a, exportCards);
  assert.ok(csv.includes("'="));
  assert.ok(!csv.includes("SAMPLE CARD 2"));
  assert.ok(!csv.includes("SAMPLE CARD 3"));
  await assert.rejects(run(tokens.editor, exportCards), forbidden(403));
});
test("expired session and deactivated staff membership are rejected by DB", async () => {
  await db.query(
    "update ns.sessions set token_expires_at=now()-interval '1 second' where token_hash=$1",
    [hashToken(tokens.b)],
  );
  await assert.rejects(run(tokens.b, listCards), forbidden(401));
  await db.query("update ns.staff_memberships set active=false where id=$1", [
    id(63),
  ]);
  await assert.rejects(run(tokens.editor, listCards), forbidden(401));
});
test("logout revokes server session and erases encrypted tokens", async () => {
  await revokeSession(db as unknown as Sql, tokens.a);
  await assert.rejects(run(tokens.a, listCards), forbidden(401));
  assert.equal(
    (
      await db.query<{ encrypted_tokens: string }>(
        "select encrypted_tokens from ns.sessions where token_hash=$1",
        [hashToken(tokens.a)],
      )
    ).rows[0].encrypted_tokens,
    "revoked",
  );
});
test("refresh atomically replaces tokens; failure revokes instead of extending", async () => {
  await db.transaction(async (tx) => {
    await refreshOn(tx as unknown as Sql, tokens.b, async (_s, t) => ({
      tokens: { ...t, access_token: "REFRESHED TEST" },
      expiresIn: 3600,
    }));
  });
  assert.equal((await run(tokens.b, listCards)).length, 1);
  await db.query(
    "update ns.sessions set token_expires_at=now() where token_hash=$1",
    [hashToken(tokens.b)],
  );
  await db.transaction(async (tx) => {
    assert.equal(
      await refreshOn(tx as unknown as Sql, tokens.b, async () => {
        throw Error("provider down");
      }),
      false,
    );
  });
  await assert.rejects(run(tokens.b, listCards), forbidden(401));
});
test("identity mapping uses verified shop subject, never email", async () => {
  const a = await db.transaction((tx) =>
    establishCustomer(tx as unknown as Sql, "subject:new"),
  );
  const again = await db.transaction((tx) =>
    establishCustomer(tx as unknown as Sql, "subject:new"),
  );
  const b = await db.transaction((tx) =>
    establishCustomer(tx as unknown as Sql, "subject:other"),
  );
  assert.equal(a, again);
  assert.notEqual(a, b);
});
test("ledger and rule versions cannot be rewritten even by migration owner", async () => {
  await db.query(
    "insert into ns.loyalty_rules(tenant_id,id,version,parameters) values($1,$2,1,'{}')",
    [T, id(90)],
  );
  await assert.rejects(
    db.query(
      "update ns.loyalty_rules set parameters='{\"changed\":true}' where id=$1",
      [id(90)],
    ),
    /Append-only/,
  );
  await db.query(
    "insert into ns.loyalty_accounts(tenant_id,id,customer_id) values($1,$2,$3)",
    [T, id(91), id(1)],
  );
  await db.query(
    "insert into ns.loyalty_ledger(tenant_id,account_id,customer_id,rule_id,points,source_object,operation,reason) values($1,$2,$3,$4,10,'sample','earn','test')",
    [T, id(91), id(1), id(90)],
  );
  await assert.rejects(
    db.query("update ns.loyalty_ledger set points=999"),
    /Append-only/,
  );
});
test("encryption is bound to session and rejects tampering; same origin and exact return allowlist", () => {
  const encrypted = seal({ secret: "test" }, "one");
  assert.ok(!encrypted.includes("secret"));
  assert.deepEqual(unseal(encrypted, "one"), { secret: "test" });
  assert.throws(() => unseal(encrypted, "two"), forbidden(401));
  assert.throws(
    () =>
      sameOrigin(
        new Request("https://preview.example.test/api/auth/logout", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      ),
    forbidden(403),
  );
  sameOrigin(
    new Request("https://preview.example.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://preview.example.test" },
    }),
  );
  assert.equal(safeReturn("//evil.test"), "/account");
  assert.equal(safeReturn("/my-cards"), "/my-cards");
});
test("auth role can map verified subjects but cannot read operational records", async () => {
  await db.transaction(async (tx) => {
    await tx.exec("set local role northside_auth");
    const customer = await establishCustomer(
      tx as unknown as Sql,
      "auth-role-subject",
    );
    assert.ok(customer);
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("set local role northside_auth");
      await tx.query("select * from ns.card_items");
    }),
    /permission denied/,
  );
});
test.after(async () => db.close());
