import assert from "node:assert/strict";
const origin = new URL(process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001");
if (
  origin.hostname !== "127.0.0.1" ||
  origin.protocol !== "http:" ||
  origin.pathname !== "/" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
)
  throw Error("Operations rejection checks are loopback-only.");
const id = "00000000-0000-4000-8000-000000000001";
let count = 0;
for (const [path, method, status, requestOrigin] of [
  ["/api/preview/grading/operations?actor=staff", "GET", 404],
  ["/api/preview/grading/operations?actor=staff", "POST", 404],
  ["/api/private/grading/operations", "GET", 401],
  [`/api/private/grading/operations?card=${id}`, "GET", 401],
  [`/api/private/grading/operations?batch=${id}`, "GET", 401],
  [`/api/private/grading/operations?manifest=${id}`, "GET", 401],
  [`/api/private/grading/operations?label=${id}`, "GET", 401],
  [`/api/private/grading/operations?import=${id}`, "GET", 401],
  ["/api/private/grading/operations", "POST", 403, "https://foreign.invalid"],
  [
    "/api/private/grading/operations",
    "POST",
    401,
    "https://local-test.invalid",
  ],
]) {
  const r = await fetch(new URL(path, origin), {
    method,
    headers: { origin: requestOrigin || origin.origin },
  });
  assert.equal(r.status, status, `${method} ${path}`);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  count++;
}
const shell = await fetch(new URL("/staff/grading/operations", origin));
assert.equal(shell.status, 200);
assert.match(shell.headers.get("cache-control") || "", /no-store/);
assert.ok(!(await shell.text()).includes("SAMPLE workspace"));
count++;
console.log(
  `PASS ${count} staff operations production checks: sessions, manifests, labels, imports, origins and fixture denial.`,
);
