import test from "node:test";
import assert from "node:assert/strict";
import {
  NORTHSIDE_NATIVE_API_PREVIEW_HOST as host,
  nativeCustomerServicesApproved,
  nativeIngressAllowed,
} from "../lib/native-api-ingress";

const approvedAt = "2026-11-15T02:42:57.000Z";
const expiresAt = "2026-11-16T02:42:57.000Z";
const start = Date.parse(approvedAt);
const end = Date.parse(expiresAt);
const approved = Object.freeze({
  NORTHSIDE_MOBILE_ENVIRONMENT: "staging",
  NORTHSIDE_NATIVE_API_HOST: host,
  NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: "true",
  NORTHSIDE_MOBILE_QA_APPROVED_AT: approvedAt,
  NORTHSIDE_MOBILE_QA_EXPIRES_AT: expiresAt,
});

test("the approved 24-hour window starts inclusively and expires without another deployment", () => {
  for (const [now, expected] of [
    [start - 1, false],
    [start, true],
    [start + 1, true],
    [end - 1, true],
    [end, false],
    [end + 1, false],
  ] as const)
    assert.equal(
      nativeCustomerServicesApproved(approved, now),
      expected,
      String(now),
    );
  assert.equal(end - start, 86_400_000);
});

test("a shorter approval is valid only within its recorded window", () => {
  const short = {
    ...approved,
    NORTHSIDE_MOBILE_QA_EXPIRES_AT: new Date(start + 1).toISOString(),
  };
  assert.equal(nativeCustomerServicesApproved(short, start - 1), false);
  assert.equal(nativeCustomerServicesApproved(short, start), true);
  assert.equal(nativeCustomerServicesApproved(short, start + 1), false);
});

test("dates cannot replace the exact staging, hostname and explicit approval gates", () => {
  const invalid: Record<string, (string | undefined)[]> = {
    NORTHSIDE_MOBILE_ENVIRONMENT: [
      undefined,
      "",
      "production",
      "development",
      "STAGING",
      " staging",
    ],
    NORTHSIDE_NATIVE_API_HOST: [
      undefined,
      "",
      "other.example.test",
      `https://${host}`,
      `${host}/`,
      host.toUpperCase(),
    ],
    NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: [
      undefined,
      "",
      "false",
      "TRUE",
      "1",
      "true ",
    ],
  };
  for (const [key, values] of Object.entries(invalid))
    for (const value of values)
      assert.equal(
        nativeCustomerServicesApproved({ ...approved, [key]: value }, start),
        false,
        `${key}=${String(value)}`,
      );
});

test("both approval timestamps must be present and canonical UTC instants", () => {
  const invalid = [
    undefined,
    "",
    "not-a-date",
    "2026-11-15",
    "2026-11-15T02:42:57Z",
    "2026-11-15T02:42:57.000+00:00",
    "2026-11-15T02:42:57.0000Z",
    "2026-11-15T02:42:57.000z",
    "2026-11-15T02:42:57.000Z ",
    " 2026-11-15T02:42:57.000Z",
    "2026-02-30T02:42:57.000Z",
    "2026-02-29T02:42:57.000Z",
    "2026-11-15T24:00:00.000Z",
    "2026-11-15T02:42:60.000Z",
    "2026-13-15T02:42:57.000Z",
  ];
  for (const key of [
    "NORTHSIDE_MOBILE_QA_APPROVED_AT",
    "NORTHSIDE_MOBILE_QA_EXPIRES_AT",
  ])
    for (const value of invalid)
      assert.equal(
        nativeCustomerServicesApproved({ ...approved, [key]: value }, start),
        false,
        `${key}=${String(value)}`,
      );
});

test("equal, reversed and over-24-hour windows fail closed even at their start", () => {
  for (const expiry of [start, start - 1, end + 1])
    assert.equal(
      nativeCustomerServicesApproved(
        {
          ...approved,
          NORTHSIDE_MOBILE_QA_EXPIRES_AT: new Date(expiry).toISOString(),
        },
        start,
      ),
      false,
      new Date(expiry).toISOString(),
    );
});

