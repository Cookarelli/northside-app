import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Sql, Actor } from "./db";
import {
  previewDatabase,
  previewActor,
  previewId,
  openPreviewDatabase,
} from "./grading-preview";
import {
  createConsignment,
  recordSettlement,
  consignmentItem,
} from "./consignment";
export async function initializeConsignmentPreview(
  database: Awaited<ReturnType<typeof openPreviewDatabase>>,
) {
  if (
    !(
      await database.db.query<{ table: string | null }>(
        "select to_regclass('ns.consignment_events')::text as table",
      )
    ).rows[0].table
  )
    await database.db.exec(
      await readFile(
        resolve("supabase/migrations/202609120005_consignment.sql"),
        "utf8",
      ),
    );
  if (
    !(await database.db.query("select id from ns.consignment_items limit 1"))
      .rows.length
  )
    await database.run("staff", async (db, a) => {
      await createConsignment(db, a, {
        customer_id: previewId(1),
        request_id: previewId(2001),
        description: "SAMPLE — basketball consignment, fees pending",
        received_date: "2026-09-01",
        currency: "USD",
        state_key: "sold",
        sale_cents: 30000,
        sale_evidence: "Fictional sale evidence for local preview",
        channel: "Fanatics Collect — sample only",
        reason: "Initial fictional consignment example",
      });
      const partial = await createConsignment(db, a, {
        customer_id: previewId(1),
        request_id: previewId(2002),
        description: "SAMPLE — baseball consignment, partial settlement",
        received_date: "2026-09-01",
        currency: "USD",
        state_key: "sold",
        sale_cents: 10000,
        fees_cents: 2000,
        sale_evidence: "Fictional sale evidence for local preview",
        channel: "Fanatics Collect — sample only",
        reason: "Initial fictional consignment example",
      });
      await recordSettlement(db, a, {
        item_id: partial.id,
        version: (await consignmentItem(db, a, partial.id)).version,
        currency: "USD",
        amount_cents: 3000,
        reference: "SAMPLE-PARTIAL-001",
        recorded_date: "2026-09-02",
        reason: "Fictional partial settlement example; no transfer",
      });
      await createConsignment(db, a, {
        customer_id: previewId(2),
        request_id: previewId(2003),
        description: "SAMPLE — football consignment, listed",
        received_date: "2026-09-01",
        currency: "USD",
        state_key: "listed",
        asking_cents: 25000,
        channel: "Fanatics Collect — sample only",
        reason: "Initial fictional consignment example",
      });
    });
}
const state = globalThis as unknown as {
  northsideConsignmentReady?: Promise<void>;
};
export async function consignmentPreviewTransaction<T>(
  request: Request,
  fn: (db: Sql, a: Actor) => Promise<T>,
) {
  const actor = previewActor(request),
    database = await previewDatabase();
  state.northsideConsignmentReady ??= initializeConsignmentPreview(database);
  await state.northsideConsignmentReady;
  return database.run(actor, fn);
}
