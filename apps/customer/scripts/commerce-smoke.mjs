import assert from "node:assert/strict";
// Local rejection smoke: run a scrubbed loopback production server with
// APP_ORIGIN=https://local-test.invalid, the configured Shopify shop/API version,
// fixtures off, and no provider credentials or trusted buyer-IP header.
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
const origin = "https://local-test.invalid";
for (const action of ["add", "update", "checkout", "reset"]) {
  const r = await fetch(base + "/api/commerce/cart", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ action, price: 1, customerId: "forged" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "unexpected_cart_input");
  console.log(`PASS forged public cart input rejected: ${action}`);
}
const unapproved = await fetch(base + "/api/commerce/cart", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "add",
    variantId: "gid://shopify/ProductVariant/1",
    quantity: 1,
  }),
});
assert.equal(unapproved.status, 403);
assert.equal((await unapproved.json()).error, "variant_not_approved_for_sale");
console.log("PASS unapproved variant rejected by limited-sales policy");
const cart = await fetch(base + "/api/commerce/cart");
assert.equal(cart.status, 503);
assert.equal((await cart.json()).error, "shopify_not_configured");
assert.match(cart.headers.get("cache-control"), /no-store/);
console.log("PASS private cart fails closed without provider configuration");
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
for (const [path, method] of [
  ["/api/private/commerce/checkout-test", "POST"],
  [
    "/api/private/commerce/inventory-proof?variantId=gid://shopify/ProductVariant/1",
    "GET",
  ],
]) {
  const r = await fetch(base + path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(method === "POST"
      ? {
          body: JSON.stringify({
            variantId: "gid://shopify/ProductVariant/1",
            quantity: 1,
            customerId: "forged",
          }),
        }
      : {}),
  });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("cache-control"), /no-store/);
  console.log(
    `PASS authenticated commerce diagnostic rejects forged/absent session: ${path}`,
  );
}
const crossTest = await fetch(base + "/api/private/commerce/checkout-test", {
  method: "POST",
  headers: { Origin: "https://foreign.invalid" },
});
assert.equal(crossTest.status, 403);
console.log("PASS cross-origin test checkout denied");
