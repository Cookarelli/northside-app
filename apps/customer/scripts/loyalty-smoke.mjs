import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const path of ["/rewards", "/staff/rewards"]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  const html = await r.text();
  assert.ok(!html.includes("LOCAL SAMPLE WORKSPACE"));
  assert.ok(!html.includes("SAMPLE $5 collector reward"));
  console.log("PASS production rewards shell: " + path);
}
for (const method of ["GET", "POST"]) {
  const r = await fetch(base + "/api/preview/loyalty?actor=staff", {
    method,
    headers: { origin: base, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: '{"action":"process"}' } : {}),
  });
  assert.equal(r.status, 404);
  console.log("PASS production loyalty fixture denial: " + method);
}
for (const query of ["", "?staff=1", "?export=1", "?reconciliation=1"]) {
  const r = await fetch(base + "/api/private/loyalty" + query);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("cache-control"), /no-store/);
  console.log("PASS loyalty session required: " + (query || "wallet"));
}
const cross = await fetch(base + "/api/private/loyalty", {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "Content-Type": "application/json",
  },
  body: '{"action":"reserve"}',
});
assert.equal(cross.status, 403);
console.log("PASS cross-origin reward exchange denied");
const gated = await fetch(base + "/api/private/loyalty/cart", {
  method: "POST",
  headers: {
    origin: process.env.APP_ORIGIN || "https://local-test.invalid",
    "Content-Type": "application/json",
  },
  body: "{}",
});
assert.equal(gated.status, 503);
assert.equal((await gated.json()).error, "reward_checkout_not_launched");
console.log("PASS real reward cart application remains gated");
