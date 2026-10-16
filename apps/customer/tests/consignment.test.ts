import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import { initializeConsignmentPreview } from "../lib/server/consignment-preview";
import {
  consignmentItems,
  consignmentItem,
  consignmentDetail,
  consignmentDashboard,
  createConsignment,
  updateConsignment,
  recordSettlement,
  consignmentExport,
} from "../lib/server/consignment";
import {
  previewConsignmentImport,
  resolveConsignmentImport,
  commitConsignmentImport,
  readConsignmentImport,
} from "../lib/server/consignment-import";
import { consignmentApi } from "../lib/server/consignment-api";
import {
  DisconnectedFanaticsCollectAdapter,
  type FanaticsCollectAdapter,
} from "../lib/server/fanatics-collect";
import { consignmentFields } from "../lib/consignment";
import { authorizeOn, type Sql } from "../lib/server/db";
import { hashToken, opaqueToken } from "../lib/server/security";
import { TENANT } from "../lib/server/providers";
const directory = await mkdtemp(join(tmpdir(), "northside-consignment-tests-"));
let fixture = await openPreviewDatabase(directory);
await initializeConsignmentPreview(fixture);
const run = <T>(who: string, fn: Parameters<typeof fixture.run<T>>[1]) =>
  fixture.run(who, fn);
