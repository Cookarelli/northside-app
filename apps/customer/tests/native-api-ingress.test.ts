import test from "node:test";
import assert from "node:assert/strict";
import { nativeIngressAllowed } from "../lib/native-api-ingress";
const host =
  "northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app";
test("native API preview default preserves scan/shopping and keeps website, checkout, auth, staff and assets closed", () => {
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

test("server-managed public catalog reads are available without opening customer service routes", () => {
  for (const path of [
    "/api/mobile/v1/catalog",
    "/api/mobile/v1/catalog?q=topps",
    "/api/mobile/v1/catalog/topps-series-one?after=cursor",
  ]) {
    assert.equal(
      nativeIngressAllowed(`https://${host}${path}`, "GET", host),
      true,
    );
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"])
      assert.equal(
        nativeIngressAllowed(`https://${host}${path}`, method, host),
        false,
      );
  }
  for (const path of [
    "/api/mobile/v1/catalog/",
    "/api/mobile/v1/catalog/UPPERCASE",
    "/api/mobile/v1/catalog/item/extra",
  ])
    assert.equal(
      nativeIngressAllowed(`https://${host}${path}`, "GET", host),
      false,
    );
});

test("explicit customer-service ingress exposes only the supported native methods and paths", () => {
  const allowed: [string, string][] = [
    ...[
      "auth/intents",
      "auth/exchange",
      "auth/renew",
      "auth/logout",
      "me/service-requests",
      "me/tracking/terms",
      "me/deletion-request",
    ].map((path) => ["POST", path] as [string, string]),
    ...[
      "auth/start?intent=" + "A".repeat(43),
      "auth/callback?code=SAMPLE&state=SAMPLE",
      "info",
      "releases",
      "me",
      "me/orders?after=cursor",
      "me/wallet",
      "me/breaks",
      "me/deletion-request",
      "me/service-requests",
      "me/service-requests/config",
      "me/request-photos?photo_id=00000000-0000-4000-8000-000000000001",
      "me/cards",
      "me/consignments/00000000-0000-4000-8000-000000000001",
      "me/tracking/grading",
      "me/tracking/consignment/00000000-0000-4000-8000-000000000001/photos/00000000-0000-4000-8000-000000000002",
    ].map((path) => ["GET", path] as [string, string]),
    [
      "POST",
      "me/request-photos?request_id=00000000-0000-4000-8000-000000000001&photo_id=00000000-0000-4000-8000-000000000002",
    ],
  ];
  for (const [method, path] of allowed) {
    const url = `https://${host}/api/mobile/v1/${path}`;
    assert.equal(
      nativeIngressAllowed(url, method, host, null, true),
      true,
      `${method} ${path}`,
    );
    assert.equal(
      nativeIngressAllowed(url, method, host, null, false),
      false,
      `disabled ${method} ${path}`,
    );
    assert.equal(
      nativeIngressAllowed(url, method, undefined, null, true),
      false,
      `unconfigured ${method} ${path}`,
    );
  }
});

test("customer-service opt-in never opens staff, browser, private, checkout or future native routes", () => {
  for (const path of [
    "/",
    "/account",
    "/staff",
    "/api/private/service-requests",
    "/api/private/service-request-photos",
    "/api/commerce/cart",
    "/_next/static/app.js",
    "/api/mobile/v1/staff",
    "/api/mobile/v1/me/admin",
    "/api/mobile/v1/me/service-requests/unknown",
    "/api/mobile/v1/auth/intents/extra",
    "/api/mobile/v1/me/tracking/grading/not-a-uuid",
  ]) {
    for (const method of ["GET", "POST", "PUT", "DELETE", "OPTIONS"])
      assert.equal(
        nativeIngressAllowed(
          `https://${host}${path}`,
          method,
          host,
          null,
          true,
        ),
        false,
        `${method} ${path}`,
      );
  }
  assert.equal(
    nativeIngressAllowed(
      `https://${host}/api/mobile/v1/me`,
      "POST",
      host,
      null,
      true,
    ),
    false,
  );
  assert.equal(
    nativeIngressAllowed(
      `https://${host}/api/mobile/v1/auth/intents?extra=1`,
      "POST",
      host,
      null,
      true,
    ),
    false,
  );
});
