import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
const origin = "https://local-test.invalid";
for (const action of ["add", "update", "checkout", "reset"]) {
  const r = await fetch(base + "/api/commerce/cart", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ action, price: 1, customerId: "forged" }),
  });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "purchases_disabled");
  console.log(`PASS disabled public cart operation: ${action}`);
}
const cart = await fetch(base + "/api/commerce/cart");
assert.equal(cart.status, 503);
assert.match(cart.headers.get("cache-control"), /no-store/);
console.log("PASS private cart is unavailable while purchase gate is off");
const cross = await fetch(base + "/api/commerce/cart", {
  method: "POST",
  headers: { Origin: "https://foreign.invalid" },
});
assert.equal(cross.status, 403);
console.log("PASS cross-origin cart mutation denied");
const orders = await fetch(
  base + "/api/private/orders?customerId=forged&email=forged",
);
assert.equal(orders.status, 401);
console.log("PASS forged order ownership without session denied");
const webhook = await fetch(base + "/api/shopify/webhooks", {
  method: "POST",
  body: "{}",
});
assert.equal(webhook.status, 503);
console.log("PASS unconfigured webhook cannot acknowledge an order");
for (const path of ["/account/orders", "/staff/integrations"]) {
  const r = await fetch(base + path),
    html = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.ok(
    !html.includes("Example order A") && !html.includes("SAMPLE_TOKEN"),
  );
  console.log(`PASS ${path}: guarded, no fixtures, no-store`);
}
