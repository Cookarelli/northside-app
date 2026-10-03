import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { databaseConfig } from "../lib/server/database-config.mjs";

const remote = "postgresql://northside_runtime:synthetic%40password@db.example.invalid:6543/postgres";
const development = {
  NODE_ENV: "development",
  NORTHSIDE_ALLOW_INSECURE_LOCAL_DATABASE: "1",
};

test("remote driver options always verify TLS and preserve encoded credentials", () => {
  for (const suffix of ["", "?sslmode=require", "?sslmode=verify-full"]) {
    for (const environment of [{}, development, { NODE_ENV: "production" }]) {
      const config = databaseConfig(remote + suffix, environment);
      assert.equal(config.connectionString, undefined);
      const actual = new Client(config).connectionParameters;
      assert.deepEqual(actual.ssl, { rejectUnauthorized: true });
      assert.equal(actual.host, "db.example.invalid");
      assert.equal(actual.port, 6543);
      assert.equal(actual.user, "northside_runtime");
      assert.equal(actual.password, "synthetic@password");
      assert.equal(actual.database, "postgres");
    }
  }
});

test("URL options cannot downgrade TLS, read certificates, or replace the endpoint", () => {
  for (const query of [
    "sslmode=disable", "sslmode=no-verify", "sslmode=prefer", "sslmode=allow",
    "sslmode=verify-ca", "ssl=false", "ssl=true", "sslrootcert=/private/canary",
    "sslcert=/private/canary", "sslkey=/private/canary", "host=127.0.0.1",
    "hostaddr=127.0.0.1", "user=another", "password=another", "options=anything",
    "uselibpqcompat=true", "sslnegotiation=direct", "SSLmode=require",
    "sslmode=require&sslmode=disable", "sslmode=require&host=localhost",
  ]) {
    assert.throws(() => databaseConfig(`${remote}?${query}`, development), {
      message: "Invalid database connection configuration.",
    });
  }
});

test("pg environment variables cannot disable TLS or replace explicit fields", () => {
  const overrides = {
    PGSSLMODE: "no-verify", PGHOST: "127.0.0.1", PGPORT: "1234",
    PGUSER: "wrong-role", PGDATABASE: "wrong-db", PGSSLNEGOTIATION: "direct",
    PGPASSWORD: "wrong-secret",
  };
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const actual = new Client(databaseConfig(remote, {})).connectionParameters;
    assert.deepEqual(actual.ssl, { rejectUnauthorized: true });
    assert.equal(actual.host, "db.example.invalid");
    assert.equal(actual.port, 6543);
    assert.equal(actual.user, "northside_runtime");
    assert.equal(actual.database, "postgres");
    assert.equal(actual.sslnegotiation, "postgres");
    const empty = new Client(databaseConfig("postgres://local@localhost/db", development)).connectionParameters;
    assert.equal(typeof empty.password, "function");
    assert.equal(empty.password(), "");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("plaintext requires explicit nonhosted development loopback configuration", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const value = `postgres://local:synthetic@${host}/db`;
    for (const NODE_ENV of ["development", "test"]) {
      const environment = { ...development, NODE_ENV };
      assert.equal(databaseConfig(value, environment).ssl, false);
      assert.equal(databaseConfig(`${value}?sslmode=disable`, environment).ssl, false);
      assert.deepEqual(databaseConfig(`${value}?sslmode=require`, environment).ssl, { rejectUnauthorized: true });
    }
    for (const environment of [
      {}, { NODE_ENV: "development" }, { ...development, NODE_ENV: "production" },
      { ...development, NODE_ENV: "" }, { ...development, VERCEL: "1" },
    ]) {
      assert.deepEqual(databaseConfig(value, environment).ssl, { rejectUnauthorized: true });
      assert.throws(() => databaseConfig(`${value}?sslmode=disable`, environment));
    }
  }
  for (const host of ["localhost.example.invalid", "127.1", "127.0.0.2", "[::ffff:127.0.0.1]"]) {
    assert.deepEqual(databaseConfig(`postgres://local:synthetic@${host}/db`, development).ssl, { rejectUnauthorized: true });
  }
});

test("invalid URLs expose no credentials or parser detail", () => {
  const canary = "SYNTHETIC_TRANSPORT_SECRET";
  for (const value of [
    "", "unused", `https://role:${canary}@db.example.invalid/db`,
    `postgres://role:${canary}@db.example.invalid:bad/db`,
    `postgres://role:${canary}@db.example.invalid/db#fragment`,
    `postgres://role:${canary}@db.example.invalid/`,
    `postgres://role:${canary}@db.example.invalid/db `,
    `postgres://role:${canary}%zz@db.example.invalid/db`,
    "postgres:///db?host=/private/socket", "postgres://db.example.invalid/db",
  ]) {
    assert.throws(() => databaseConfig(value, {}), { message: "Invalid database connection configuration." });
  }
});
