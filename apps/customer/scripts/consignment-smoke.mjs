import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const path of ["/staff/consignment", "/my-cards/consignment"]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  const html = await r.text();
  assert.ok(!html.includes("LOCAL SAMPLE WORKSPACE"));
  assert.ok(!html.includes("SAMPLE — basketball consignment"));
  console.log("PASS production consignment shell: " + path);
}
for (const method of ["GET", "POST"]) {
  const r = await fetch(base + "/api/preview/consignment?actor=staff", {
    method,
    headers: { origin: base, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: '{"action":"intake"}' } : {}),
  });
  assert.equal(r.status, 404);
  console.log("PASS production fixture denial: " + method);
}
for (const query of [
  "",
  "?import=00000000-0000-4000-8000-000000000001",
  "?file=00000000-0000-4000-8000-000000000001",
  "?export=1",
]) {
  const r = await fetch(base + "/api/private/consignment" + query);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("cache-control"), /no-store/);
  console.log("PASS consignment session required: " + (query || "items"));
}
const cross = await fetch(base + "/api/private/consignment", {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "Content-Type": "application/json",
  },
  body: '{"action":"settlement"}',
});
assert.equal(cross.status, 403);
console.log("PASS cross-origin settlement record denied");
