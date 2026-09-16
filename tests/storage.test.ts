import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("private Storage policy denies direct client access even with an unrelated broad policy", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id int,bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert on storage.objects to anon,authenticated;create policy existing_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true);`,
    );
    await db.exec(
      await readFile(
        "supabase/migrations/202609120002_private_storage.sql",
        "utf8",
      ),
    );
    await db.exec(
      "insert into storage.objects values(1,'northside-private'),(2,'unrelated')",
    );
    assert.equal(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='northside-private'",
        )
      ).rows[0].public,
      false,
    );
    for (const role of ["anon", "authenticated"]) {
      await db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        const rows = (
          await tx.query<{ id: number }>("select * from storage.objects")
        ).rows;
        assert.deepEqual(
          rows.map((x) => x.id),
          [2],
        );
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.exec(
            "insert into storage.objects values(3,'northside-private')",
          );
        }),
        /row-level security/,
      );
    }
  } finally {
    await db.close();
  }
});
