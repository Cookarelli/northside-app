import "server-only";
import { readFile } from "node:fs/promises";
import {
  previewDatabase,
  previewActor,
  previewId,
  openPreviewDatabase,
} from "./grading-preview";
import { saveBreak, addMapping } from "./breaks";
import { reconcileBreakOrder } from "./break-purchases";
import type { Sql } from "./db";
import { TENANT, SHOP } from "./providers";
import type { LoyaltyOrder } from "../loyalty";
import { AccessError } from "./security";
type Database = Awaited<ReturnType<typeof openPreviewDatabase>>;
export const breakSampleWorker = <T>(
  f: Database,
  fn: (db: Sql) => Promise<T>,
) =>
  f.db.transaction(async (tx) => {
    await tx.exec("set local role northside_commerce");
    return fn(tx as unknown as Sql);
  });
export const sampleBreakId = previewId(7001);
export function sampleOrder(
  n = 1,
  variant = "gid://shopify/ProductVariant/7001",
): LoyaltyOrder {
  const at = new Date().toISOString();
  return {
    id: `gid://shopify/Order/${770000 + n}`,
    customerId: `gid://shopify/Customer/${n}`,
    createdAt: at,
    updatedAt: at,
    paidAt: at,
    financialStatus: "PAID",
    cancelled: false,
    currency: "USD",
    channel: "sample",
    lines: [
      {
        id: `gid://shopify/LineItem/${770000 + n}`,
        productId: "gid://shopify/Product/7001",
        variantId: variant,
        isGiftCard: false,
        quantity: 1,
        currentQuantity: 1,
        originalNetCents: 2500,
        refundedCents: 0,
        refundedQuantity: 0,
      },
    ],
    ambiguousRefund: false,
    discounts: [],
    campaignRef: null,
  };
}
export async function initializeBreakPreview(f: Database) {
  if (
    !(
      await f.db.query<{ name: string | null }>(
        "select to_regclass('ns.break_jobs')::text name",
      )
    ).rows[0].name
  )
    await f.db.exec(
      await readFile("supabase/migrations/202609120007_breaks.sql", "utf8"),
    );
  for (const n of [1, 2])
    await f.db.query(
      "insert into ns.shopify_customers(tenant_id,customer_id,shop,shopify_id) values($1,$2,$3,$4) on conflict do nothing",
      [TENANT, previewId(n), SHOP, `gid://shopify/Customer/${n}`],
    );
  if (
    !(
      await f.db.query("select id from ns.break_events where id=$1", [
        sampleBreakId,
      ])
    ).rows.length
  )
    await f.run("staff", async (db, a) => {
      await saveBreak(
        db,
        a,
        {
          title: "SAMPLE Northside card break",
          products: ["SAMPLE basketball card box — fictional product"],
          starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
          status: "scheduled",
          host: "Sample Northside host",
          description:
            "A fictional break for trying the schedule, calendar and saved reminders. No real event or purchase is offered.",
          image_url: "/samples/break-cards.svg",
          format: "named",
          capacity: 2,
          terms:
            "SAMPLE terms: two named spots, one owner per spot. Physical cards would follow confirmed shipping terms. No random assignment, guaranteed hit or live sale is represented.",
          stream_url: null,
          replay_url: null,
          duration_minutes: 120,
          published: true,
        },
        sampleBreakId,
        null,
        "Initial clearly labeled local break",
        "sample",
      );
      for (const n of [1, 2])
        await addMapping(
          db,
          a,
          sampleBreakId,
          {
            variant_id: `gid://shopify/ProductVariant/${7000 + n}`,
            product_id: "gid://shopify/Product/7001",
            sku: `SAMPLE-BREAK-${n}`,
            spot_key: n === 1 ? "SAMPLE North spot" : "SAMPLE South spot",
            capacity: 1,
          },
          "Fictional mapping only; no Shopify product changed",
        );
    });
}
const globalState = globalThis as unknown as {
  northsideBreaksReady?: Promise<void>;
};
export async function breaksPreview(request: Request) {
  const who = previewActor(request),
    f = await previewDatabase();
  globalState.northsideBreaksReady ??= initializeBreakPreview(f);
  await globalState.northsideBreaksReady;
  return { who, f };
}
export async function simulateBreak(
  request: Request,
  action: string,
  customer: number,
) {
  const { who, f } = await breaksPreview(request);
  if (who !== "staff" || ![1, 2].includes(customer))
    throw new AccessError(403, "sample_staff_required");
  const id = `gid://shopify/Order/${770000 + customer}`;
  const old = (
    await f.db.query<{ snapshot: LoyaltyOrder }>(
      "select snapshot from ns.break_orders where tenant_id=$1 and order_id=$2",
      [TENANT, id],
    )
  ).rows[0]?.snapshot;
  let o = old || sampleOrder(customer);
  if (action === "sample-refund") {
    if (!old) throw new AccessError(409, "simulate_paid_order_first");
    o = {
      ...old,
      updatedAt: new Date(
        Math.max(Date.now(), Date.parse(old.updatedAt) + 1000),
      ).toISOString(),
      financialStatus: "REFUNDED",
      lines: old.lines.map((l) => ({
        ...l,
        currentQuantity: 0,
        refundedQuantity: l.quantity,
        refundedCents: l.originalNetCents,
      })),
    };
  }
  return breakSampleWorker(f, (db) => reconcileBreakOrder(db, o, "sample"));
}
