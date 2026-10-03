import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { transaction } from "@/lib/server/db";
import { shopifyOidc } from "@/lib/server/providers";
import {
  createSession,
  establishCustomer,
  revokeSession,
} from "@/lib/server/sessions";
import {
  AccessError,
  ATTEMPT_COOKIE,
  SESSION_COOKIE,
  appOrigin,
  cookieOptions,
  errorResponse,
  hashToken,
  safeReturn,
  unseal,
  validToken,
} from "@/lib/server/security";
export async function GET(request: Request) {
  try {
    const jar = await cookies(),
      token = jar.get(ATTEMPT_COOKIE)?.value;
    jar.set(ATTEMPT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    if (!validToken(token)) throw new AccessError(401, "oauth_attempt_missing");
    const config = await shopifyOidc();
    const hash = hashToken(token);
    const row = await transaction(
      "auth",
      async (db) =>
        (
          await db.query<{ encrypted_payload: string }>(
            "delete from ns.oauth_attempts where token_hash=$1 and expires_at>now() returning encrypted_payload",
            [hash],
          )
        ).rows[0],
    );
    if (!row) throw new AccessError(401, "oauth_attempt_expired");
    const attempt = unseal<{
      state: string;
      nonce: string;
      verifier: string;
      returnTo: string;
    }>(row.encrypted_payload, hash);
    const incoming = new URL(request.url);
    const callback = new URL(appOrigin() + "/api/auth/shopify/callback");
    callback.search = incoming.search;
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      expectedState: attempt.state,
      expectedNonce: attempt.nonce,
      pkceCodeVerifier: attempt.verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new AccessError(401, "identity_missing");
    const session = await transaction("auth", async (db) => {
      const customerId = await establishCustomer(db, claims.sub);
      await revokeSession(db, jar.get(SESSION_COOKIE)?.value);
      return createSession(
        db,
        { customerId },
        "shopify",
        {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          id_token: tokens.id_token,
          subject: claims.sub,
        },
        tokens.expires_in!,
      );
    });
    jar.set(SESSION_COOKIE, session, { ...cookieOptions, maxAge: 8 * 3600 });
    return NextResponse.redirect(
      new URL(safeReturn(attempt.returnTo), appOrigin()),
      303,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
