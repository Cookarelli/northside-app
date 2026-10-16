import "server-only";
import * as oidc from "openid-client";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { isolatedOidc } from "./providers";

type Tokens = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
async function tokenBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("invalid_token_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw Error("invalid_token_response");
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}
function subjectTypeError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "OAUTH_INVALID_RESPONSE" &&
    error.cause instanceof Error &&
    error.cause.message === 'unexpected JWT "sub" (subject) claim type'
  );
}
async function grant(
  source: oidc.Configuration,
  run: (config: oidc.Configuration) => Promise<Tokens>,
  expectedNonce?: string,
  expectedSubject?: string,
): Promise<Tokens> {
  const config = isolatedOidc(source);
  const metadata = config.serverMetadata();
  const client = config.clientMetadata();
  const transport: oidc.CustomFetch =
    config[oidc.customFetch] ??
    ((url, options) => fetch(url, options as RequestInit));
  let body: Record<string, unknown> | undefined;
  config[oidc.customFetch] = async (url, options) => {
    const response = await transport(url, { ...options, redirect: "manual" });
    if (url === metadata.token_endpoint && response.status === 200)
      body = await tokenBody(response.clone());
    return response;
  };
  try {
    const result = await run(config);
    if (
      expectedSubject !== undefined &&
      result.claims() &&
      result.claims()!.sub !== expectedSubject
    )
      throw Error("refresh_identity_mismatch");
    return result;
  } catch (error) {
    if (!subjectTypeError(error) || !body) throw error;
    if (
      typeof body.id_token !== "string" ||
      typeof body.access_token !== "string" ||
      !body.access_token ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer" ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0 ||
      (body.refresh_token !== undefined &&
        (typeof body.refresh_token !== "string" || !body.refresh_token)) ||
      (body.scope !== undefined && typeof body.scope !== "string")
    )
      throw error;
    const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri!), {
      timeoutDuration: 10000,
      [customFetch]: (url, options) =>
        transport(url, {
          ...options,
          body: undefined,
          headers: Object.fromEntries(options.headers.entries()),
          redirect: "manual",
        }),
    });
    // Verify the original signed bytes. Only then canonicalize Shopify's numeric subject.
    const { payload } = await jwtVerify(body.id_token, jwks, {
      algorithms: ["RS256"],
      issuer: metadata.issuer,
      audience: client.client_id,
      requiredClaims: [
        "iss",
        "aud",
        "sub",
        "exp",
        "iat",
        ...(expectedNonce ? ["nonce"] : []),
      ],
      clockTolerance: 30,
    });
    if (
      typeof payload.sub !== "number" ||
      !Number.isSafeInteger(payload.sub) ||
      payload.sub <= 0 ||
      typeof payload.iat !== "number" ||
      payload.iat < 0 ||
      payload.iat > Date.now() / 1000 + 30 ||
      (expectedNonce !== undefined && payload.nonce !== expectedNonce) ||
      (payload.azp !== undefined && payload.azp !== client.client_id) ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== client.client_id) ||
      (payload.auth_time !== undefined &&
        (typeof payload.auth_time !== "number" ||
          !Number.isFinite(payload.auth_time) ||
          payload.auth_time < 0)) ||
      client.default_max_age !== undefined ||
      client.require_auth_time === true
    )
      throw error;
    const subject = String(payload.sub);
    if (expectedSubject !== undefined && subject !== expectedSubject)
      throw error;
    const claims = { ...payload, sub: subject };
    return {
      access_token: body.access_token,
      token_type: "bearer",
      expires_in: body.expires_in,
      id_token: body.id_token,
      ...(typeof body.refresh_token === "string"
        ? { refresh_token: body.refresh_token }
        : {}),
      ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
      claims: () => claims,
    } as Tokens;
  }
}
export function shopifyAuthorizationCodeGrant(
  config: oidc.Configuration,
  callback: URL,
  checks: oidc.AuthorizationCodeGrantChecks & { expectedNonce: string },
) {
  if (checks.maxAge !== undefined) throw Error("unsupported_max_age");
  return grant(
    config,
    (isolated) => oidc.authorizationCodeGrant(isolated, callback, checks),
    checks.expectedNonce,
  );
}
export function shopifyRefreshTokenGrant(
  config: oidc.Configuration,
  refreshToken: string,
  expectedSubject: string,
) {
  return grant(
    config,
    (isolated) => oidc.refreshTokenGrant(isolated, refreshToken),
    undefined,
    expectedSubject,
  );
}
