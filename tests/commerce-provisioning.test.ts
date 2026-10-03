import { afterEach, describe, expect, test } from "vitest";
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
import { parseEnv } from "node:util";
import {
  PROJECT,
  ROLES,
  type Database,
  type Recovery,
  parseTarget,
  runProvisioning,
  safeFailure,
  matchesVerifier,
} from "../scripts/lib/pilot-provisioning";
const migrationPassword = "synthetic-migration-input-only";
const migrationUrl = `postgresql://postgres.${PROJECT}:${migrationPassword}@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
const dirs: string[] = [];
const databases: PGlite[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function root(
  input = `MIGRATION_DATABASE_URL=${JSON.stringify(migrationUrl)}\n`,
) {
  const dir = mkdtempSync(join(tmpdir(), "northside-provision-test-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".runtime"), { mode: 0o700 });
  mkdirSync(join(dir, ".runtime/pilot"), { mode: 0o700 });
  writeFileSync(join(dir, ".runtime/pilot/operator.env"), input, {
    mode: 0o600,
  });
  return dir;
}
async function database(hook?: (sql: string, db: PGlite) => Promise<void>) {
  const pg = new PGlite();
  databases.push(pg);
  await pg.exec("create schema ns; create schema northside_private;");
  for (const role of ROLES)
    await pg.exec(
      `create role ${role} ${role.endsWith("_server") ? "login" : "nologin"} nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
  const calls: string[] = [];
  const db: Database = {
    query: async (sql) => {
      calls.push(sql);
      await hook?.(sql, pg);
      return (await pg.query<Record<string, unknown>>(sql)).rows;
    },
    close: async () => {},
  };
  return { pg, db, calls };
}
function recovery(dir: string) {
  return JSON.parse(
    readFileSync(join(dir, ".runtime/pilot/recovery.json"), "utf8"),
  ) as Recovery;
}

