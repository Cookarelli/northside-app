import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Sql } from "../db";
import {
  AccessError,
  hashToken,
  opaqueToken,
  seal,
  unseal,
  validToken,
} from "../security";
import { TENANT } from "../providers";
import {
  createSession,
  establishCustomer,
  type StoredSession,
  type Tokens,
} from "../sessions";
import {
  MOBILE_CONTRACT_VERSION,
  mobileSessionSchema,
  type MobileExchangeRequest,
  type MobileIntentRequest,
  type MobileSession,
} from "../../../../../packages/customer-contracts/src/mobile";
import type { MobileConfiguration } from "./config";

export const INTENT_TTL = 300_000;
export const HANDOFF_TTL = 60_000;
export const ACCESS_TTL = 600_000;
type Intent = MobileIntentRequest &
  MobileConfiguration & { intentId: string; expiresAt: string };
export type BrowserAttempt = Intent & {
  state: string;
  nonce: string;
  verifier: string;
};
export type NativeParent = {
  familyId: string;
  parentToken: string;
  parentHash: string;
  customerId: string;
  expiresAt: string;
  variant: MobileConfiguration["variant"];
  origin: string;
  used: boolean;
};
type CredentialRow = {
  family_id: string;
  parent_hash: string;
  encrypted_parent: string;
  customer_id: string;
  tenant_id: string;
  variant: MobileConfiguration["variant"];
  api_origin: string;
  expires_at: string | Date;
  used_at: string | Date | null;
  credential_expires_at: string | Date;
  revoked_at: string | Date | null;
  parent: StoredSession & { revoked_at: string | null };
};
const iso = (value: string | Date | number) => new Date(value).toISOString();
const fail = (code = "unauthorized"): never => {
  throw new AccessError(401, code);
};
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function cleanupOn(db: Sql) {
  // Expired or abandoned native-only parents are revoked; financial/customer rows are untouched.
  const expired = (
    await db.query<{ family_id: string }>(
      `select f.family_id from ns.mobile_families f where f.revoked_at is null and (f.expires_at<=now() or (not exists(select 1 from ns.mobile_credentials c where c.family_id=f.family_id) and not exists(select 1 from ns.mobile_handoffs h where h.family_id=f.family_id and h.used_at is null and h.expires_at>now()))) order by f.expires_at limit 100 for update`,
    )
  ).rows;
  for (const row of expired) await revokeFamilyOn(db, row.family_id);
  await db.query(
    "delete from ns.mobile_intents where id_hash in(select id_hash from ns.mobile_intents where expires_at<=now() order by expires_at limit 100)",
  );
  await db.query(
    "delete from ns.mobile_credentials where token_hash in(select c.token_hash from ns.mobile_credentials c join ns.mobile_families f on f.family_id=c.family_id where f.expires_at<=now() or (c.kind='access' and c.expires_at<=now()) order by c.expires_at limit 500)",
  );
}

export async function createIntentOn(
  db: Sql,
  input: MobileIntentRequest,
  config: MobileConfiguration,
) {
  await db.query(
    "select pg_advisory_xact_lock(hashtext('northside.mobile.intent.rate'))",
  );
  await cleanupOn(db);
  const count = (
    await db.query<{ count: string }>(
      "select count(*)::text as count from ns.mobile_intents where created_at>now()-interval '1 minute'",
    )
  ).rows[0];
  if (Number(count?.count) >= 120) throw new AccessError(429, "rate_limited");
  const intentId = opaqueToken(),
    hash = hashToken(intentId),
    expiresAt = iso(Date.now() + INTENT_TTL);
  const payload: Intent = { ...input, ...config, intentId, expiresAt };
  await db.query(
    "insert into ns.mobile_intents(id_hash,encrypted_payload,expires_at) values($1,$2,$3)",
    [hash, seal(payload, `northside.mobile.intent:${hash}`), expiresAt],
  );
  return {
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "auth-intent" as const,
    intentId,
    startUrl: `${config.origin}/api/mobile/v1/auth/start?intent=${intentId}`,
    expiresAt,
  };
}

