import "server-only";
import type { Sql } from "../db";
import { transaction } from "../db";
import { TENANT } from "../providers";
import { AccessError } from "../security";
import { nativeParent } from "./service";
import { revokeFamilyOn, type NativeParent } from "./store";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import { mobileDeletionSchema } from "../../../../../packages/customer-contracts/src/mvp";

export async function privacyStatusOn(db: Sql, customerId: string) {
  const row = (
    await db.query<{ id: string; status: string; created_at: Date | string }>(
      "select id,status,created_at from ns.mobile_privacy_requests where tenant_id=$1 and customer_id=$2 order by created_at desc,id desc limit 1",
      [TENANT, customerId],
    )
  ).rows[0];
  return mobileDeletionSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "deletion-request",
    request: row
      ? {
          id: row.id,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
        }
      : null,
  });
}
export async function privacyRequestOn(db: Sql, parent: NativeParent) {
  const family = (
    await db.query<{ family_id: string }>(
      "select family_id from ns.mobile_families where family_id=$1 and customer_id=$2 and tenant_id=$3 and revoked_at is null and expires_at>now() and created_at>now()-interval '15 minutes' for update",
      [parent.familyId, parent.customerId, TENANT],
    )
  ).rows[0];
  if (!family) throw new AccessError(401, "reauthentication_required");
  await db.query(
    "insert into ns.mobile_privacy_requests(tenant_id,customer_id) values($1,$2) on conflict(tenant_id,customer_id) where status in('requested','processing') do nothing",
    [TENANT, parent.customerId],
  );
  const result = await privacyStatusOn(db, parent.customerId);
  await revokeFamilyOn(db, parent.familyId);
  return result;
}
export async function customerPrivacy(token: string, submit = false) {
  const context = await nativeParent(token);
  return transaction("auth", (db) =>
    submit
      ? privacyRequestOn(db, context.parent)
      : privacyStatusOn(db, context.parent.customerId),
  );
}
