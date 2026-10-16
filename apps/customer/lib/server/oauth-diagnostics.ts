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
function responseReason(error: unknown) {
  const message = field(error, "message");
  // Exact library messages map to fixed labels; never emit arbitrary error text.
  const reasons: Record<string, string> = {
    "JWT signature verification failed": "jwt_signature",
    "Invalid JWT": "jwt_format",
    'unexpected JWT "alg" header parameter': "jwt_algorithm",
    'unexpected "iss" (issuer) response parameter value': "response_issuer",
    'response parameter "iss" (issuer) missing': "response_issuer_missing",
    'unexpected "state" response parameter value': "response_state",
    '"response" body "id_token" property must be a string': "id_token_missing",
    '"response" body "access_token" property must be a string':
      "access_token_missing",
    '"response" body "token_type" property must be a string':
      "token_type_missing",
    '"response" body "expires_in" property must be a number': "expires_in_type",
  };
  for (const [claim, name] of Object.entries({
    iss: "issuer",
    aud: "audience",
    sub: "subject",
    nonce: "nonce",
    exp: "expiration time",
    iat: "issued at",
    nbf: "not before",
    azp: "authorized party",
  })) {
    reasons[`JWT "${claim}" (${name}) claim missing`] = `missing_${claim}`;
    reasons[`unexpected JWT "${claim}" (${name}) claim type`] = `type_${claim}`;
  }
  return typeof message === "string" && Object.hasOwn(reasons, message)
    ? reasons[message]
    : "UNKNOWN";
}
export function callbackDiagnostic(stage: CallbackStage, error: unknown) {
  const cause = field(error, "cause");
  return {
    event: "customer_oauth_callback_failed",
    stage: allowed(stage, stages),
    code: allowed(field(error, "code") ?? field(cause, "code"), codes),
    reason: responseReason(error),
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
