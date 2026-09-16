import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const path of [
  "/breaks",
  "/staff/breaks",
  "/account/breaks",
  "/breaks/00000000-0000-4000-8000-000000007001",
]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  const html = await r.text();
  assert.ok(!html.includes("LOCAL SAMPLE WORKSPACE"));
  assert.ok(!html.includes("SAMPLE Friday night"));
  console.log("PASS production break shell: " + path);
}
for (const method of ["GET", "POST"]) {
  const r = await fetch(base + "/api/preview/breaks?actor=staff&public=1", {
    method,
    headers: { origin: base, "Content-Type": "application/json" },
    ...(method === "POST"
      ? { body: '{"action":"sample-paid","customer":1}' }
      : {}),
  });
  assert.equal(r.status, 404);
  console.log("PASS production break fixture denied: " + method);
}
for (const query of ["", "?staff=1"]) {
  const r = await fetch(base + "/api/private/breaks" + query);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("cache-control"), /no-store/);
  console.log("PASS private breaks require session: " + query);
}
const publicRead = await fetch(base + "/api/breaks");
assert.equal(publicRead.status, 503);
assert.ok(!(await publicRead.text()).includes("SAMPLE"));
console.log("PASS disconnected schedule does not substitute samples");
const cross = await fetch(base + "/api/private/breaks", {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "Content-Type": "application/json",
  },
  body: '{"action":"reminder"}',
});
assert.equal(cross.status, 403);
console.log("PASS cross-origin break mutation denied");
const gated = await fetch(base + "/api/private/breaks/cart", {
  method: "POST",
  headers: {
    origin: process.env.APP_ORIGIN || "https://local-test.invalid",
    "Content-Type": "application/json",
  },
  body: "{}",
});
assert.equal(gated.status, 503);
assert.equal((await gated.json()).error, "purchases_disabled");
console.log("PASS real break purchase remains disabled");