export async function startIntentOn(
  db: Sql,
  intentId: string,
  provider: { state: string; nonce: string; verifier: string },
) {
  if (!validToken(intentId)) return fail("invalid_callback");
  const hash = hashToken(intentId);
  const row = (
    await db.query<{ encrypted_payload: string }>(
      "update ns.mobile_intents set started_at=now() where id_hash=$1 and expires_at>now() and started_at is null returning encrypted_payload",
      [hash],
    )
  ).rows[0];
  if (!row) return fail("invalid_callback");
  const intent = unseal<Intent>(
    row.encrypted_payload,
    `northside.mobile.intent:${hash}`,
  );
  const cookie = opaqueToken(),
    cookieHash = hashToken(cookie);
  const attempt: BrowserAttempt = { ...intent, ...provider };
  await db.query(
    "insert into ns.mobile_attempts(token_hash,intent_hash,encrypted_payload,expires_at) values($1,$2,$3,$4)",
    [
      cookieHash,
      hash,
      seal(attempt, `northside.mobile.attempt:${cookieHash}`),
      intent.expiresAt,
    ],
  );
  return { cookie, attempt };
}

export async function consumeAttemptOn(db: Sql, cookie: string) {
  if (!validToken(cookie)) return fail("invalid_callback");
  const hash = hashToken(cookie);
  const row = (
    await db.query<{ encrypted_payload: string }>(
      "delete from ns.mobile_attempts where token_hash=$1 and expires_at>now() returning encrypted_payload",
      [hash],
    )
  ).rows[0];
  if (!row) return fail("invalid_callback");
  return unseal<BrowserAttempt>(
    row.encrypted_payload,
    `northside.mobile.attempt:${hash}`,
  );
}

export async function completeLoginOn(
  db: Sql,
  attempt: BrowserAttempt,
  subject: string,
  tokens: Tokens,
  expiresIn: number,
) {
  if (
    Date.parse(attempt.expiresAt) <= Date.now() ||
    tokens.subject !== subject ||
    expiresIn <= 60
  )
    return fail("invalid_callback");
  const customerId = await establishCustomer(db, subject);
  const parentToken = await createSession(
    db,
    { customerId },
    "shopify",
    tokens,
    expiresIn,
  );
  const parentHash = hashToken(parentToken);
  const parent = (
    await db.query<StoredSession>(
      "select * from ns.sessions where token_hash=$1",
      [parentHash],
    )
  ).rows[0];
  const familyId = randomUUID(),
    ticket = opaqueToken(),
    now = Date.now();
  await db.query(
    "insert into ns.mobile_families(family_id,tenant_id,customer_id,parent_hash,encrypted_parent,variant,api_origin,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      familyId,
      TENANT,
      customerId,
      parentHash,
      seal({ parentToken }, `northside.mobile.parent:${familyId}`),
      attempt.variant,
      attempt.origin,
      parent.expires_at,
    ],
  );
  await db.query(
    "insert into ns.mobile_handoffs(token_hash,intent_hash,family_id,challenge,app_state,expires_at) values($1,$2,$3,$4,$5,$6)",
    [
      hashToken(ticket),
      hashToken(attempt.intentId),
      familyId,
      attempt.challenge,
      attempt.appState,
      iso(Math.min(now + HANDOFF_TTL, new Date(parent.expires_at).getTime())),
    ],
  );
  const target = new URL(attempt.returnUri);
  target.searchParams.set("ticket", ticket);
  target.searchParams.set("intent", attempt.intentId);
  target.searchParams.set("state", attempt.appState);
  return target.toString();
}

