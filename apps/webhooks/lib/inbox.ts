import { Pool, type PoolConfig } from "pg";
import { ReceiverError, type Receipt } from "./receiver";
export type Sql = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};
export function configuration(
  environment: Record<string, string | undefined> = process.env,
): PoolConfig {
  try {
    const u = new URL(environment.WEBHOOK_DATABASE_URL || "");
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) ||
      decodeURIComponent(u.username) !==
        "northside_webhook_receiver.nrsuosydvjqovrevmych" ||
      !u.password ||
      u.pathname !== "/postgres" ||
      (u.port && u.port !== "5432") ||
      u.hash ||
      u.search !== "?sslmode=verify-full" ||
      !environment.WEBHOOK_DATABASE_CA_CERT?.includes("BEGIN CERTIFICATE")
    )
      throw Error();
    return {
      host: u.hostname,
      port: 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: "postgres",
      ssl: {
        rejectUnauthorized: true,
        ca: environment.WEBHOOK_DATABASE_CA_CERT,
      },
      max: 2,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 5000,
      query_timeout: 1500,
      statement_timeout: 1200,
    };
  } catch {
    throw new ReceiverError(503, "receiver_database_not_configured");
  }
}
export async function receiveOn(db: Sql, receipt: Receipt) {
  const values = [
    receipt.shop,
    receipt.delivery,
    receipt.topic,
    receipt.orderId,
    receipt.apiVersion,
    receipt.bodyHash,
    receipt.test,
  ];
  const inserted = await db.query(
    `insert into ns_webhook_pilot.receipts(shop,delivery_id,topic,order_id,api_version,body_hash,is_test)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(shop,delivery_id) do nothing returning delivery_id`,
    values,
  );
  if (inserted.rows.length) return { duplicate: false };
  const prior = (
    await db.query(
      "select topic,order_id,api_version,body_hash,is_test from ns_webhook_pilot.receipts where shop=$1 and delivery_id=$2",
      values.slice(0, 2),
    )
  ).rows[0];
  if (
    !prior ||
    prior.topic !== receipt.topic ||
    prior.order_id !== receipt.orderId ||
    prior.api_version !== receipt.apiVersion ||
    prior.body_hash !== receipt.bodyHash ||
    prior.is_test !== receipt.test
  )
    throw new ReceiverError(409, "delivery_conflict");
  return { duplicate: true };
}
let pool: Pool | undefined;
export async function saveReceipt(receipt: Receipt) {
  pool ??= new Pool(configuration());
  const client = await pool.connect();
  try {
    await client.query("begin");
    const r = (
      await client.query(
        "select current_user as name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit, exists(select 1 from pg_auth_members m where m.member=r.oid) as membership from pg_roles r where rolname=current_user",
      )
    ).rows[0];
    if (
      r?.name !== "northside_webhook_receiver" ||
      r.rolsuper ||
      r.rolbypassrls ||
      r.rolcreaterole ||
      r.rolcreatedb ||
      r.rolreplication ||
      r.rolinherit ||
      r.membership
    )
      throw new ReceiverError(503, "unsafe_receiver_role");
    const result = await receiveOn(client, receipt);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
