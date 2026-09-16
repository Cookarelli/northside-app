import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("migration connection failures never print connection secrets", () => {
  const canary = "NORTHSIDE_SYNTHETIC_SETUP_SECRET";
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: `postgres://northside:${canary}@127.0.0.1:bad/db`,
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Migration failed/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(canary));
  assert.ok(!result.stderr.includes("node:internal"));
});

test("owner setup rejects malformed provider configuration without logging its value", () => {
  const canary = "NORTHSIDE_SYNTHETIC_PROVIDER_SECRET";
  const result = spawnSync(process.execPath, ["scripts/bootstrap-owner.mjs"], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      NORTHSIDE_OWNER_AUTH_USER_ID: "00000000-0000-4000-8000-000000000001",
      AUTH_DATABASE_URL: "unused",
      SUPABASE_SECRET_KEY: canary,
      SUPABASE_URL: `https://invalid:bad/${canary}`,
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Owner setup failed/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(canary));
  assert.ok(!result.stderr.includes("node:internal"));
});