const fail = (status: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === status;
const body = (description = "SAMPLE test intake") => ({
  customer_id: previewId(1),
  request_id: randomUUID(),
  description,
  currency: "USD",
  received_date: "2026-09-01",
  reason: "Test intake evidence",
});
let newItem = "";
test("consignment: stable intake IDs, nullable amounts and independent customer ownership", async () => {
  const b = body(),
    created = await run("staff", (db, a) => createConsignment(db, a, b));
  newItem = created.id;
  const repeat = await run("staff", (db, a) => createConsignment(db, a, b));
  assert.equal(repeat.id, newItem);
  assert.equal(repeat.duplicate, true);
  const detail = await run("a", (db, a) => consignmentDetail(db, a, newItem));
  assert.equal(detail.item.net_cents, null);
  assert.equal(detail.item.sale_cents, null);
  assert.equal(detail.item.fees_cents, null);
  assert.equal(detail.item.payout_status, "unknown");
  assert.equal(detail.settlements.length, 0);
  assert.equal(detail.events[0].source, "northside");
  assert.notEqual(detail.item.card_id, detail.item.id);
  await assert.rejects(
    run("b", (db, a) => consignmentItem(db, a, newItem)),
    fail(404),
  );
  await run("b", async (db) => {
    assert.equal(
      (
        await db.query("select * from ns.consignment_items where id=$1", [
          newItem,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from ns.consignment_audit")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from ns.consignment_import_rows")).rows.length,
      0,
    );
  });
});
test("consignment: missing fees are unknown; verified zero values are real zero, sold is not paid", async () => {
  const pending = (await run("a", consignmentItems)).find((i) =>
    i.description.includes("fees pending"),
  )!;
  assert.equal(pending.sale_cents, 30000);
  assert.equal(pending.net_cents, null);
  assert.equal(pending.payout_status, "awaiting_settlement");
  await assert.rejects(
    run("staff", (db, a) =>
      recordSettlement(db, a, {
        item_id: pending.id,
        version: pending.version,
        currency: "USD",
        amount_cents: 100,
        reference: "CANNOT-ASSUME-FEES",
        recorded_date: "2026-09-02",
        reason: "Unknown fee test",
      }),
    ),
    fail(409),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      createConsignment(db, a, { ...body(), state_key: "sold", sale_cents: 0 }),
    ),
    fail(400),
  );
  const zero = await run("staff", (db, a) =>
    createConsignment(db, a, {
      ...body("SAMPLE zero proceeds"),
      state_key: "sold",
      sale_cents: 0,
      fees_cents: 0,
      sale_evidence: "Confirmed fictional zero values",
    }),
  );
  const z = await run("a", (db, a) => consignmentItem(db, a, zero.id));
  assert.equal(z.net_cents, 0);
  assert.equal(z.payout_status, "awaiting_settlement");
  await run("staff", (db, a) =>
    recordSettlement(db, a, {
      item_id: z.id,
      version: z.version,
      currency: "USD",
      amount_cents: 0,
      reference: "ZERO-NET-CONFIRMED",
      recorded_date: "2026-09-02",
      reason: "Confirmed zero net statement",
    }),
  );
  assert.equal(
    (await run("a", (db, a) => consignmentItem(db, a, z.id))).payout_status,
    "paid",
  );
});
test("consignment: partial settlement totals, cap, duplicate protection and immutable correction history", async () => {
  const partial = (await run("a", consignmentItems)).find((i) =>
    i.description.includes("partial settlement"),
  )!;
  assert.equal(partial.settled_cents, 3000);
  assert.equal(partial.net_cents, 8000);
  assert.equal(partial.payout_status, "partial");
  await assert.rejects(
    run("staff", (db, a) =>
      recordSettlement(db, a, {
        item_id: partial.id,
        version: partial.version,
        currency: "USD",
        amount_cents: 5001,
        reference: "TOO-LARGE",
        recorded_date: "2026-09-03",
        reason: "Exceeds remaining",
      }),
    ),
    fail(409),
  );
  const paidBody = {
    item_id: partial.id,
    version: partial.version,
    currency: "USD",
    amount_cents: 5000,
    reference: "SECOND-PARTIAL",
    recorded_date: "2026-09-03",
    reason: "Verified second settlement receipt",
  };
  await run("staff", (db, a) => recordSettlement(db, a, paidBody));
  const full = await run("a", (db, a) => consignmentDetail(db, a, partial.id));
  assert.equal(full.item.state_key, "paid");
  assert.equal(full.item.settled_cents, 8000);
  await assert.rejects(
    run("staff", (db, a) => recordSettlement(db, a, paidBody)),
    fail(409),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      updateConsignment(db, a, partial.id, {
        version: full.item.version,
        currency: "USD",
        fees_cents: 1000,
        reason: "Cannot silently change net",
      }),
    ),
    fail(409),
  );
  const entry = full.settlements.find((s) => s.reference === "SECOND-PARTIAL")!;
  await run("staff", (db, a) =>
    recordSettlement(db, a, {
      item_id: partial.id,
      version: full.item.version,
      currency: "USD",
      reverses_id: entry.id,
      reference: "CORRECTION-SECOND",
      recorded_date: "2026-09-04",
      reason: "Corrected duplicate external evidence; no actual funds moved",
    }),
  );
  const after = await run("a", (db, a) => consignmentDetail(db, a, partial.id));
  assert.equal(after.item.payout_status, "partial");
  assert.equal(after.item.settled_cents, 3000);
  assert.equal(after.settlements.length, 3);
  assert.ok(
    after.events.some((e) => e.label === "Settlement recorded in full"),
  );
  await assert.rejects(
    fixture.db.query("delete from ns.consignment_settlements"),
    /Append-only/,
  );
  await assert.rejects(
    fixture.db.query("update ns.consignment_events set label='rewrite'"),
    /Append-only/,
  );
  assert.equal(
    (await fixture.db.query("select * from ns.order_ledger")).rows.length,
    0,
  );
  assert.equal(
    (await fixture.db.query("select * from ns.loyalty_ledger")).rows.length,
    0,
  );
});
test("consignment: unauthorized changes, forged owners and unknown status labels are refused", async () => {
  for (const who of ["a", "reader", "editor"]) {
    await assert.rejects(
      run(who, (db, a) => createConsignment(db, a, body())),
      fail(403),
    );
    await assert.rejects(
      run(who, (db, a) =>
        updateConsignment(db, a, newItem, {
          version: 1,
          state_key: "listed",
          reason: "Forbidden",
        }),
      ),
      fail(403),
    );
  }
  await run("a", async (db) =>
    assert.equal(
      (
        await db.query(
          "update ns.consignment_items set state_key='paid' returning id",
        )
      ).rows.length,
      0,
    ),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      updateConsignment(db, a, newItem, {
        version: 1,
        state_key: "PAID-EXTERNALLY",
        reason: "Stale provider label",
      }),
    ),
    fail(400),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      updateConsignment(db, a, newItem, {
        version: 1,
        customer_id: previewId(2),
        reason: "No reparenting",
      }),
    ),
    fail(409),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      updateConsignment(db, a, newItem, {
        version: 1,
        state_key: "paid",
        sale_cents: 100,
        sale_evidence: "Fake shortcut",
        reason: "No payout reference",
      }),
    ),
    fail(409),
  );
});
test("consignment: tenant context independently isolates items and payout records", async () => {
  const tenant = "22222222-2222-4222-8222-222222222222",
    customer = previewId(900),
    token = opaqueToken();
  await fixture.db.query(
    "insert into ns.tenants(id,slug,shop,is_test) values($1,'consignment-test-only','consignment-test.myshopify.com',true)",
    [tenant],
  );
  await fixture.db.query(
    "insert into ns.customers(tenant_id,id) values($1,$2)",
    [tenant, customer],
  );
  await fixture.db.query(
    "insert into ns.sessions(token_hash,tenant_id,customer_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'shopify','TEST ONLY',now()+interval '1 hour',now()+interval '1 hour')",
    [hashToken(token), tenant, customer],
  );
  await fixture.db.transaction(async (tx) => {
    await tx.exec("set local role northside_runtime");
    const db = tx as unknown as Sql,
      a = await authorizeOn(db, token);
    assert.equal((await consignmentItems(db, a)).length, 0);
    assert.equal(
      (await db.query("select * from ns.consignment_settlements")).rows.length,
      0,
    );
    await assert.rejects(
      consignmentItem(
        db,
        { ...a, tenant_id: TENANT, customer_id: previewId(1) },
        newItem,
      ),
      fail(404),
    );
  });
});
const template = await readFile("public/samples/consignment.csv", "utf8");
const mapping = Object.fromEntries(consignmentFields.map((k) => [k, k]));
let importId = "";
test("consignment: mapped imports queue unmatched rows and require explicit verified matching", async () => {
  const p = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, {
      source: "test-sheet",
      csv: template,
      mapping,
    }),
  );
  importId = p.id;
  assert.equal(p.rows[0].state, "ready");
  assert.equal(p.rows[1].state, "unmatched");
  assert.equal((await run("staff", consignmentDashboard)).review_count, 1);
  assert.equal(
    (await run("a", consignmentItems)).filter((i) =>
      i.description.includes("SAMPLE ONLY"),
    ).length,
    0,
  );
  await assert.rejects(
    run("staff", (db, a) =>
      commitConsignmentImport(db, a, {
        id: p.id,
        confirm: true,
        reason: "Cannot commit unmatched rows",
      }),
    ),
    fail(409),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      resolveConsignmentImport(db, a, {
        id: p.id,
        row_number: 3,
        customer_id: previewId(2),
        reason: "No confirmation",
      }),
    ),
    fail(400),
  );
  await run("staff", (db, a) =>
    resolveConsignmentImport(db, a, {
      id: p.id,
      row_number: 3,
      customer_id: previewId(2),
      confirm: true,
      reason: "Independent sample receipt evidence confirms customer B",
    }),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      commitConsignmentImport(db, a, {
        id: p.id,
        reason: "No review confirmation",
      }),
    ),
    fail(400),
  );
  await run("staff", (db, a) =>
    commitConsignmentImport(db, a, {
      id: p.id,
      confirm: true,
      reason: "Reviewed exact customer matches and input fields",
    }),
  );
  assert.equal(
    (await run("b", consignmentItems)).filter((i) =>
      i.description.includes("unmatched baseball"),
    ).length,
    1,
  );
  await assert.rejects(
    run("a", (db, a) => readConsignmentImport(db, a, p.id)),
    fail(403),
  );
});
test("consignment: duplicate file/source IDs do not create extra records or overwrite manual corrections", async () => {
  const before = (await run("staff", consignmentItems)).length;
  await run("staff", (db, a) =>
    commitConsignmentImport(db, a, {
      id: importId,
      confirm: true,
      reason: "Retry same commit",
    }),
  );
  assert.equal((await run("staff", consignmentItems)).length, before);
  const item = (await run("a", consignmentItems)).find(
    (i) => i.description === "SAMPLE ONLY basketball consignment",
  )!;
  await run("staff", (db, a) =>
    updateConsignment(db, a, item.id, {
      version: item.version,
      customer_notes: "Reviewed Northside correction",
      reason: "Manual correction evidence",
    }),
  );
  const again = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, {
      source: "test-sheet",
      csv: template,
      mapping,
    }),
  );
  assert.ok(again.rows.every((r) => r.state === "duplicate"));
  await run("staff", (db, a) =>
    commitConsignmentImport(db, a, {
      id: again.id,
      confirm: true,
      reason: "Reviewed repeated file",
    }),
  );
  assert.equal(
    (await run("a", (db, a) => consignmentItem(db, a, item.id))).customer_notes,
    "Reviewed Northside correction",
  );
  assert.equal((await run("staff", consignmentItems)).length, before);
});
test("consignment: ownership conflicts and stale external records enter review without rematching", async () => {
  const wrong = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, {
      source: "test-sheet",
      csv: template.replace(previewId(1), previewId(2)),
      mapping,
    }),
  );
  assert.equal(wrong.rows[0].state, "conflict");
  const stale = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, {
      source: "test-sheet",
      csv: template
        .replace("Sample listing note", "STALE CHANGE")
        .replaceAll("2026-09-03T12:00:00Z", "2026-09-02T12:00:00Z"),
      mapping,
    }),
  );
  assert.equal(stale.rows[0].state, "conflict");
  const bad = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, {
      source: "bad",
      csv: template.replace(",listed,", ",unknown_status,"),
      mapping,
    }),
  );
  assert.equal(bad.rows[0].state, "error");
  await assert.rejects(
    run("staff", (db, a) =>
      resolveConsignmentImport(db, a, {
        id: wrong.id,
        row_number: 2,
        customer_id: previewId(2),
        confirm: true,
        reason: "Must not overwrite ownership",
      }),
    ),
    fail(409),
  );
});
test("consignment: update review pins the item version, preserves blanks, and audits approved changes", async () => {
  const csv = template
    .replace("15000", "17500")
    .replace("2026-09-03T12:00:00Z", "2026-09-05T12:00:00Z");
  const p = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, { source: "test-sheet", csv, mapping }),
  );
  assert.equal(p.rows[0].state, "ready");
  assert.ok(p.rows[0].current_snapshot);
  const item = await run("a", (db, a) =>
    consignmentItem(db, a, p.rows[0].target_item_id!),
  );
  await run("staff", (db, a) =>
    updateConsignment(db, a, item.id, {
      version: item.version,
      fees_cents: 0,
      customer_notes: "Newer reviewed correction",
      reason: "Explicit zero fee confirmation",
    }),
  );
  await assert.rejects(
    run("staff", (db, a) =>
      commitConsignmentImport(db, a, {
        id: p.id,
        confirm: true,
        reason: "Old preview must fail",
      }),
    ),
    fail(409),
  );
  assert.equal(
    (await run("a", (db, a) => consignmentItem(db, a, item.id))).customer_notes,
    "Newer reviewed correction",
  );
  const fresh = await run("staff", (db, a) =>
    previewConsignmentImport(db, a, { source: "test-sheet", csv, mapping }),
  );
  await run("staff", (db, a) =>
    commitConsignmentImport(db, a, {
      id: fresh.id,
      confirm: true,
      reason:
        "Reviewed current corrections and explicitly accepted new source values",
    }),
  );
  const after = await run("a", (db, a) => consignmentDetail(db, a, item.id));
  assert.equal(after.item.asking_cents, 17500);
  assert.equal(after.item.fees_cents, 0);
  assert.ok(after.events.some((e) => e.source === "reviewed_csv"));
});
test("consignment: partner disconnect/outage never removes manual data and no provider requests occur", async () => {
  const adapter = new DisconnectedFanaticsCollectAdapter();
  assert.equal((await adapter.health()).capabilities.payouts, false);
  assert.deepEqual(await adapter.readConsignments(), {
    state: "disconnected",
    records: null,
  });
  const before = await run("a", consignmentItems);
  const outage: FanaticsCollectAdapter = {
    health: async () => {
      throw Error("Provider unavailable");
    },
    readConsignments: async () => {
      throw Error("No contract");
    },
  };
  const page = await run("a", (db, a) => consignmentDashboard(db, a, outage));
  assert.equal(page.integration.state, "unavailable");
  assert.equal(page.items.length, before.length);
  assert.equal((await run("a", consignmentItems)).length, before.length);
  await run("staff", (db, a) =>
    updateConsignment(db, a, newItem, {
      version: 1,
      state_key: "preparing",
      customer_notes: "Manual workflow still works",
      reason: "No provider dependency",
    }),
  );
  assert.equal(
    (await run("a", (db, a) => consignmentItem(db, a, newItem))).state_key,
    "preparing",
  );
});
test("consignment: own-file authorization and formula-safe export retain unknown amounts", async () => {
  const created = await run("staff", (db, a) =>
    createConsignment(db, a, body('=HYPERLINK("https://example.test")')),
  );
  const csv = await run("a", consignmentExport);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(!csv.includes("SAMPLE — football"));
  const req = new Request("http://127.0.0.1:3000/api/preview/consignment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sample-image", item_id: created.id }),
  });
  const file = (await run("staff", (db, a) =>
    consignmentApi(req, db, a, true),
  )) as { id: string };
  assert.deepEqual(
    await run("a", (db, a) =>
      consignmentApi(
        new Request(
          "http://127.0.0.1:3000/api/preview/consignment?file=" + file.id,
        ),
        db,
        a,
        true,
      ),
    ),
    { url: "/grading-sample.svg" },
  );
  await assert.rejects(
    run("b", (db, a) =>
      consignmentApi(
        new Request(
          "http://127.0.0.1:3000/api/preview/consignment?file=" + file.id,
        ),
        db,
        a,
        true,
      ),
    ),
    fail(404),
  );
});
test("consignment: intake, settlements, matching and corrections survive database restart", async () => {
  const before = await run("a", consignmentItems),
    count = (
      await fixture.db.query("select count(*) from ns.consignment_settlements")
    ).rows;
  await fixture.db.close();
  fixture = await openPreviewDatabase(directory);
  await initializeConsignmentPreview(fixture);
  assert.equal((await run("a", consignmentItems)).length, before.length);
  assert.deepEqual(
    (await fixture.db.query("select count(*) from ns.consignment_settlements"))
      .rows,
    count,
  );
  assert.equal(
    (await run("staff", (db, a) => readConsignmentImport(db, a, importId)))
      .status,
    "committed",
  );
  assert.equal(
    (await run("a", (db, a) => consignmentItem(db, a, newItem))).customer_notes,
    "Manual workflow still works",
  );
});
test.after(async () => {
  await fixture.db.close();
  await rm(directory, { recursive: true, force: true });
});
