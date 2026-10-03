import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const path of ["/staff/grading", "/my-cards/grading"]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.ok(!(await r.text()).includes("LOCAL SAMPLE WORKSPACE"));
  console.log("PASS production grading shell: " + path);
}
for (const method of ["GET", "POST"]) {
  const r = await fetch(base + "/api/preview/grading?actor=staff", {
    method,
    headers: { origin: base, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: '{"action":"intake"}' } : {}),
  });
  assert.equal(r.status, 404);
  console.log("PASS fixture API denied in production: " + method);
}
const privateRead = await fetch(base + "/api/private/grading");
assert.equal(privateRead.status, 401);
assert.match(privateRead.headers.get("cache-control"), /no-store/);
console.log("PASS grading session required");
const mutation = await fetch(base + "/api/private/grading", {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "Content-Type": "application/json",
  },
  body: '{"action":"update"}',
});
assert.equal(mutation.status, 403);
console.log("PASS cross-origin grading mutation denied");
