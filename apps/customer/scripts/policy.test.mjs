import test from "node:test";
import assert from "node:assert/strict";
import { fixturesAllowed, publicFlags } from "../lib/policy.mjs";
test("production rejects fixtures even when requested", () =>
  assert.equal(
    fixturesAllowed({ NODE_ENV: "production", NORTHSIDE_FIXTURES: "1" }),
    false,
  ));
test("fixtures require explicit non-production opt in", () => {
  assert.equal(fixturesAllowed({ NODE_ENV: "development" }), false);
  assert.equal(
    fixturesAllowed({ NODE_ENV: "development", NORTHSIDE_FIXTURES: "1" }),
    true,
  );
});
test("all future public operations are disabled", () =>
  assert.ok(Object.values(publicFlags).every((v) => v === false)));