export async function loadCredentialOn(
  db: Sql,
  token: string,
  kind: "access" | "renewal",
  options: {
    lock?: boolean;
    allowSpent?: boolean;
    allowExpiredCredential?: boolean;
  } = {},
): Promise<NativeParent> {
  if (!validToken(token)) return fail();
  const row = (
    await db.query<CredentialRow>(
      `select f.*,c.used_at,c.expires_at as credential_expires_at,row_to_json(s) as parent from ns.mobile_credentials c join ns.mobile_families f on f.family_id=c.family_id join ns.sessions s on s.token_hash=f.parent_hash where c.token_hash=$1 and c.kind=$2 ${options.lock ? "for update of f,c,s" : ""}`,
      [hashToken(token), kind],
    )
  ).rows[0];
  if (
    !row ||
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    (!options.allowSpent && row.used_at) ||
    (!options.allowExpiredCredential &&
      new Date(row.credential_expires_at).getTime() <= Date.now())
  )
    return fail("session_expired");
  const p = row.parent;
  if (
    p.revoked_at ||
    p.tenant_id !== TENANT ||
    row.tenant_id !== TENANT ||
    p.customer_id !== row.customer_id ||
    !p.customer_id ||
    p.staff_id !== null ||
    p.provider !== "shopify" ||
    new Date(p.expires_at).getTime() <= Date.now() ||
    new Date(row.expires_at).getTime() > new Date(p.expires_at).getTime()
  )
    return fail();
  const payload = unseal<{ parentToken: string }>(
    row.encrypted_parent,
    `northside.mobile.parent:${row.family_id}`,
  );
  if (
    !validToken(payload.parentToken) ||
    !equal(hashToken(payload.parentToken), row.parent_hash)
  )
    return fail();
  return {
    familyId: row.family_id,
    parentToken: payload.parentToken,
    parentHash: row.parent_hash,
    customerId: row.customer_id,
    expiresAt: iso(row.expires_at),
    variant: row.variant,
    origin: row.api_origin,
    used: row.used_at !== null,
  };
}

async function issueOn(db: Sql, parent: NativeParent): Promise<MobileSession> {
  const current = (
    await db.query<StoredSession & { revoked_at: string | null }>(
      "select * from ns.sessions where token_hash=$1 and revoked_at is null and expires_at>now() and token_expires_at>now()",
      [parent.parentHash],
    )
  ).rows[0];
  if (
    !current ||
    current.tenant_id !== TENANT ||
    current.customer_id !== parent.customerId ||
    current.staff_id !== null ||
    current.provider !== "shopify"
  )
    return fail("reauthentication_required");
  const tokens = unseal<Tokens>(current.encrypted_tokens, parent.parentHash);
  const accessToken = opaqueToken(),
    renewalToken = opaqueToken(),
    expiry = iso(
      Math.min(Date.now() + ACCESS_TTL, Date.parse(parent.expiresAt)),
    );
  await db.query(
    "insert into ns.mobile_credentials(token_hash,family_id,kind,expires_at) values($1,$2,'access',$3),($4,$2,'renewal',$5)",
    [
      hashToken(accessToken),
      parent.familyId,
      expiry,
      hashToken(renewalToken),
      parent.expiresAt,
    ],
  );
  return mobileSessionSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "session",
    accessToken,
    renewalToken,
    accessExpiresAt: expiry,
    absoluteExpiresAt: parent.expiresAt,
    customerId: parent.customerId,
    providerRenewal: tokens.refresh_token
      ? "refresh_available"
      : "browser_reauthentication",
  });
}

