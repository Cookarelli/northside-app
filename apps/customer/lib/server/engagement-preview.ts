import "server-only";
import { readFile } from "node:fs/promises";
import {
  openPreviewDatabase,
  previewDatabase,
  previewActor,
  previewId,
} from "./grading-preview";
import { initializeConsignmentPreview } from "./consignment-preview";
import { initializeBreakPreview } from "./break-preview";
import { saveShow, savePlacement } from "./measurement";
import { reconcileMeasurement } from "./measurement-worker";
import { preferences } from "./notifications";
import type { Sql } from "./db";
import { TENANT } from "./providers";
export const sampleShowId = previewId(9001),
  sampleVendorShowId = previewId(9002),
  sampleShowRef = "SAMPLE_geneva_table_entrance_01";
type DB = Awaited<ReturnType<typeof openPreviewDatabase>>;
export const engagementSampleRun = <T>(f: DB, fn: (db: Sql) => Promise<T>) =>
  f.db.transaction(async (tx) => {
    await tx.exec("set local role northside_engagement");
    return fn(tx as unknown as Sql);
  });
export async function initializeEngagementPreview(f: DB) {
  await initializeConsignmentPreview(f);
  await initializeBreakPreview(f);
  if (
    !(
      await f.db.query<{ name: string | null }>(
        "select to_regclass('ns.notification_jobs')::text name",
      )
    ).rows[0].name
  )
    await f.db.exec(
      await readFile("supabase/migrations/202609120009_engagement.sql", "utf8"),
    );
  if ((await f.db.query("select id from ns.show_events limit 1")).rows.length)
    return;
  await f.run("staff", async (db, a) => {
    await saveShow(
      db,
      a,
      {
        id: sampleShowId,
        slug: "sample-geneva",
        brand: "northside",
        title: "SAMPLE Geneva card show",
        description:
          "Explore Northside, browse cards, save break reminders and keep up with your collection. This is a fictional landing for checking the show workflow.",
        published: true,
      },
      true,
    );
    await saveShow(
      db,
      a,
      {
        id: sampleVendorShowId,
        slug: "sample-hobby-key",
        brand: "hobby_key",
        title: "SAMPLE HobbyKey vendor interest",
        description:
          "Register interest in hearing about a possible HobbyKey vendor experience. This is not an operating marketplace, vendor booking or payment service.",
        published: true,
      },
      true,
    );
    await savePlacement(db, a, {
      ref: sampleShowRef,
      event_id: sampleShowId,
      placement_key: "sample_table_entrance",
      utm_source: "geneva_card_show",
      utm_medium: "qr",
      utm_campaign: "sample_geneva",
      utm_content: "sample_table_entrance_01",
      enabled: true,
    });
    await savePlacement(db, a, {
      ref: "SAMPLE_hobby_key_vendor_desk_01",
      event_id: sampleVendorShowId,
      placement_key: "sample_vendor_desk",
      utm_source: "geneva_card_show",
      utm_medium: "qr",
      utm_campaign: "sample_hobby_key",
      utm_content: "sample_vendor_desk_01",
      enabled: true,
    });
  });
  await f.run("a", async (db, a) => {
    for (const kind of ["grading", "consignment", "break"])
      await preferences(
        db,
        a,
        { kind, in_app: true, email: true, push: true },
        undefined,
        true,
      );
  });
  await f.db.query(
    "insert into ns.grading_events(tenant_id,card_id,case_id,label,source) select tenant_id,card_id,case_id,'SAMPLE notification rehearsal','northside' from ns.grading_cards where tenant_id=$1 and case_id in(select case_id from ns.grading_intakes where customer_id=$2) order by card_id limit 1",
    [TENANT, previewId(1)],
  );
  await engagementSampleRun(f, async (db) => {
    for (const n of [1, 2, 3])
      await reconcileMeasurement(
        db,
        {
          id: `SAMPLE-order-${n}`,
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          gross: 2500,
          refund: n === 2 ? 500 : 0,
          channel: n === 3 ? "external_legacy" : "online",
          first: n === 1 ? sampleShowRef : null,
          latest: n === 1 ? sampleShowRef : null,
        },
        true,
      );
  });
}
const state = globalThis as unknown as {
  northsideEngagementReady?: Promise<void>;
};
export async function engagementPreview(request: Request) {
  const who = previewActor(request),
    f = await previewDatabase();
  state.northsideEngagementReady ??= initializeEngagementPreview(f);
  await state.northsideEngagementReady;
  return { who, f };
}
