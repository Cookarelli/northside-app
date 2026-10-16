import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { transaction } from "@/lib/server/db";
import { supabase, shopifyOidc } from "@/lib/server/providers";
import {
  revokeSession,
  type StoredSession,
  type Tokens,
} from "@/lib/server/sessions";
import {
  SESSION_COOKIE,
  ATTEMPT_COOKIE,
  appOrigin,
  cookieOptions,
  errorResponse,
  hashToken,
  sameOrigin,
  unseal,
  validToken,
  privateHeaders,
} from "@/lib/server/security";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const jar = await cookies(),
      token = jar.get(SESSION_COOKIE)?.value;
    let session: StoredSession | undefined;
    let tokens: Tokens | undefined;
    if (validToken(token)) {
      session = await transaction("auth", async (db) => {
        const row = (
          await db.query<StoredSession>(
            "select * from ns.sessions where token_hash=$1 and revoked_at is null",
            [hashToken(token)],
          )
        ).rows[0];
        await revokeSession(db, token);
        return row;
      });
      if (session) {
        try {
          tokens = unseal<Tokens>(session.encrypted_tokens, hashToken(token));
        } catch {
          /* Local revocation must survive a stale encryption key. */
        }
      }
    }
    jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    jar.set(ATTEMPT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    jar.set("__Host-ns_cart", "", { ...cookieOptions, maxAge: 0 });
    jar.set("__Host-ns_campaign", "", { ...cookieOptions, maxAge: 0 });
    let target = new URL("/account", appOrigin());
    if (session?.provider === "shopify" && tokens?.id_token) {
      try {
        target = oidc.buildEndSessionUrl(await shopifyOidc(), {
          id_token_hint: tokens.id_token,
          post_logout_redirect_uri: appOrigin() + "/account",
        });
      } catch {
        /* Local session is already revoked; provider logout remains unverified. */
      }
    }
    if (session?.provider === "supabase" && tokens) {
      try {
        await supabase(true).auth.admin.signOut(tokens.access_token, "local");
      } catch {
        /* Revocation in this app is already durable. */
      }
    }
    const response =
      new URL(request.url).searchParams.get("local") === "1"
        ? NextResponse.json({ signedOut: true })
        : NextResponse.redirect(target, 303);
    for (const [k, v] of Object.entries(privateHeaders()))
      response.headers.set(k, v);
    response.headers.set("Clear-Site-Data", '"cache", "storage"');
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
