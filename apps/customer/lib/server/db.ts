import "server-only";
import { Pool } from "pg";
import { AccessError, hashToken, validToken } from "./security";
export type Sql = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export type Actor = {
  tenant_id: string;
  customer_id: string | null;
  staff_id: string | null;
  staff_role:
    "owner" | "admin" | "operations" | "content_editor" | "read_only" | null;
};
type DatabaseKind = "runtime" | "auth" | "commerce" | "loyalty" | "engagement";
const pools: Partial<Record<DatabaseKind, Pool>> = {};
function pool(kind: DatabaseKind) {
  const value =
    process.env[
      kind === "engagement"
        ? "ENGAGEMENT_DATABASE_URL"
        : kind === "runtime"
          ? "DATABASE_URL"
          : kind === "auth"
            ? "AUTH_DATABASE_URL"
            : kind === "loyalty"
              ? "LOYALTY_DATABASE_URL"
              : "COMMERCE_DATABASE_URL"
    ];
  if (!value) throw new AccessError(503, "database_not_configured");
  return (pools[kind] ??= new Pool({
    connectionString: value,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  }));
}
export async function transaction<T>(
  kind: DatabaseKind,
  fn: (db: Sql) => Promise<T>,
) {
  const client = await pool(kind).connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      "select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname=current_user",
    );
    if (
      rows[0]?.name !== `northside_${kind}` ||
      rows[0]?.rolsuper ||
      rows[0]?.rolbypassrls
    )
      throw new AccessError(503, "unsafe_database_role");
    await client.query("set local statement_timeout='8s'");
    const result = await fn(client as Sql);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
export async function authorizeOn(db: Sql, token: unknown): Promise<Actor> {
  if (!validToken(token)) throw new AccessError(401, "sign_in_required");
  await db.query("select set_config('ns.session_hash',$1,true)", [
    hashToken(token),
  ]);
  const { rows } = await db.query<Actor>("select * from ns.context()");
  if (!rows[0]) throw new AccessError(401, "session_expired");
  return rows[0];
}
export async function withSession<T>(
  token: unknown,
  fn: (db: Sql, actor: Actor) => Promise<T>,
) {
  return transaction("runtime", async (db) =>
    fn(db, await authorizeOn(db, token)),
  );
}
export function requireRole(
  actor: Actor,
  roles: NonNullable<Actor["staff_role"]>[],
) {
  if (!actor.staff_role || !roles.includes(actor.staff_role))
    throw new AccessError(403, "staff_permission_required");
}
export function requireCustomer(actor: Actor) {
  if (!actor.customer_id)
    throw new AccessError(403, "customer_account_required");
}
