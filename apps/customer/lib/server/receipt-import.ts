import "server-only";
import { transaction, type Sql } from "./db";
import { SHOP, TENANT } from "./providers";
import { TESTED_API_VERSION } from "./shopify-config";
import { AccessError } from "./security";
import { receiveOn } from "./order-jobs";

// Only a trusted, restricted SQL reader can supply quarantine metadata. There is
// deliberately no HTTP endpoint accepting a browser-supplied receipt or order.
export async function importReceiptOn(db: Sql, delivery: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      delivery,
    )
  )
    throw new AccessError(400, "invalid_delivery_id");
  const receipt = (
    await db.query<{
      shop: string;
      delivery_id: string;
      topic: string;
      order_id: string;
      api_version: string;
      body_hash: string;
      is_test: boolean;
    }>(
      "select shop,delivery_id,topic,order_id,api_version,body_hash,is_test from ns_webhook_pilot.receipts where shop=$1 and delivery_id=$2",
      [SHOP, delivery],
    )
  ).rows[0];
  if (
    !receipt ||
    receipt.shop !== SHOP ||
    receipt.delivery_id !== delivery ||
    receipt.api_version !== TESTED_API_VERSION ||
    receipt.is_test !== false ||
    !/^[a-f0-9]{64}$/.test(receipt.body_hash) ||
    !/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,24}$/.test(receipt.order_id) ||
    ![
      "orders/paid",
      "orders/updated",
      "orders/cancelled",
      "refunds/create",
    ].includes(receipt.topic)
  )
    throw new AccessError(409, "eligible_quarantine_receipt_required");
  // This queues a fresh Admin read, never a paid snapshot from receipt metadata.
  return receiveOn(db, {
    delivery,
    topic: receipt.topic,
    orderId: receipt.order_id,
    bodyHash: receipt.body_hash,
    apiVersion: TESTED_API_VERSION,
  });
}

export async function importPilotReceipts(limit = 10) {
  if (process.env.NORTHSIDE_ORDER_PROCESSOR_MODE !== "reconcile-only")
    return { imported: 0, disabled: true };
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new AccessError(400, "invalid_job_limit");
  return transaction("commerce", async (db) => {
    const rows = (
      await db.query<{ delivery_id: string }>(
        `select p.delivery_id from ns_webhook_pilot.receipts p
       where p.shop=$1 and p.is_test=false and not exists(
         select 1 from ns.webhook_receipts r where r.tenant_id=$2
         and r.provider='shopify' and r.source_id=p.delivery_id::text)
       order by p.received_at,p.delivery_id limit $3`,
        [SHOP, TENANT, limit],
      )
    ).rows;
    let imported = 0;
    for (const row of rows) {
      if (!(await importReceiptOn(db, row.delivery_id)).duplicate) imported++;
    }
    return { imported, disabled: false };
  });
}
