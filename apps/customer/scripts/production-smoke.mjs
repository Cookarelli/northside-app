import assert from "node:assert/strict";
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const route of [
  "/",
  "/shop",
  "/cart",
  "/breaks",
  "/my-cards",
  "/rewards",
  "/account",
]) {
  const res = await fetch(origin + route);
  assert.equal(res.status, 200, route);
  const html = await res.text();
  assert.ok(
    !html.includes("DEMO-G101") &&
      !html.includes("sample-baseball") &&
      !html.includes("Alex • sample collector"),
    `${route} must not leak fixture data`,
  );
  assert.match(res.headers.get("cache-control") || "", /no-store/, route);
  console.log(`PASS ${route}: no fixture records; no-store`);
}
for (const route of [
  "/staff",
  "/shop/sample-baseball",
  "/breaks/sample-break",
  "/scan",
  "/aisles",
  "/pickup",
]) {
  const res = await fetch(origin + route);
  assert.equal(res.status, 404, route);
  console.log(`PASS ${route}: 404`);
}
const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
assert.equal(manifest.display, "standalone");
console.log("PASS manifest");
