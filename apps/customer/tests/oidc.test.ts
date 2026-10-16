import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import * as oidc from "openid-client";
import { configureOidc } from "../lib/server/providers";
import {
  shopifyAuthorizationCodeGrant,
  shopifyRefreshTokenGrant,
} from "../lib/server/shopify-tokens";
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
function client(
  overrides: Record<string, unknown> = {},
  badSignature = false,
  id = "northside-test",
  secret = "test-secret",
  tokenOverrides: Record<string, unknown> = {},
  clientOverrides: Partial<oidc.ClientMetadata> = {},
) {
  const config = configureOidc(
    {
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
      id_token_signing_alg_values_supported: ["RS256"],
    },
    id,
    secret,
    clientOverrides,
  );
  config[oidc.customFetch] = async (url, options) => {
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    const body = new URLSearchParams(String(options.body));
    assert.equal(
      new Headers(options.headers).get("authorization"),
      `Basic ${Buffer.from(`${id}:${secret}`, "utf8").toString("base64")}`,
    );
    assert.equal(body.get("client_id"), id);
    assert.equal(body.has("client_secret"), false);
    if (body.get("grant_type") === "authorization_code") {
      assert.equal(body.get("code_verifier"), "test-verifier");
    } else {
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "test-refresh");
    }
    return Response.json({
      token_type: "Bearer",
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 300,
      id_token: jwt({ aud: id, ...overrides }, badSignature),
      ...tokenOverrides,
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
test("Shopify confidential auth preserves client ID punctuation, signed ID token and PKCE", async () => {
  const result = await shopifyAuthorizationCodeGrant(
    client(),
    callback,
    checks,
  );
  assert.equal(result.claims()?.sub, "verified-test-subject");
});
test("Shopify refresh uses the same confidential authentication without a body secret", async () => {
  const result = await shopifyRefreshTokenGrant(
    client(),
    "test-refresh",
    "verified-test-subject",
  );
  assert.equal(result.claims()?.sub, "verified-test-subject");
  assert.equal(result.expires_in, 300);
});
test("Shopify confidential auth preserves a UUID client ID and reserved secret characters", async () => {
  const id = "00000000-0000-4000-8000-000000000000";
  const secret = "synthetic-only:+/=&%value";
  const result = await shopifyAuthorizationCodeGrant(
    client({}, false, id, secret),
    callback,
    checks,
  );
  assert.equal(result.claims()?.aud, id);
  const refreshed = await shopifyRefreshTokenGrant(
    client({}, false, id, secret),
    "test-refresh",
    "verified-test-subject",
  );
  assert.equal(refreshed.claims()?.aud, id);
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
      shopifyAuthorizationCodeGrant(client(overrides), callback, checks),
    );
  });
test("OIDC rejects forged signature", async () => {
  await assert.rejects(
    shopifyAuthorizationCodeGrant(client({}, true), callback, checks),
  );
});
test("OIDC rejects wrong state before accepting login", async () => {
  await assert.rejects(
    shopifyAuthorizationCodeGrant(client(), callback, {
      ...checks,
      expectedState: "other",
    }),
  );
});
test("Shopify numeric subject is canonicalized only after signature and claim verification", async () => {
  const result = await shopifyAuthorizationCodeGrant(
    client({ sub: 123456789 }),
    callback,
    checks,
  );
  assert.equal(result.claims()?.sub, "123456789");
  const refreshed = await shopifyRefreshTokenGrant(
    client({ sub: 123456789 }),
    "test-refresh",
    "123456789",
  );
  assert.equal(refreshed.claims()?.sub, "123456789");
});
for (const [name, overrides] of [
  ["null", { sub: null }],
  ["object", { sub: { id: 1 } }],
  ["array", { sub: [1] }],
  ["zero", { sub: 0 }],
  ["negative", { sub: -1 }],
  ["fraction", { sub: 1.5 }],
  ["unsafe integer", { sub: Number.MAX_SAFE_INTEGER + 1 }],
  ["issuer", { sub: 123, iss: "https://evil.test" }],
  ["audience", { sub: 123, aud: "other" }],
  [
    "multi audience without azp",
    { sub: 123, aud: ["northside-test", "other"] },
  ],
  ["azp", { sub: 123, azp: "other" }],
  ["nonce", { sub: 123, nonce: "wrong" }],
  ["missing nonce", { sub: 123, nonce: undefined }],
  ["expiry", { sub: 123, exp: 1 }],
  ["future issued", { sub: 123, iat: 9999999999 }],
  ["missing issued", { sub: 123, iat: undefined }],
  ["not before", { sub: 123, nbf: 9999999999 }],
  ["auth time", { sub: 123, auth_time: "invalid" }],
] as const)
  test(`numeric subject compatibility rejects invalid ${name}`, async () => {
    await assert.rejects(
      shopifyAuthorizationCodeGrant(client(overrides), callback, checks),
    );
  });
test("numeric compatibility rejects forged signatures and changed refresh identity", async () => {
  await assert.rejects(
    shopifyAuthorizationCodeGrant(client({ sub: 123 }, true), callback, checks),
  );
  await assert.rejects(
    shopifyRefreshTokenGrant(client({ sub: 123 }), "test-refresh", "456"),
  );
});
for (const [name, body] of [
  ["empty access token", { access_token: "" }],
  ["token type", { token_type: "unsupported" }],
  ["zero expiry", { expires_in: 0 }],
  ["invalid expiry", { expires_in: "invalid" }],
  ["empty refresh", { refresh_token: "" }],
  ["scope", { scope: [] }],
  ["oversized", { padding: "x".repeat(65536) }],
] as const)
  test(`numeric compatibility rejects token body ${name}`, async () => {
    await assert.rejects(
      shopifyAuthorizationCodeGrant(
        client({ sub: 123 }, false, "northside-test", "test-secret", body),
        callback,
        checks,
      ),
    );
  });
test("concurrent grants on a cached source config never share captured identities", async () => {
  const source = client({ sub: 123 });
  const [first, second] = await Promise.all([
    shopifyAuthorizationCodeGrant(source, callback, checks),
    shopifyAuthorizationCodeGrant(source, callback, checks),
  ]);
  assert.equal(first.claims()?.sub, "123");
  assert.equal(second.claims()?.sub, "123");
  await assert.rejects(
    shopifyRefreshTokenGrant(client(), "test-refresh", "other"),
  );
});
for (const policy of [{ default_max_age: 300 }, { require_auth_time: true }])
  test("numeric compatibility preserves configured authentication-time policy", async () => {
    const source = client(
      { sub: 123 },
      false,
      "northside-test",
      "test-secret",
      {},
      policy,
    );
    await assert.rejects(
      shopifyAuthorizationCodeGrant(source, callback, checks),
    );
    await assert.rejects(
      shopifyRefreshTokenGrant(source, "test-refresh", "123"),
    );
  });
test("concurrent grants retain distinct captured numeric subjects", async () => {
  const source = client();
  let count = 0;
  const originalFetch = source[oidc.customFetch]!;
  source[oidc.customFetch] = async (url, options) => {
    if (url.endsWith("/jwks")) return originalFetch(url, options);
    const sub = ++count;
    await Promise.resolve();
    return Response.json({
      access_token: "test-access",
      token_type: "Bearer",
      expires_in: 300,
      id_token: jwt({ sub }),
    });
  };
  const results = await Promise.all([
    shopifyAuthorizationCodeGrant(source, callback, checks),
    shopifyAuthorizationCodeGrant(source, callback, checks),
  ]);
  assert.deepEqual(results.map((r) => r.claims()?.sub).sort(), ["1", "2"]);
});