describe("operator-only pilot provisioning", () => {
  test("pins exact project/role/session-pooler/TLS and refuses override parameters", () => {
    expect(parseTarget(migrationUrl).host).toBe(
      "aws-1-us-east-1.pooler.supabase.com",
    );
    const variants = [
      migrationUrl.replace(PROJECT, "wrongprojectref"),
      migrationUrl.replace("postgres.", "northside_runtime."),
      migrationUrl.replace("5432", "6543"),
      migrationUrl.replace("pooler.supabase.com", "pooler.supabase.com.evil"),
      migrationUrl.replace("/postgres?", "/other?"),
      migrationUrl.replace("verify-full", "require"),
      migrationUrl.replace("verify-full", "disable"),
      migrationUrl + "&sslmode=disable",
      migrationUrl + "&ssl=false",
      migrationUrl + "&sslrootcert=/tmp/unchecked",
      migrationUrl + "&host=evil",
      migrationUrl + "&options=anything",
      migrationUrl + "#fragment",
      migrationUrl.replace(
        "aws-1-us-east-1.pooler.supabase.com",
        `db.${PROJECT}.supabase.co`,
      ),
    ];
    for (const value of variants) expect(() => parseTarget(value)).toThrow();
    expect(() =>
      parseTarget(migrationUrl, "aws-1-eu-west-1.pooler.supabase.com"),
    ).toThrow();
    const prior = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      expect(() => parseTarget(migrationUrl)).toThrow();
    } finally {
      if (prior === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prior;
    }
  });
  test("missing input reports the variable name before constructing a connection", async () => {
    const dir = root("");
    let connections = 0;
    try {
      await runProvisioning(dir, true, () => {
        connections++;
        throw Error(migrationUrl);
      });
    } catch (e) {
      expect(safeFailure(e)).toBe("Missing: MIGRATION_DATABASE_URL");
    }
    expect(connections).toBe(0);
    expect(existsSync(join(dir, ".runtime/pilot/recovery.json"))).toBe(false);
  });
  test("refuses broadly readable files, symlinks and client-public variables", async () => {
    for (const variant of ["mode", "symlink", "public"]) {
      const dir = root(
        variant === "public"
          ? `MIGRATION_DATABASE_URL=${JSON.stringify(migrationUrl)}\nNEXT_PUBLIC_DATABASE_URL=never-copy\n`
          : undefined,
      );
      const file = join(dir, ".runtime/pilot/operator.env");
      if (variant === "mode") chmodSync(file, 0o644);
      if (variant === "symlink") {
        const content = readFileSync(file);
        rmSync(file);
        writeFileSync(join(dir, "elsewhere"), content, { mode: 0o600 });
        symlinkSync(join(dir, "elsewhere"), file);
      }
      let called = false;
      await expect(
        runProvisioning(dir, true, () => {
          called = true;
          throw Error();
        }),
      ).rejects.toThrow();
      expect(called).toBe(false);
    }
  });
  test("default performs database reads only and creates no credential files", async () => {
    const dir = root(),
      { db, calls } = await database();
    expect(await runProvisioning(dir, false, () => db)).toEqual({
      mode: "checked",
      passwordlessRoles: 7,
      rolesNeedingLogin: 5,
    });
    expect(calls.some((sql) => /alter role|lock table/i.test(sql))).toBe(false);
    expect(existsSync(join(dir, ".runtime/pilot/recovery.json"))).toBe(false);
  });
  test("durably saves distinct recovery secrets before ALTER and exports only scoped roles", async () => {
    const dir = root();
    const { db, pg, calls } = await database(async (sql) => {
      if (!sql.startsWith("alter role")) return;
      const path = join(dir, ".runtime/pilot/recovery.json");
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(path).uid).toBe(process.getuid?.());
      for (const password of Object.values(recovery(dir).passwords))
        expect(sql.includes(password)).toBe(false);
    });
    expect(await runProvisioning(dir, true, () => db)).toEqual({
      mode: "provisioned",
      roles: 7,
    });
    const r = recovery(dir);
    expect(new Set(Object.values(r.passwords)).size).toBe(7);
    const saved = await pg.query<{
      rolname: keyof Recovery["passwords"];
      rolpassword: string;
      rolcanlogin: boolean;
    }>(
      "select rolname,rolpassword,rolcanlogin from pg_authid where rolname like 'northside_%'",
    );
    for (const row of saved.rows) {
      expect(row.rolcanlogin).toBe(true);
      expect(matchesVerifier(r.passwords[row.rolname], row.rolpassword)).toBe(
        true,
      );
    }
    const customer = parseEnv(
      readFileSync(join(dir, ".runtime/pilot/customer.env"), "utf8"),
    );
    const control = parseEnv(
      readFileSync(join(dir, ".runtime/pilot/control.env"), "utf8"),
    );
    const loyalty = parseEnv(
      readFileSync(join(dir, ".runtime/pilot/loyalty.env"), "utf8"),
    );
    expect(
      Object.keys(customer)
        .filter((key) => key.endsWith("DATABASE_URL"))
        .sort(),
    ).toEqual([
      "AUTH_DATABASE_URL",
      "COMMERCE_DATABASE_URL",
      "DATABASE_URL",
      "ENGAGEMENT_DATABASE_URL",
      "NORTHSIDE_DATA_DATABASE_URL",
    ]);
    expect(new URL(customer.NORTHSIDE_DATA_DATABASE_URL || "").username).toBe(
      `northside_customer_server.${PROJECT}`,
    );
    expect(new URL(control.NORTHSIDE_DATA_DATABASE_URL || "").username).toBe(
      `northside_control_server.${PROJECT}`,
    );
    expect(Object.keys(loyalty)).toEqual(["LOYALTY_DATABASE_URL"]);
    expect(customer.OPERATOR_PASSWORD).toBeUndefined();
    expect(control.DATABASE_URL).toBeUndefined();
    expect(control.OPERATOR_PASSWORD).toBe(r.operatorPassword);
    for (const name of ["customer.env", "control.env", "loyalty.env"]) {
      const file = join(dir, ".runtime/pilot", name),
        text = readFileSync(file, "utf8");
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(text).not.toContain(migrationPassword);
      expect(text).not.toMatch(
        /MIGRATION_|SUPABASE_SECRET_KEY|NEXT_PUBLIC_|WORKER_/,
      );
    }
    expect(calls.some((sql) => /^grant\s/i.test(sql))).toBe(false);
    const before = readFileSync(
        join(dir, ".runtime/pilot/recovery.json"),
        "utf8",
      ),
      count = calls.length;
    expect((await runProvisioning(dir, true, () => db)).mode).toBe(
      "provisioned",
    );
    expect(
      readFileSync(join(dir, ".runtime/pilot/recovery.json"), "utf8"),
    ).toBe(before);
    expect(calls.slice(count).some((sql) => sql.startsWith("alter role"))).toBe(
      false,
    );
  });
  test("existing unknown passwords are never replaced and no recovery is fabricated", async () => {
    const dir = root(),
      { db, pg, calls } = await database();
    await pg.exec(
      "alter role northside_runtime password 'synthetic-existing-password'",
    );
    await expect(runProvisioning(dir, true, () => db)).rejects.toMatchObject({
      code: "EXISTING_PASSWORD_REQUIRES_RECOVERY",
    });
    expect(calls.some((sql) => sql.startsWith("alter role"))).toBe(false);
    expect(existsSync(join(dir, ".runtime/pilot/recovery.json"))).toBe(false);
  });
  test("catalog is rechecked under its DDL-conflicting lock before applying passwords", async () => {
    const dir = root();
    const { db, calls } = await database(async (sql, pg) => {
      if (sql.startsWith("lock table"))
        await pg.exec(
          "alter role northside_auth password 'independently-set-password'",
        );
    });
    await expect(runProvisioning(dir, true, () => db)).rejects.toMatchObject({
      code: "RECOVERY_MISMATCH",
    });
    expect(calls.some((sql) => sql.startsWith("alter role"))).toBe(false);
    expect(calls.at(-1)).toBe("rollback");
  });
  test("failed ALTER rolls back, preserves recovery, hides raw errors and can resume", async () => {
    const dir = root();
    let reject = true;
    const { db, pg } = await database(async (sql) => {
      if (reject && sql.startsWith('alter role "northside_auth"'))
        throw Error(`driver secret: ${migrationUrl}`);
    });
    try {
      await runProvisioning(dir, true, () => db);
    } catch (error) {
      expect(safeFailure(error)).toContain("DATABASE_UNAVAILABLE");
      expect(safeFailure(error)).not.toContain(migrationPassword);
      expect(safeFailure(error)).not.toContain("postgresql:");
    }
    const r = recovery(dir);
    expect(
      (
        await pg.query<{ count: number }>(
          "select count(*)::int as count from pg_authid where rolname like 'northside_%' and rolpassword is not null",
        )
      ).rows[0].count,
    ).toBe(0);
    expect(existsSync(join(dir, ".runtime/pilot/customer.env"))).toBe(false);
    reject = false;
    await runProvisioning(dir, true, () => db);
    expect(recovery(dir)).toEqual(r);
    expect(safeFailure(Error(migrationUrl))).not.toContain(migrationPassword);
  });
  test("missing catalog-lock permission leaves saved recovery but changes no roles", async () => {
    const dir = root();
    const { db, calls } = await database(async (sql) => {
      if (sql.startsWith("lock table"))
        throw Error("permission denied for pg_authid");
    });
    await expect(runProvisioning(dir, true, () => db)).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(existsSync(join(dir, ".runtime/pilot/recovery.json"))).toBe(true);
    expect(calls.some((sql) => sql.startsWith("alter role"))).toBe(false);
    expect(calls.at(-1)).toBe("rollback");
    expect(existsSync(join(dir, ".runtime/pilot/customer.env"))).toBe(false);
  });
  test("unsafe existing role privilege and conflicting output refuse all ALTER operations", async () => {
    for (const variant of ["privilege", "output"]) {
      const dir = root(),
        { db, pg, calls } = await database();
      if (variant === "privilege")
        await pg.exec("alter role northside_auth createrole");
      else
        writeFileSync(
          join(dir, ".runtime/pilot/customer.env"),
          "KEEP_EXISTING=1\n",
          { mode: 0o600 },
        );
      await expect(runProvisioning(dir, true, () => db)).rejects.toThrow();
      expect(calls.some((sql) => sql.startsWith("alter role"))).toBe(false);
    }
  });
});
