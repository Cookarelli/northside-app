import "server-only";
import { readFile } from "node:fs/promises";
import {
  previewDatabase,
  previewActor,
  previewId,
  openPreviewDatabase,
} from "./grading-preview";
import {
  saveAisle,
  saveNode,
  saveEdge,
  saveLocation,
  saveProduct,
  saveVariant,
  assignLocation,
  saveQR,
} from "./store";
import type { Aisle } from "../store";
type Database = Awaited<ReturnType<typeof openPreviewDatabase>>;
export async function initializeStorePreview(f: Database) {
  if (
    !(
      await f.db.query<{ name: string | null }>(
        "select to_regclass('ns.store_qr')::text name",
      )
    ).rows[0].name
  )
    await f.db.exec(
      await readFile("supabase/migrations/202609120008_store.sql", "utf8"),
    );
  if (
    (
      await f.db.query("select id from ns.store_products where id=$1", [
        previewId(8001),
      ])
    ).rows.length
  )
    return;
  await f.run("staff", async (db, a) => {
    const reason =
      "SAMPLE schematic and fictional catalog — no real floor plan or Shopify change";
    const aisles = (
      await db.query<Aisle>("select * from ns.store_aisles order by number")
    ).rows;
    for (const x of aisles)
      await saveAisle(
        db,
        a,
        x.id,
        x.version,
        {
          ...x,
          sides: ["Left", "Right"],
          categories: ["SAMPLE cards"],
          x: 15 + ((x.number - 1) % 4) * 23,
          y: x.number <= 4 ? 30 : 60,
        },
        reason,
      );
    for (const [n, label, kind, x, y] of [
      [8010, "SAMPLE entrance", "entrance", 50, 92],
      [8011, "SAMPLE service counter", "service_counter", 85, 10],
      [8012, "SAMPLE path junction", "path", 50, 45],
    ] as const)
      await saveNode(
        db,
        a,
        previewId(n),
        null,
        { label, kind, x, y, active: true },
        reason,
      );
    await saveEdge(db, a, previewId(8010), previewId(8012), true, reason);
    await saveEdge(db, a, previewId(8012), previewId(8011), true, reason);
    for (const [n, pool, label] of [
      [8020, "retail", "SAMPLE retail display"],
      [8021, "breaker", "SAMPLE private breaker bin"],
      [8022, "excess", "SAMPLE private backstock rack"],
      [8023, "retail", "SAMPLE second display"],
    ] as const)
      await saveLocation(
        db,
        a,
        previewId(n),
        null,
        {
          pool,
          label,
          aisle_id: pool === "retail" ? aisles[n === 8023 ? 5 : 1].id : null,
          side: pool === "retail" ? "Left" : null,
          zone: "SAMPLE zone",
          categories: ["SAMPLE cards"],
          approved_retail: pool === "retail",
          active: true,
        },
        reason,
      );
    await saveProduct(
      db,
      a,
      previewId(8001),
      null,
      {
        shopify_product_id: "gid://shopify/Product/8001",
        title: "SAMPLE basketball card box",
        family: "SAMPLE basketball cards",
        handle: "sample-basketball-box",
      },
      reason,
      "sample",
    );
    for (const [n, sku, barcode] of [
      [8030, "SAMPLE-BOX-BASE", "SAMPLE-BOX-BASE"],
      [8031, "SAMPLE-BOX-SOLDOUT", "SAMPLE-BOX-SOLDOUT"],
    ] as const)
      await saveVariant(
        db,
        a,
        previewId(n),
        null,
        {
          product_id: previewId(8001),
          shopify_variant_id: "gid://shopify/ProductVariant/" + n,
          sku,
          barcode,
          verified: true,
          evidence: "SAMPLE invented mapping, never a Shopify verification",
        },
        reason,
        "sample",
      );
    for (let n = 0; n < 3; n++)
      await assignLocation(
        db,
        a,
        previewId(8040 + n),
        null,
        previewId(8030),
        previewId(8020 + n),
        reason,
      );
    await saveQR(
      db,
      a,
      previewId(8050),
      null,
      {
        product_id: previewId(8001),
        variant_id: null,
        placement_id: previewId(8021),
        campaign_key: "sample-store",
        destination: "retail_locator",
        active: true,
      },
      reason,
    );
  });
}
const state = globalThis as unknown as { northsideStoreReady?: Promise<void> };
export async function storePreview(request: Request) {
  const who = previewActor(request),
    f = await previewDatabase();
  state.northsideStoreReady ??= initializeStorePreview(f);
  await state.northsideStoreReady;
  return { who, f };
}
