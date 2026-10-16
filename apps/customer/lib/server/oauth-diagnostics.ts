const stages = [
  "attempt_cookie",
  "discovery",
  "attempt_load",
  "attempt_decrypt",
  "token_exchange",
  "identity",
  "session",
  "redirect",
] as const;
export type CallbackStage = (typeof stages)[number];
const codes = [
  "OAUTH_RESPONSE_BODY_ERROR",
  "OAUTH_AUTHORIZATION_RESPONSE_ERROR",
  "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED",
  "OAUTH_INVALID_RESPONSE",
  "OAUTH_KEY_SELECTION_FAILED",
  "OAUTH_UNSUPPORTED_OPERATION",
  "OAUTH_UNEXPECTED_HTTP_RESPONSE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ABORT_ERR",
  "28P01",
  "42501",
  "23503",
];
const oauthErrors = [
  "invalid_client",
  "invalid_grant",
  "invalid_request",
  "unauthorized_client",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
];
function field(value: unknown, key: string): unknown {
  try {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}
function allowed(value: unknown, values: readonly string[]) {
  return typeof value === "string" && values.includes(value)
    ? value
    : "UNKNOWN";
}
export function callbackDiagnostic(stage: CallbackStage, error: unknown) {
  const cause = field(error, "cause");
  return {
    event: "customer_oauth_callback_failed",
    stage: allowed(stage, stages),
    code: allowed(field(error, "code") ?? field(cause, "code"), codes),
    oauthError: allowed(
      field(error, "error") ?? field(cause, "error"),
      oauthErrors,
    ),
    claim: allowed(field(cause, "claim") ?? field(error, "claim"), [
      "iss",
      "aud",
      "sub",
      "nonce",
      "exp",
      "iat",
      "nbf",
      "azp",
    ]),
  };
}
export function reportCallbackFailure(stage: CallbackStage, error: unknown) {
  try {
    console.warn(JSON.stringify(callbackDiagnostic(stage, error)));
  } catch {
    // Diagnostics must never replace the existing fail-closed response.
  }
}