export async function exchangeOn(
  db: Sql,
  input: MobileExchangeRequest,
  verifyRealm?: (realm: {
    variant: MobileConfiguration["variant"];
    origin: string;
  }) => void,
) {
  const row = (
    await db.query<{
      family_id: string;
      challenge: string;
      app_state: string;
      used_at: string | null;
      expires_at: string | Date;
    }>(
      "select * from ns.mobile_handoffs where token_hash=$1 and intent_hash=$2 for update",
      [hashToken(input.ticket), hashToken(input.intentId)],
    )
  ).rows[0];
  const challenge = createHash("sha256")
    .update(input.verifier)
    .digest("base64url");
  if (
    !row ||
    row.used_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    !equal(challenge, row.challenge) ||
    !equal(input.appState, row.app_state)
  )
    return fail("invalid_exchange");
  const family = (
    await db.query<{
      tenant_id: string;
      parent_hash: string;
      encrypted_parent: string;
      customer_id: string;
      variant: MobileConfiguration["variant"];
      api_origin: string;
      expires_at: Date | string;
      revoked_at: string | null;
    }>("select * from ns.mobile_families where family_id=$1 for update", [
      row.family_id,
    ])
  ).rows[0];
  if (
    !family ||
    family.tenant_id !== TENANT ||
    family.revoked_at ||
    new Date(family.expires_at).getTime() <= Date.now()
  )
    return fail("invalid_exchange");
  verifyRealm?.({ variant: family.variant, origin: family.api_origin });
  const parentToken = unseal<{ parentToken: string }>(
    family.encrypted_parent,
    `northside.mobile.parent:${row.family_id}`,
  ).parentToken;
  if (!validToken(parentToken) || hashToken(parentToken) !== family.parent_hash)
    return fail("invalid_exchange");
  const parentRow = (
    await db.query<StoredSession & { revoked_at: string | null }>(
      "select * from ns.sessions where token_hash=$1",
      [family.parent_hash],
    )
  ).rows[0];
  if (
    !parentRow ||
    parentRow.revoked_at ||
    parentRow.provider !== "shopify" ||
    parentRow.staff_id !== null ||
    parentRow.customer_id !== family.customer_id ||
    parentRow.tenant_id !== TENANT ||
    new Date(parentRow.expires_at).getTime() <
      new Date(family.expires_at).getTime()
  )
    return fail("invalid_exchange");
  await db.query(
    "update ns.mobile_handoffs set used_at=now() where token_hash=$1",
    [hashToken(input.ticket)],
  );
  return issueOn(db, {
    familyId: row.family_id,
    parentToken,
    parentHash: family.parent_hash,
    customerId: family.customer_id,
    expiresAt: iso(family.expires_at),
    variant: family.variant,
    origin: family.api_origin,
    used: false,
  });
}

export async function revokeFamilyOn(db: Sql, familyId: string) {
  await db.query(
    "update ns.sessions set revoked_at=coalesce(revoked_at,now()),encrypted_tokens='revoked' where token_hash in(select parent_hash from ns.mobile_families where family_id=$1)",
    [familyId],
  );
  await db.query(
    "update ns.mobile_families set revoked_at=coalesce(revoked_at,now()),encrypted_parent='revoked' where family_id=$1",
    [familyId],
  );
  await db.query(
    "update ns.mobile_credentials set used_at=coalesce(used_at,now()) where family_id=$1",
    [familyId],
  );
}

export async function rotateOn(
  db: Sql,
  token: string,
): Promise<MobileSession | { replayed: true }> {
  const parent = await loadCredentialOn(db, token, "renewal", {
    lock: true,
    allowSpent: true,
  });
  if (parent.used) {
    await revokeFamilyOn(db, parent.familyId);
    return { replayed: true };
  }
  await db.query(
    "update ns.mobile_credentials set used_at=now() where family_id=$1 and used_at is null and (kind='access' or token_hash=$2)",
    [parent.familyId, hashToken(token)],
  );
  return issueOn(db, parent);
}

export async function logoutOn(db: Sql, token: string) {
  if (!validToken(token)) return fail();
  const row = (
    await db.query<{ family_id: string }>(
      "select family_id from ns.mobile_credentials where token_hash=$1",
      [hashToken(token)],
    )
  ).rows[0];
  if (row) await revokeFamilyOn(db, row.family_id);
  return {
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "logout" as const,
    revoked: true as const,
    providerLogout: "not_performed" as const,
  };
}
