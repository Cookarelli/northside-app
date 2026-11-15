import test from "node:test";
import assert from "node:assert/strict";
import { mobileConfiguration } from "../lib/server/mobile/config";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { AccessError } from "../lib/server/security";
import { NORTHSIDE_NATIVE_API_PREVIEW_HOST as host } from "../lib/native-api-ingress";

const origin = `https://${host}`;
const returnUri = "northside-collectibles-preview://auth/return";
const keys = [
  "APP_ORIGIN",
  "NORTHSIDE_FIXTURES",
  "NORTHSIDE_MOBILE_ENVIRONMENT",
  "NORTHSIDE_MOBILE_PREVIEW_RETURN_URI",
  "NORTHSIDE_MOBILE_PRODUCTION_RETURN_URI",
  "NORTHSIDE_MOBILE_DEVELOPMENT_RETURN_URI",
  "NORTHSIDE_MOBILE_AUTH_ORIGIN",
  "NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED",
  "NORTHSIDE_NATIVE_API_HOST",
  "NORTHSIDE_MOBILE_QA_APPROVED_AT",
  "NORTHSIDE_MOBILE_QA_EXPIRES_AT",
] as const;
function configured<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, {
      APP_ORIGIN: "https://protected-portal.example.test",
      NORTHSIDE_FIXTURES: "0",
      NORTHSIDE_MOBILE_ENVIRONMENT: "staging",
      NORTHSIDE_MOBILE_PREVIEW_RETURN_URI: returnUri,
      NORTHSIDE_MOBILE_QA_APPROVED_AT: new Date(
        Date.now() - 60_000,
      ).toISOString(),
      NORTHSIDE_MOBILE_QA_EXPIRES_AT: new Date(
        Date.now() + 3_600_000,
      ).toISOString(),
      ...Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== undefined),
      ),
    });
    return run();
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}
const enabled = {
  NORTHSIDE_MOBILE_AUTH_ORIGIN: origin,
  NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: "true",
  NORTHSIDE_NATIVE_API_HOST: host,
};
const unavailable = (e: unknown) =>
  e instanceof AccessError && e.status === 503;

test("mobile RC auth origin is an explicit staging-only fixed alias and preserves browser origin", () => {
  configured(enabled, () => {
    const c = mobileConfiguration("preview");
    assert.deepEqual(c, {
      variant: "preview",
      origin,
      returnUri,
      callbackUri: `${origin}/api/mobile/v1/auth/callback`,
    });
    assert.equal(
      process.env.APP_ORIGIN,
      "https://protected-portal.example.test",
    );
  });
  configured({}, () => {
    assert.equal(
      mobileConfiguration("preview").origin,
      "https://protected-portal.example.test",
    );
  });
});

test("RC mobile auth origin rejects missing opt-in, wrong host and arbitrary callback origins", () => {
  for (const change of [
    { NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: undefined },
    { NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: "false" },
    { NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: "TRUE" },
    { NORTHSIDE_NATIVE_API_HOST: undefined },
    { NORTHSIDE_NATIVE_API_HOST: "other.example.test" },
    { NORTHSIDE_NATIVE_API_HOST: origin },
    { NORTHSIDE_MOBILE_AUTH_ORIGIN: "https://other.example.test" },
    { NORTHSIDE_MOBILE_AUTH_ORIGIN: origin + "/" },
    { NORTHSIDE_MOBILE_AUTH_ORIGIN: origin + "/api/mobile/v1" },
    { NORTHSIDE_MOBILE_AUTH_ORIGIN: "http://" + host },
  ]) {
    configured({ ...enabled, ...change }, () => {
      assert.throws(() => mobileConfiguration("preview"), unavailable);
    });
  }
});

test("staging RC origin cannot be borrowed by development or production", () => {
  configured(
    {
      ...enabled,
      NORTHSIDE_MOBILE_DEVELOPMENT_RETURN_URI: "northside-dev://auth/return",
    },
    () => {
      assert.throws(() => mobileConfiguration("development"), unavailable);
      assert.throws(() => mobileConfiguration("production"), unavailable);
    },
  );
  configured(
    {
      ...enabled,
      NORTHSIDE_MOBILE_ENVIRONMENT: "production",
      NORTHSIDE_MOBILE_PRODUCTION_RETURN_URI:
        "northside-production://auth/return",
    },
    () => {
      assert.throws(() => mobileConfiguration("preview"), unavailable);
      assert.throws(() => mobileConfiguration("production"), unavailable);
    },
  );
});

test("native RC keeps exact configured return URI validation and fails before auth for unsafe values", () => {
  for (const value of [
    "http://example.test/mobile/auth/return",
    "javascript://auth/return",
    "northside-collectibles-preview://auth/other",
    "northside-collectibles-preview://auth/return?token=x",
    "northside-collectibles-preview://user:secret@auth/return",
    "northside-collectibles-preview://auth/return#fragment",
  ])
    configured(
      { ...enabled, NORTHSIDE_MOBILE_PREVIEW_RETURN_URI: value },
      () => {
        assert.throws(() => mobileConfiguration("preview"), unavailable);
      },
    );
});

test("actual proxy requires staging and exact opt-in before exposing existing customer endpoints", () => {
  for (const environment of ["staging", "production", "development", ""]) {
    for (const approval of ["true", "false", "TRUE", ""]) {
      configured(
        {
          ...enabled,
          NORTHSIDE_MOBILE_ENVIRONMENT: environment,
          NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED: approval,
        },
        () => {
          const request = new NextRequest(
            `${origin}/api/mobile/v1/auth/intents`,
            { method: "POST", headers: { host } },
          );
          assert.equal(
            proxy(request).status,
            environment === "staging" && approval === "true" ? 200 : 404,
          );
          const forbidden = new NextRequest(
            `${origin}/api/private/service-requests`,
            { method: "POST", headers: { host } },
          );
          assert.equal(proxy(forbidden).status, 404);
        },
      );
    }
  }
});
