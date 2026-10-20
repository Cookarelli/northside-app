import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { transaction } from "@/lib/server/db";
import { shopifyOidc } from "@/lib/server/providers";
import {
  ATTEMPT_COOKIE,
  appOrigin,
  cookieOptions,
  errorResponse,
  hashToken,
  opaqueToken,
  safeReturn,
  sameOrigin,
  seal,
} from "@/lib/server/security";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const config = await shopifyOidc();
    const form = await request.formData();
    const token = opaqueToken(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    const hash = hashToken(token);
    const returnTo = safeReturn(form.get("returnTo"));
    await transaction("auth", (db) =>
      db.query(
        "insert into ns.oauth_attempts(token_hash,encrypted_payload,expires_at) values($1,$2,$3)",
        [
          hash,
          seal({ state, nonce, verifier, returnTo }, hash),
          new Date(Date.now() + 300000),
        ],
      ),
    );
    (await cookies()).set(ATTEMPT_COOKIE, token, {
      ...cookieOptions,
      maxAge: 300,
    });
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: appOrigin() + "/api/auth/shopify/callback",
      scope: "openid email customer-account-api:full",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    return NextResponse.redirect(url, 303);
  } catch (e) {
    return errorResponse(e);
  }
}
