import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const hardening = "20261003152308_pin_trigger_function_search_paths.sql";
const names = [
  "prevent_rewrite",
  "freeze_grading_card",
  "freeze_grading_rate",
  "freeze_consignment_link",
  "loyalty_fixed_record",
  "freeze_break_identity",
  "freeze_store_identity",
  "freeze_exam_photo",
  "guard_exam_publication",
  "snapshot_exam_photos",
  "guard_exam_photo_snapshot",
  "grading_audit_source",
].sort();

test("additive trigger hardening pins exact signatures without changing body, owner, grants or invoker security", async () => {
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
    const metadata = () =>
      db.query<{
        proname: string;
        args: string;
        result: string;
        prosrc: string;
        proowner: string;
        proacl: string | null;
        prosecdef: boolean;
      }>(
        "select proname,proargtypes::text args,prorettype::regtype::text result,prosrc,proowner::text,proacl::text,prosecdef from pg_proc where pronamespace='ns'::regnamespace and proname=any($1) order by proname",
        [names],
      );
    const before = (await metadata()).rows;
    assert.deepEqual(
      before.map((f) => f.proname),
      names,
    );
    assert.ok(
      before.every(
        (f) => f.args === "" && f.result === "trigger" && !f.prosecdef,
      ),
    );
    await db.exec(await readFile(`supabase/migrations/${hardening}`, "utf8"));
    assert.deepEqual((await metadata()).rows, before);
    const settings = (
      await db.query<{ proname: string; proconfig: string[] }>(
        "select proname,proconfig from pg_proc where pronamespace='ns'::regnamespace and proname=any($1) order by proname",
        [names],
      )
    ).rows;
    assert.equal(settings.length, 12);
    assert.ok(
      settings.every((f) => f.proconfig.includes("search_path=pg_catalog, ns")),
    );
    // ALTER is safe to replay locally; the migration runner still records it only once.
    await db.exec(await readFile(`supabase/migrations/${hardening}`, "utf8"));
    assert.deepEqual((await metadata()).rows, before);

    // A caller-chosen schema must not replace builtin helpers inside these guards.
    // These tables/functions exist only in this isolated test database.
    await db.exec(`
      create schema adversarial;
      create function adversarial.to_jsonb(anyelement) returns jsonb language sql immutable as $$select '{}'::jsonb$$;
      create function adversarial.current_setting(text,boolean) returns text language sql as $$select 'spoofed'::text$$;
      create table adversarial.rewards(id int primary key,label text,active boolean,approved_by uuid,approved_at timestamptz);
      create trigger guard before update on adversarial.rewards for each row execute function ns.loyalty_fixed_record();
      insert into adversarial.rewards values(1,'Original immutable reward',true,null,null);
      create table adversarial.audit(source text,after_record jsonb,customer_actor_id uuid);
      create trigger source before insert on adversarial.audit for each row execute function ns.grading_audit_source();
      create table adversarial.ledger(id int primary key,points int);
      insert into adversarial.ledger values(1,10);
      create trigger immutable before update or delete on adversarial.ledger for each row execute function ns.prevent_rewrite();
      set search_path=adversarial,pg_catalog;
      set ns.grading_source='import';
    `);
    await assert.rejects(
      db.exec("update adversarial.rewards set label='Changed' where id=1"),
      /new reward definition/i,
    );
    await db.exec("update adversarial.rewards set active=false where id=1");
    assert.deepEqual(
      (await db.query("select label,active from adversarial.rewards")).rows,
      [{ label: "Original immutable reward", active: false }],
    );
    await db.exec("insert into adversarial.audit values(null,'{}',null)");
    assert.equal(
      (
        await db.query<{ source: string }>(
          "select source from adversarial.audit",
        )
      ).rows[0].source,
      "import",
    );
    await assert.rejects(
      db.exec("update adversarial.ledger set points=99 where id=1"),
      /append.only/i,
    );
  } finally {
    await db.close();
  }
});
