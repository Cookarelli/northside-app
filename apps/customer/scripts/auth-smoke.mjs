import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const path of [
  "/api/private/me",
  "/api/private/cards",
  "/api/private/export",
  "/api/private/files/00000000-0000-4000-8000-000000000001",
]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 401, path);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.ok(!(await response.text()).includes("SAMPLE"));
  console.log("PASS no-session denied: " + path);
}
const cross = await fetch(base + "/api/auth/logout", {
  method: "POST",
  headers: { Origin: "https://foreign.invalid" },
});
assert.equal(cross.status, 403);
console.log("PASS cross-origin logout rejected");
const callback = await fetch(
  base + "/api/auth/shopify/callback?code=fake&state=fake",
);
assert.equal(callback.status, 401);
console.log("PASS callback without attempt rejected");
const method = await fetch(base + "/api/auth/shopify/login");
assert.equal(method.status, 405);
console.log("PASS login requires POST");
for (const path of ["/account", "/staff/login"]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("disabled"));
  assert.ok(!html.includes("Alex • sample collector"));
  console.log("PASS honest disconnected auth UI: " + path);
}