test("a real leap-day UTC window remains valid without accepting rollover dates", () => {
  const leap = {
    ...approved,
    NORTHSIDE_MOBILE_QA_APPROVED_AT: "2028-02-29T02:42:57.000Z",
    NORTHSIDE_MOBILE_QA_EXPIRES_AT: "2028-03-01T02:42:57.000Z",
  };
  assert.equal(
    nativeCustomerServicesApproved(
      leap,
      Date.parse(leap.NORTHSIDE_MOBILE_QA_APPROVED_AT),
    ),
    true,
  );
  assert.equal(
    nativeCustomerServicesApproved(
      leap,
      Date.parse(leap.NORTHSIDE_MOBILE_QA_EXPIRES_AT),
    ),
    false,
  );
});

test("nonfinite clocks never authorize a recorded approval", () => {
  for (const now of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])
    assert.equal(nativeCustomerServicesApproved(approved, now), false);
});

test("expiry closes existing native auth, account, request and private-photo routes", () => {
  const routes: [string, string][] = [
    ["POST", "/api/mobile/v1/auth/intents"],
    ["GET", "/api/mobile/v1/auth/start?intent=opaque"],
    ["GET", "/api/mobile/v1/auth/callback?code=canary&state=canary"],
    ["POST", "/api/mobile/v1/auth/exchange"],
    ["POST", "/api/mobile/v1/auth/renew"],
    ["POST", "/api/mobile/v1/auth/logout"],
    ["GET", "/api/mobile/v1/me"],
    ["GET", "/api/mobile/v1/me/service-requests"],
    ["POST", "/api/mobile/v1/me/service-requests"],
    [
      "GET",
      "/api/mobile/v1/me/request-photos?photo_id=00000000-0000-4000-8000-000000000001",
    ],
    [
      "POST",
      "/api/mobile/v1/me/request-photos?request_id=00000000-0000-4000-8000-000000000001&photo_id=00000000-0000-4000-8000-000000000002",
    ],
  ];
  for (const [method, path] of routes)
    for (const [now, expected] of [
      [start - 1, false],
      [start, true],
      [end - 1, true],
      [end, false],
    ] as const)
      assert.equal(
        nativeIngressAllowed(
          `https://${host}${path}`,
          method,
          host,
          null,
          nativeCustomerServicesApproved(approved, now),
        ),
        expected,
        `${method} ${path} at ${now}`,
      );
});

test("expiry preserves public catalog, scanning and shopping while browser and staff routes stay closed on the native alias", () => {
  const expired = nativeCustomerServicesApproved(approved, end);
  for (const [method, path] of [
    ["GET", "/api/mobile/v1/catalog?q=topps"],
    ["GET", "/api/mobile/v1/catalog/existing-product"],
    ["POST", "/api/mobile/v1/scan"],
    ["POST", "/api/mobile/v1/shopping"],
  ])
    assert.equal(
      nativeIngressAllowed(
        `https://${host}${path}`,
        method,
        host,
        null,
        expired,
      ),
      true,
      `${method} ${path}`,
    );
  for (const path of [
    "/account",
    "/staff/requests",
    "/api/private/service-requests",
  ])
    for (const now of [start, end])
      assert.equal(
        nativeIngressAllowed(
          `https://${host}${path}`,
          "GET",
          host,
          null,
          nativeCustomerServicesApproved(approved, now),
        ),
        false,
      );
});

test("the native QA deadline does not change routing on the protected website host", () => {
  for (const path of [
    "/account",
    "/staff/requests",
    "/api/private/service-requests",
  ])
    for (const now of [start, end])
      assert.equal(
        nativeIngressAllowed(
          `https://protected-preview.example.test${path}`,
          "GET",
          host,
          null,
          nativeCustomerServicesApproved(approved, now),
        ),
        true,
      );
});
