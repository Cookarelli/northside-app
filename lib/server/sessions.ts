import "server-only";
import { randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { type Sql, transaction } from "./db";
import {
  AccessError,
  hashToken,
  opaqueToken,
  seal,
  unseal,
  validToken,
} from "./security";
import { SHOP, TENANT, shopifyOidc, supabase } from "./providers";
export type Tokens = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  subject: string;
};
export type StoredSession = {
  token_hash: string;
  tenant_id: string;
  customer_id: string | null;
  staff_id: string | null;
  provider: "shopify" | "supabase";
  encrypted_tokens: string;
  token_expires_at: Date | string;
  expires_at: Date | string;
};
export async function establishCustomer(db: Sql, subject: string) {
  if (!subject) throw new AccessError(401, "invalid_identity");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    `${TENANT}/${SHOP}/${subject}`,
  ]);
  const found = (
    await db.query<{ customer_id: string }>(
      "select customer_id from ns.customer_identities where tenant_id=$1 and shop=$2 and provider='shopify' and subject=$3",
      [TENANT, SHOP, subject],
    )
  ).rows[0];
  if (found) return found.customer_id;
  const customerId = randomUUID();
  await db.query("insert into ns.customers(tenant_id,id) values($1,$2)", [
    TENANT,
    customerId,
  ]);
  await db.query(
    "insert into ns.customer_identities(tenant_id,customer_id,shop,provider,subject) values($1,$2,$3,'shopify',$4)",
    [TENANT, customerId, SHOP, subject],
  );
  return customerId;
}
export async function createSession(
  db: Sql,
  subject: { customerId?: string; staffId?: string },
  provider: "shopify" | "supabase",
  tokens: Tokens,
  expiresIn: number,
) {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new AccessError(401, "token_expiry_missing");
  const token = opaqueToken(),
    hash = hashToken(token);
  await db.query(
    "insert into ns.sessions(token_hash,tenant_id,customer_id,staff_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      hash,
      TENANT,
      subject.customerId ?? null,
      subject.staffId ?? null,
      provider,
      seal(tokens, hash),
      new Date(Date.now() + expiresIn * 1000),
      new Date(Date.now() + 8 * 3600000),
    ],
  );
  return token;
}
export async function revokeSession(db: Sql, token: unknown) {
  if (validToken(token))
    await db.query(
      "update ns.sessions set revoked_at=now(),encrypted_tokens='revoked' where token_hash=$1",
      [hashToken(token)],
    );
}
export async function refreshOn(
  db: Sql,
  token: string,
  refresh: (
    s: StoredSession,
    t: Tokens,
  ) => Promise<{ tokens: Tokens; expiresIn: number }>,
) {
  const hash = hashToken(token);
  const session = (
    await db.query<StoredSession>(
      "select * from ns.sessions where token_hash=$1 and revoked_at is null and expires_at>now() for update",
      [hash],
    )
  ).rows[0];
  if (!session) throw new AccessError(401, "session_expired");
  if (new Date(session.token_expires_at).getTime() > Date.now() + 60000) return;
  const tokens = unseal<Tokens>(session.encrypted_tokens, hash);
  if (!tokens.refresh_token) {
    await revokeSession(db, token);
    return false;
  }
  try {
    const next = await refresh(session, tokens);
    if (
      next.tokens.subject !== tokens.subject ||
      !Number.isFinite(next.expiresIn) ||
      next.expiresIn <= 0
    )
      throw Error();
    await db.query(
      "update ns.sessions set encrypted_tokens=$2,token_expires_at=$3 where token_hash=$1",
      [
        hash,
        seal(next.tokens, hash),
        new Date(Date.now() + next.expiresIn * 1000),
      ],
    );
    return true;
  } catch {
    await revokeSession(db, token);
    return false;
  }
}
export async function ensureFresh(token: unknown) {
  if (!validToken(token)) throw new AccessError(401, "sign_in_required");
  const result = await transaction("auth", (db) =>
    refreshOn(db, token, async (session, tokens) => {
      if (session.provider === "shopify") {
        const config = await shopifyOidc();
        const next = await oidc.refreshTokenGrant(
          config,
          tokens.refresh_token!,
        );
        const claims = next.claims();
        if (claims && claims.sub !== tokens.subject) throw Error();
        return {
          tokens: {
            access_token: next.access_token,
            refresh_token: next.refresh_token || tokens.refresh_token,
            id_token: next.id_token || tokens.id_token,
            subject: tokens.subject,
          },
          expiresIn: next.expires_in!,
        };
      }
      const client = supabase();
      const { data, error } = await client.auth.refreshSession({
        refresh_token: tokens.refresh_token!,
      });
      if (error || !data.session) throw Error();
      const verified = await client.auth.getUser(data.session.access_token);
      if (verified.error || verified.data.user?.id !== tokens.subject)
        throw Error();
      return {
        tokens: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          subject: tokens.subject,
        },
        expiresIn: data.session.expires_in,
      };
    }),
  );
  if (result === false) throw new AccessError(401, "sign_in_again");
}
