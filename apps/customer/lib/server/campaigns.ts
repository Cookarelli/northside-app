import "server-only";
import { cookies } from "next/headers";
import { type Sql, transaction } from "./db";
import { TENANT } from "./providers";
import { AccessError, hashToken, validToken } from "./security";
export const CAMPAIGN_COOKIE = "__Host-ns_campaign";
export async function recordTouch(
  db: Sql,
  token: string,
  ref: unknown,
  consent: boolean,
) {
  if (
    !validToken(token) ||
    typeof ref !== "string" ||
    !/^[A-Za-z0-9_-]{22,64}$/.test(ref) ||
    !consent
  )
    throw new AccessError(400, "eligible_campaign_consent_required");
  const enabled = (
    await db.query(
      "select ref from ns.campaign_refs where tenant_id=$1 and ref=$2 and enabled=true",
      [TENANT, ref],
    )
  ).rows[0];
  if (!enabled) throw new AccessError(404, "campaign_unavailable");
  await db.query(
    `insert into ns.campaign_touches(token_hash,tenant_id,first_ref,last_ref,consent) values($1,$2,$3,$3,true)
    on conflict(token_hash) do update set first_ref=case when campaign_touches.expires_at<=now() then excluded.first_ref else campaign_touches.first_ref end,
    first_at=case when campaign_touches.expires_at<=now() then now() else campaign_touches.first_at end,
    last_ref=excluded.last_ref,last_at=now(),expires_at=now()+interval '30 days'`,
    [hashToken(token), TENANT, ref],
  );
}
export async function eligibleTouches() {
  const token = (await cookies()).get(CAMPAIGN_COOKIE)?.value;
  if (!validToken(token)) return null;
  return transaction(
    "commerce",
    async (db) =>
      (
        await db.query<{ first_ref: string; last_ref: string }>(
          `select t.first_ref,t.last_ref from ns.campaign_touches t
    join ns.campaign_refs f on f.tenant_id=t.tenant_id and f.ref=t.first_ref and f.enabled
    join ns.campaign_refs l on l.tenant_id=t.tenant_id and l.ref=t.last_ref and l.enabled
    where t.tenant_id=$1 and t.token_hash=$2 and t.expires_at>now() and t.consent`,
          [TENANT, hashToken(token)],
        )
      ).rows[0] || null,
  );
}
