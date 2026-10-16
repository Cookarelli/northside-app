import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { privateCommand, SetupError } from "./private-command.mjs";
await privateCommand("Migration", async () => {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new SetupError(
      "Set MIGRATION_DATABASE_URL privately. Do not use the application runtime connection.",
    );
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  });
  let db;
  try {
    db = await pool.connect();
    await db.query("select pg_advisory_lock(1212092026)");
    await db.query("create schema if not exists ns_migrations");
    await db.query(
      "create table if not exists ns_migrations.applied(name text primary key,sha256 text not null,applied_at timestamptz not null default now())",
    );
    for (const name of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const source = await readFile("supabase/migrations/" + name, "utf8");
      const hash = createHash("sha256").update(source).digest("hex");
      const old = (
        await db.query(
          "select sha256 from ns_migrations.applied where name=$1",
          [name],
        )
      ).rows[0];
      if (old) {
        if (old.sha256 !== hash)
          throw new SetupError("Applied migration changed: " + name);
        continue;
      }
      await db.query("begin");
      try {
        await db.query(source.replace(/^begin;|^commit;/gm, ""));
        await db.query(
          "insert into ns_migrations.applied(name,sha256) values($1,$2)",
          [name, hash],
        );
        await db.query("commit");
        console.log("Applied " + name);
      } catch {
        await db.query("rollback");
        throw new SetupError(
          "Migration failed: " +
            name +
            " (details withheld to avoid exposing connection secrets)",
        );
      }
    }
  } finally {
    if (db) {
      try {
        await db.query("select pg_advisory_unlock(1212092026)");
      } finally {
        db.release();
      }
    }
    await pool.end();
  }
});
