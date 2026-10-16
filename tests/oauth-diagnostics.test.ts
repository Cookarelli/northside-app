import { expect, test, vi } from "vitest";
import {
  callbackDiagnostic,
  reportCallbackFailure,
} from "../apps/customer/lib/server/oauth-diagnostics";

test("callback diagnostics retain only fixed stages and allowlisted categories", () => {
  expect(
    callbackDiagnostic("token_exchange", {
      code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
      cause: {
        claim: "nonce",
        expected: "private-value",
        actual: "private-value",
      },
    }),
  ).toEqual({
    event: "customer_oauth_callback_failed",
    stage: "token_exchange",
    code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
    oauthError: "UNKNOWN",
    claim: "nonce",
  });
  expect(
    callbackDiagnostic("token_exchange", { error: "invalid_grant" }).oauthError,
  ).toBe("invalid_grant");
});
test("callback diagnostics never serialize poisoned provider or credential data", () => {
  const poison = "PRIVATE_CANARY_MUST_NEVER_BE_LOGGED";
  const output = callbackDiagnostic(poison as "session", {
    code: poison,
    error: poison,
    message: poison,
    stack: poison,
    url: poison,
    response: { body: poison },
    error_description: poison,
    cause: { code: poison, error: poison, claim: poison, access_token: poison },
    toJSON: () => {
      throw Error(poison);
    },
  });
  expect(JSON.stringify(output)).not.toContain(poison);
  expect(output).toEqual({
    event: "customer_oauth_callback_failed",
    stage: "UNKNOWN",
    code: "UNKNOWN",
    oauthError: "UNKNOWN",
    claim: "UNKNOWN",
  });
});
test("callback logging failures and poisoned property getters do not escape", () => {
  const error = Object.defineProperty({}, "code", {
    get() {
      throw Error("private");
    },
  });
  expect(callbackDiagnostic("session", error).code).toBe("UNKNOWN");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {
    throw Error("logging unavailable");
  });
  try {
    expect(() => reportCallbackFailure("session", error)).not.toThrow();
  } finally {
    warning.mockRestore();
  }
});
