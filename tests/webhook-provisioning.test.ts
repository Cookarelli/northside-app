import { PGlite } from "@electric-sql/pglite";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scramVerifier,
  matchesVerifier,
} from "../scripts/lib/pilot-provisioning";
import {
  prepareWebhookHandoff,
  webhookProvisioningSql,
  WEBHOOK_MIGRATION,
} from "../scripts/lib/webhook-provisioning";

const migration = readFileSync(
  new URL("../supabase/migrations/" + WEBHOOK_MIGRATION, import.meta.url),
  "utf8",
);
const verifier = scramVerifier("synthetic-test-only");
async function baseline() {
  const db = new PGlite();
  // PGlite's bootstrap role cannot lose SUPERUSER. Rename it and create a
  // separate nonsuperuser postgres, matching the hosted operator identity.
  await db.exec(`create role bootstrap_test superuser;
    set session authorization bootstrap_test;
    alter role postgres rename to original_bootstrap;
    create role postgres login createrole;
    grant create on database postgres to postgres;
    grant select on pg_authid to postgres;
    set session authorization postgres;
    create role anon; create role authenticated;
    create schema ns; create schema northside_private;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`);
  return db;
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "northside-webhook-"));
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  writeFileSync(
    join(root, "supabase/migrations", WEBHOOK_MIGRATION),
    migration,
  );
  return root;
}
describe("operator-only webhook handoff", () => {
  it("provisions with a nonsuperuser creator, scoped privileges and a credential-free migration ledger", async () => {
    const db = await baseline();
    try {
      await db.exec(webhookProvisioningSql(migration, verifier));
      const role = (
        await db.query<{ rolcanlogin: boolean; rolpassword: string }>(
          "select rolcanlogin,rolpassword from pg_authid where rolname='northside_webhook_receiver'",
        )
      ).rows[0];
      expect(role.rolcanlogin).toBe(true);
      expect(matchesVerifier("synthetic-test-only", role.rolpassword)).toBe(
        true,
      );
      expect(
        (
          await db.query(
            "select admin_option,inherit_option,set_option from pg_auth_members where roleid=(select oid from pg_roles where rolname='northside_webhook_receiver')",
          )
        ).rows,
      ).toEqual([
        { admin_option: true, inherit_option: false, set_option: false },
      ]);
      const ledger = JSON.stringify(
        (await db.query("select * from supabase_migrations.schema_migrations"))
          .rows,
      );
      expect(ledger).not.toContain("SCRAM");
      expect(ledger).not.toContain("synthetic-test-only");
      expect(
        (
          await db.query(
            "select has_schema_privilege('anon','ns_webhook_pilot','USAGE') a, has_schema_privilege('authenticated','ns_webhook_pilot','USAGE') b",
          )
        ).rows,
      ).toEqual([{ a: false, b: false }]);
    } finally {
      await db.close();
    }
  });
  it.each([
    "create role northside_webhook_receiver",
    "create schema ns_webhook_pilot",
    "insert into supabase_migrations.schema_migrations(version) values('20261019133518')",
  ])("refuses partial state without overwriting: %s", async (sql) => {
    const db = await baseline();
    try {
      await db.exec(sql);
      await expect(
        db.exec(webhookProvisioningSql(migration, verifier)),
      ).rejects.toThrow("WEBHOOK_EXISTING_STATE_REVIEW_REQUIRED");
      await db.exec("rollback");
      expect(
        (
          await db.query(
            "select to_regclass('ns_webhook_pilot.receipts') value",
          )
        ).rows,
      ).toEqual([{ value: null }]);
    } finally {
      await db.close();
    }
  });
  it("rolls back all new state when inherited default grants are unsafe", async () => {
    const db = await baseline();
    try {
      await db.exec("alter default privileges grant select on tables to anon");
      await expect(
        db.exec(webhookProvisioningSql(migration, verifier)),
      ).rejects.toThrow("WEBHOOK_UNEXPECTED_ACL");
      await db.exec("rollback");
      expect(
        (
          await db.query(
            "select 1 from pg_roles where rolname='northside_webhook_receiver'",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await db.query("select * from supabase_migrations.schema_migrations"))
          .rows,
      ).toEqual([]);
    } finally {
      await db.close();
    }
  });
  it("pins migration bytes and rejects malformed credential SQL", () => {
    expect(() =>
      webhookProvisioningSql(migration + "--changed", verifier),
    ).toThrow("WEBHOOK_PLAN_MISMATCH");
    expect(() =>
      webhookProvisioningSql(migration, "x';drop role postgres;--"),
    ).toThrow("WEBHOOK_PLAN_MISMATCH");
  });
  it("preserves owner-only recovery and identical SQL across retries", () => {
    const root = fixture();
    try {
      const first = prepareWebhookHandoff(root);
      const bytes = readFileSync(first.recoveryPath, "utf8");
      const sql = readFileSync(first.sqlPath, "utf8");
      expect(prepareWebhookHandoff(root)).toEqual(first);
      expect(readFileSync(first.recoveryPath, "utf8")).toBe(bytes);
      expect(readFileSync(first.sqlPath, "utf8")).toBe(sql);
      expect(sql).not.toContain(JSON.parse(bytes).password);
      for (const file of [first.sqlPath, first.recoveryPath])
        expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(root, ".runtime/webhooks")).mode & 0o777).toBe(
        0o700,
      );
      writeFileSync(first.sqlPath, "operator work", { mode: 0o600 });
      expect(() => prepareWebhookHandoff(root)).toThrow(
        "WEBHOOK_EXISTING_FILE_MISMATCH",
      );
      expect(readFileSync(first.sqlPath, "utf8")).toBe("operator work");
      expect(readFileSync(first.recoveryPath, "utf8")).toBe(bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("refuses a public or symlinked recovery without creating credential SQL", () => {
    for (const variant of ["public", "symlink"]) {
      const root = fixture();
      try {
        mkdirSync(join(root, ".runtime"), { mode: 0o700 });
        mkdirSync(join(root, ".runtime/webhooks"), { mode: 0o700 });
        const path = join(root, ".runtime/webhooks/receiver-recovery.json");
        if (variant === "public") {
          writeFileSync(path, "{}", { mode: 0o600 });
          chmodSync(path, 0o644);
        } else
          symlinkSync(
            join(root, "supabase/migrations", WEBHOOK_MIGRATION),
            path,
          );
        expect(() => prepareWebhookHandoff(root)).toThrow();
        expect(
          existsSync(
            join(root, ".runtime/webhooks/receiver-setup-private.sql"),
          ),
        ).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
