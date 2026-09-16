import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import * as oidc from "openid-client";
import { configureOidc } from "../lib/server/providers";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const issuer = "https://identity.example.test";
function jwt(overrides: Record<string, unknown> = {}, badSignature = false) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: "northside-test",
    sub: "verified-test-subject",
    iat: now,
    exp: now + 300,
    nonce: "test-nonce",
    ...overrides,
  };
  const body = [
    Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
  ].join(".");
  return (
    body +
    "." +
    (badSignature
      ? Buffer.from("bad")
      : sign("RSA-SHA256", Buffer.from(body), pair.privateKey)
    ).toString("base64url")
  );
}
function client(overrides: Record<string, unknown> = {}, badSignature = false) {
  const config = configureOidc(
    {
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
      id_token_signing_alg_values_supported: ["RS256"],
    },
    "northside-test",
    "test-secret",
  );
  config[oidc.customFetch] = async (url, options) => {
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    assert.equal(
      new URLSearchParams(String(options.body)).get("code_verifier"),
      "test-verifier",
    );
    return Response.json({
      token_type: "Bearer",
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 300,
      id_token: jwt(overrides, badSignature),
    });
  };
  return config;
}
const callback = new URL(
  "https://app.example.test/api/auth/shopify/callback?code=test-code&state=test-state",
);
const checks = {
  expectedState: "test-state",
  expectedNonce: "test-nonce",
  pkceCodeVerifier: "test-verifier",
  idTokenExpected: true,
};
test("real OIDC library validates signed ID token and uses PKCE verifier", async () => {
  const result = await oidc.authorizationCodeGrant(client(), callback, checks);
  assert.equal(result.claims()?.sub, "verified-test-subject");
});
for (const [name, overrides] of [
  ["issuer", { iss: "https://evil.test" }],
  ["audience", { aud: "another-client" }],
  ["nonce", { nonce: "wrong" }],
  ["expiry", { exp: 1 }],
  ["missing subject", { sub: undefined }],
] as const)
  test(`OIDC rejects invalid ${name}`, async () => {
    await assert.rejects(
      oidc.authorizationCodeGrant(client(overrides), callback, checks),
    );
  });
test("OIDC rejects forged signature", async () => {
  await assert.rejects(
    oidc.authorizationCodeGrant(client({}, true), callback, checks),
  );
});
test("OIDC rejects wrong state before accepting login", async () => {
  await assert.rejects(
    oidc.authorizationCodeGrant(client(), callback, {
      ...checks,
      expectedState: "other",
    }),
  );
});
