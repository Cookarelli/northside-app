import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const hardening = "20261003170654_restrict_private_function_execution.sql";
test("full migration chain removes inherited function execution and retains authenticated RLS and trigger behavior", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      "create role anon; create role authenticated; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id int,bucket_id text); alter table storage.objects enable row level security;",
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql") && f < hardening)
      .sort()) {
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    }
    const metadata = async () =>
      (
        await db.query(
          "select oid::regprocedure::text signature,prosrc,proowner,proconfig,prosecdef from pg_proc where pronamespace='ns'::regnamespace order by oid",
        )
      ).rows;
    const explicitGrants = async () =>
      (
        await db.query(
          "select p.oid::regprocedure::text signature,a.grantee,a.privilege_type,a.is_grantable from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.pronamespace='ns'::regnamespace and a.grantee not in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated')) order by signature,a.grantee,a.privilege_type",
        )
      ).rows;
    const before = await metadata(),
      grants = await explicitGrants();
    await db.exec(await readFile(`supabase/migrations/${hardening}`, "utf8"));
    assert.deepEqual(await metadata(), before);
    assert.deepEqual(await explicitGrants(), grants);
    assert.equal(
      (
        await db.query(
          "select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.pronamespace='ns'::regnamespace and a.grantee=0 and privilege_type='EXECUTE'",
        )
      ).rows.length,
      0,
    );
    for (const role of [
      "anon",
      "authenticated",
      "northside_auth",
      "northside_commerce",
      "northside_loyalty",
      "northside_engagement",
    ]) {
      assert.equal(
        (
          await db.query(
            "select 1 from pg_proc where pronamespace='ns'::regnamespace and has_function_privilege($1,oid,'EXECUTE')",
            [role],
          )
        ).rows.length,
        0,
        role,
      );
    }
    assert.equal(
      (
        await db.query(
          "select 1 from pg_proc where pronamespace='ns'::regnamespace and has_function_privilege('northside_runtime',oid,'EXECUTE')",
        )
      ).rows.length,
      15,
    );
    // Exercise a real RLS write plus its SECURITY DEFINER audit trigger after
    // revocation. All data lives only in this ephemeral database.
    await db.exec(`
      insert into ns.customers(tenant_id,id) values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
      insert into ns.staff_memberships(tenant_id,id,auth_user_id,role) values('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','operations');
      insert into ns.service_cases(tenant_id,id,customer_id,kind) values('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','grading');
      insert into ns.card_items(tenant_id,id,customer_id,case_id,description) values('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','Ephemeral ACL test');
      insert into ns.sessions(token_hash,tenant_id,staff_id,provider,encrypted_tokens,token_expires_at,expires_at) values(repeat('a',64),'11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','supabase','test',now()+interval '1 hour',now()+interval '1 hour');
      set role northside_runtime;
    `);
    assert.equal((await db.query("select * from ns.context()")).rows.length, 0);
    assert.equal((await db.query("select * from ns.customers")).rows.length, 0);
    await db.query("select set_config('ns.session_hash',$1,false)", [
      "a".repeat(64),
    ]);
    assert.equal((await db.query("select * from ns.customers")).rows.length, 1);
    await db.exec(
      "insert into ns.status_events(tenant_id,card_id,customer_id,label,reason,source,actor_id) values('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','Received','ACL trigger verification','staff','33333333-3333-4333-8333-333333333333');",
    );
    assert.equal(
      (
        await db.query(
          "select * from ns.audit_records where action='status.append'",
        )
      ).rows.length,
      1,
    );
    await db.exec("reset role; set role northside_commerce;");
    await assert.rejects(
      db.query("select * from ns.context()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
