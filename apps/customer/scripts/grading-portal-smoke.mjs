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
  throw Error("Portal rejection checks are loopback-only.");
const card = "00000000-0000-4000-8000-000000000001";
let count = 0;
for (const [path, method, status, requestOrigin] of [
  ["/api/preview/grading/portal?actor=a", "GET", 404],
  ["/api/preview/grading/portal?actor=a", "POST", 404],
  ["/api/private/grading/portal", "GET", 401],
  [`/api/private/grading/portal?card=${card}&receipt=1`, "GET", 401],
  ["/api/private/grading/portal?export=1", "GET", 401],
  ["/api/private/grading/portal", "POST", 403, "https://foreign.invalid"],
  ["/api/private/grading/portal", "POST", 401, "https://local-test.invalid"],
]) {
  const r = await fetch(new URL(path, origin), {
    method,
    headers: { origin: requestOrigin || origin.origin },
  });
  assert.equal(r.status, status, `${method} ${path}`);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  count++;
}
for (const path of [
  `/my-cards/grading/card/${card}`,
  `/my-cards/grading/exam/${card}`,
  "/my-cards/grading",
]) {
  const r = await fetch(
    new URL(`/account?returnTo=${encodeURIComponent(path)}`, origin),
  );
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(`name="returnTo" value="${path}"`));
  count++;
}
const landing = await fetch(new URL("/grading", origin));
assert.equal(landing.status, 200);
const html = await landing.text();
assert.match(html, /Track My Cards/);
assert.ok(html.includes('href="/my-cards/grading"'));
assert.ok(!html.includes("BGP"));
count++;
console.log(
  `PASS ${count} customer portal production checks: private records/receipts/exports, fixture denial, decision origins and login return paths.`,
);
