import test from "node:test";
import assert from "node:assert/strict";
import { nativeIngressAllowed } from "../lib/native-api-ingress";
const host =
  "northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app";
test("native API preview host exposes only POST scan/shopping; no website, checkout, auth, staff or assets", () => {
  for (const path of ["/api/mobile/v1/scan", "/api/mobile/v1/shopping"])
    assert.equal(
      nativeIngressAllowed(`https://${host}${path}`, "POST", host),
      true,
    );
  for (const path of [
    "/",
    "/shop",
    "/staff",
    "/api/private/store",
    "/api/commerce/cart",
    "/api/mobile/v1/auth/intents",
    "/api/mobile/v1/me",
    "/_next/static/app.js",
    "/api/mobile/v1/scan?unexpected=1",
    "/api/mobile/v1/shopping/",
  ])
    for (const method of ["GET", "POST", "DELETE", "OPTIONS"])
      assert.equal(
        nativeIngressAllowed(`https://${host}${path}`, method, host),
        false,
      );
  assert.equal(
    nativeIngressAllowed(`https://${host}/api/mobile/v1/shopping`, "GET", host),
    false,
  );
});
test("other protected hosts are unchanged; missing API routing is inert and malformed configuration fails closed", () => {
  assert.equal(
    nativeIngressAllowed(
      "https://protected-preview.vercel.app/staff",
      "GET",
      host,
    ),
    true,
  );
  assert.equal(
    nativeIngressAllowed("https://production.example/shop", "GET"),
    true,
  );
  assert.equal(
    nativeIngressAllowed(
      `https://${host}/api/mobile/v1/shopping`,
      "POST",
      "https://" + host,
    ),
    false,
  );
});
test("actual Host takes precedence over an internal Next URL; forwarded-host cannot choose policy", () => {
  assert.equal(
    nativeIngressAllowed("http://127.0.0.1:3100/shop", "GET", host, host),
    false,
  );
  assert.equal(
    nativeIngressAllowed(
      "http://127.0.0.1:3100/api/mobile/v1/scan",
      "POST",
      host,
      host.toUpperCase(),
    ),
    true,
  );
});
test("reserved public API hostname fails closed if an updated deployment drops its env setting", () => {
  assert.equal(nativeIngressAllowed(`https://${host}/`, "GET"), false);
  assert.equal(
    nativeIngressAllowed(`https://${host}/api/mobile/v1/shopping`, "POST"),
    false,
  );
});
