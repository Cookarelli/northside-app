import "server-only";
import * as oidc from "openid-client";
import { transaction, withSession, type Actor } from "../db";
import { ensureFresh, type Tokens, type StoredSession } from "../sessions";
import { AccessError, unseal } from "../security";
import { TENANT, shopifyOidc } from "../providers";
import { shopifyAuthorizationCodeGrant } from "../shopify-tokens";
import {
  bindCustomer,
  customerAccount,
  customerQuery,
} from "../customer-commerce";
import { projectNativeAccount, projectNativeOrders } from "./projection";
import { consignmentItems, consignmentDetail } from "../consignment";
import { mobileConfiguration } from "./config";
import {
  createIntentOn,
  startIntentOn,
  consumeAttemptOn,
  completeLoginOn,
  exchangeOn,
  loadCredentialOn,
  rotateOn,
  logoutOn,
  revokeFamilyOn,
  type NativeParent,
} from "./store";
import {
  MOBILE_CONTRACT_VERSION,
  mobileServicesSchema,
  type MobileIntentRequest,
  type MobileExchangeRequest,
} from "../../../../../packages/customer-contracts/src/mobile";

export const MOBILE_ATTEMPT_COOKIE = "__Host-ns_mobile_oauth";

export async function createMobileIntent(input: MobileIntentRequest) {
  const config = mobileConfiguration(input.variant);
  return transaction("auth", (db) => createIntentOn(db, input, config));
}
export async function startMobileIntent(intent: string) {
  const config = await shopifyOidc();
  const provider = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    verifier: oidc.randomPKCECodeVerifier(),
  };
  const result = await transaction("auth", (db) =>
    startIntentOn(db, intent, provider),
  );
  // Re-read operator allowlist so a withdrawn return URI cannot remain usable.
  const current = mobileConfiguration(result.attempt.variant);
  if (
    current.returnUri !== result.attempt.returnUri ||
    current.callbackUri !== result.attempt.callbackUri
  )
    throw new AccessError(401, "invalid_callback");
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: current.callbackUri,
    scope: "openid email customer-account-api:full",
    state: provider.state,
    nonce: provider.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(provider.verifier),
    code_challenge_method: "S256",
  });
  return { cookie: result.cookie, url: url.toString() };
}
export async function completeMobileCallback(cookie: string, incoming: URL) {
  const attempt = await transaction("auth", (db) =>
    consumeAttemptOn(db, cookie),
  );
  const current = mobileConfiguration(attempt.variant);
  if (
    current.returnUri !== attempt.returnUri ||
    current.callbackUri !== attempt.callbackUri
  )
    throw new AccessError(401, "invalid_callback");
  const callback = new URL(current.callbackUri);
  callback.search = incoming.search;
  // Never forward provider error descriptions or unverified state into the app.
  if (
    callback.searchParams.get("error") === "access_denied" &&
    callback.searchParams.getAll("state").length === 1 &&
    callback.searchParams.get("state") === attempt.state
  ) {
    const target = new URL(current.returnUri);
    target.searchParams.set("error", "cancelled");
    target.searchParams.set("intent", attempt.intentId);
    target.searchParams.set("state", attempt.appState);
    return target.toString();
  }
  const config = await shopifyOidc();
  const tokens = await shopifyAuthorizationCodeGrant(config, callback, {
    expectedState: attempt.state,
    expectedNonce: attempt.nonce,
    pkceCodeVerifier: attempt.verifier,
    idTokenExpected: true,
  }).catch(() => {
    throw new AccessError(401, "invalid_callback");
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new AccessError(401, "invalid_callback");
  return transaction("auth", (db) =>
    completeLoginOn(
      db,
      attempt,
      claims.sub,
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        subject: claims.sub,
      },
      tokens.expires_in!,
    ),
  );
}
function verifyRealm(realm: {
  variant: MobileIntentRequest["variant"];
  origin: string;
}) {
  if (mobileConfiguration(realm.variant).origin !== realm.origin)
    throw new AccessError(401, "unauthorized");
}
export function exchangeMobile(input: MobileExchangeRequest) {
  return transaction("auth", (db) => exchangeOn(db, input, verifyRealm));
}
export async function renewMobile(token: string) {
  const candidate = await transaction("auth", (db) =>
    loadCredentialOn(db, token, "renewal", { allowSpent: true }),
  );
  verifyRealm(candidate);
  if (!candidate.used) {
    verifyRealm(candidate);
    try {
      await ensureFresh(candidate.parentToken);
    } catch {
      await transaction("auth", (db) => revokeFamilyOn(db, candidate.familyId));
      throw new AccessError(401, "reauthentication_required");
    }
  }
  const result = await transaction("auth", (db) => rotateOn(db, token));
  // Replay revocation has committed; throwing inside transaction would undo it.
  if ("replayed" in result) throw new AccessError(401, "renewal_replayed");
  return result;
}
export function logoutMobile(token: string) {
  return transaction("auth", (db) => logoutOn(db, token));
}

export async function nativeParent(
  token: string,
): Promise<{ parent: NativeParent; actor: Actor; providerTokens: Tokens }> {
  const candidate = await transaction("auth", (db) =>
    loadCredentialOn(db, token, "access"),
  );
  verifyRealm(candidate);
  try {
    await ensureFresh(candidate.parentToken);
  } catch {
    await transaction("auth", (db) => revokeFamilyOn(db, candidate.familyId));
    throw new AccessError(401, "reauthentication_required");
  }
  const parent = await transaction("auth", (db) =>
    loadCredentialOn(db, token, "access"),
  );
  const actor = await withSession(parent.parentToken, async (_db, a) => {
    if (
      a.tenant_id !== TENANT ||
      a.customer_id !== parent.customerId ||
      a.staff_id !== null ||
      a.staff_role !== null
    )
      throw new AccessError(401, "unauthorized");
    return a;
  });
  const providerTokens = await transaction("auth", async (db) => {
    const row = (
      await db.query<StoredSession>(
        "select * from ns.sessions where token_hash=$1 and provider='shopify' and customer_id=$2 and staff_id is null and revoked_at is null and expires_at>now() and token_expires_at>now()",
        [parent.parentHash, parent.customerId],
      )
    ).rows[0];
    if (!row) throw new AccessError(401, "session_expired");
    return unseal<Tokens>(row.encrypted_tokens, parent.parentHash);
  });
  return { parent, actor, providerTokens };
}

export async function readNativeAccount(
  token: string,
  orders: boolean,
  after?: string,
) {
  const context = await nativeParent(token);
  const customer = await customerAccount(
    await customerQuery(context.providerTokens.access_token),
    after,
  );
  await transaction("auth", (db) =>
    bindCustomer(db, context.actor, customer.id),
  );
  if (orders) return projectNativeOrders(customer);
  return projectNativeAccount(
    customer,
    context.parent.customerId,
    context.parent.expiresAt,
  );
}

export async function readNativeServices(
  token: string,
  kind: "cards" | "consignments",
  id?: string,
) {
  const context = await nativeParent(token);
  const items = await withSession(context.parent.parentToken, async (db, a) => {
    if (
      a.customer_id !== context.actor.customer_id ||
      a.staff_id !== null ||
      a.staff_role !== null
    )
      throw new AccessError(401, "unauthorized");
    if (kind === "cards") {
      const { portalData } = await import("../grading-portal");
      const rows = (await portalData(db, a, id)).cards;
      return rows.map((c) => ({
        id: c.card_id,
        kind: "grading" as const,
        title: c.description,
        status: c.label,
      }));
    }
    const rows = id
      ? [(await consignmentDetail(db, a, id)).item]
      : await consignmentItems(db, a);
    return rows.map((c) => ({
      id: c.id,
      kind: "consignment" as const,
      title: c.description,
      status: c.state_key,
    }));
  });
  return mobileServicesSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "services",
    items,
  });
}
