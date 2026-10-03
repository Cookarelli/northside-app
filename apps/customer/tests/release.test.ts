import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { loyaltyFixture } from "./support/loyalty-fixture";
import { reserveReward } from "../lib/server/loyalty-redemption";
import { previewId } from "../lib/server/grading-preview";

test("all release migrations apply in order without seeding customers, balances, orders or streams", async () => {
  const db = await PGlite.create();
  try {
    // Hosted Supabase owns these objects. This is a minimal local Storage contract, not hosted verification.
    await db.exec(
      "create role anon; create role authenticated; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id int,bucket_id text); alter table storage.objects enable row level security;",
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    for (const table of [
      "customers",
      "staff_memberships",
      "sessions",
      "loyalty_accounts",
      "loyalty_ledger",
      "loyalty_rules",
      "break_events",
      "order_jobs",
      "consignment_items",
      "show_events",
      "measured_orders",
    ]) {
      assert.equal(
        (
          await db.query<{ n: number }>(
            `select count(*)::int n from ns.${table}`,
          )
        ).rows[0].n,
        0,
        table,
      );
    }
    const roles = (
      await db.query<{
        rolname: string;
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        "select rolname,rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname like 'northside_%'",
      )
    ).rows;
    assert.equal(roles.length, 5);
    assert.ok(
      roles.every((r) => !r.rolcanlogin && !r.rolsuper && !r.rolbypassrls),
    );
    assert.equal(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='northside-private'",
        )
      ).rows[0].public,
      false,
    );
  } finally {
    await db.close();
  }
});

test("isolated database backup restores rows, reserved points, privacy roles and immutable history", async () => {
  const f = await loyaltyFixture();
  let restored: PGlite | undefined;
  try {
    // The grading preview now needs consignment/break notification schemas.
    // Add only the remaining store schema before the full restore rehearsal.
    if (
      !(
        await f.db.query<{ present: string | null }>(
          "select to_regclass('ns.store_aisles')::text present",
        )
      ).rows[0].present
    )
      await f.db.exec(
        await readFile("supabase/migrations/202609120008_store.sql", "utf8"),
      );
    await f.run("a", (db, a) =>
      reserveReward(db, a, f.reward.id, randomUUID(), "sample"),
    );
    const counts = async (db: PGlite) => {
      const tables = (
        await db.query<{ tablename: string }>(
          "select tablename from pg_tables where schemaname='ns' order by tablename",
        )
      ).rows;
      return Promise.all(
        tables.map(async ({ tablename }) => [
          tablename,
          (
            await db.query<{ n: number }>(
              `select count(*)::int n from ns."${tablename}"`,
            )
          ).rows[0].n,
        ]),
      );
    };
    const before = await counts(f.db);
    const balances = (
      await f.db.query("select * from ns.loyalty_accounts order by customer_id")
    ).rows;
    const reservations = (
      await f.db.query("select * from ns.redemption_reservations order by id")
    ).rows;
    const session = (
      await f.db.query<{ token_hash: string }>(
        "select token_hash from ns.sessions where customer_id=$1 limit 1",
        [previewId(1)],
      )
    ).rows[0].token_hash;
    const archive = await f.db.dumpDataDir();
    restored = await PGlite.create({ loadDataDir: archive });
    assert.deepEqual(await counts(restored), before);
    assert.deepEqual(
      (
        await restored.query(
          "select * from ns.loyalty_accounts order by customer_id",
        )
      ).rows,
      balances,
    );
    assert.deepEqual(
      (
        await restored.query(
          "select * from ns.redemption_reservations order by id",
        )
      ).rows,
      reservations,
    );
    await restored.transaction(async (tx) => {
      await tx.exec("set local role northside_runtime");
      await tx.query("select set_config('ns.session_hash',$1,true)", [session]);
      const owners = (
        await tx.query<{ customer_id: string }>(
          "select customer_id from ns.loyalty_accounts",
        )
      ).rows;
      assert.equal(owners.length, 1);
      assert.equal(owners[0].customer_id, previewId(1));
      await assert.rejects(
        tx.query("select encrypted_tokens from ns.sessions"),
        /permission denied/,
      );
    });
    await assert.rejects(
      restored.query("update ns.loyalty_ledger set points=0"),
      /immutable|append.only/i,
    );
  } finally {
    await restored?.close();
    await f.close();
  }
});
