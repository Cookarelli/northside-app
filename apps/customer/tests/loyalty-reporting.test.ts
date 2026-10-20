import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loyaltyFixture, fail } from "./support/loyalty-fixture";
import {
  loyaltyReport,
  reconciliationReport,
  loyaltyCohortExport,
  loyaltyStaff,
} from "../lib/server/loyalty-reporting";
import { loyaltyApi } from "../lib/server/loyalty-api";
import { wallet } from "../lib/server/loyalty";
import { TENANT } from "../lib/server/providers";
import { previewId, openPreviewDatabase } from "../lib/server/grading-preview";
const f = await loyaltyFixture();
let closed = false;
test("loyalty pass 3: metrics carry source/period definitions, explicit exposure assumption and balanced reconciliation", async () => {
  const report = await f.run("staff", (db, a) =>
    loyaltyReport(db, a, undefined, undefined, 1, "sample"),
  );
  assert.equal(
    report.metrics.find((m) => m.key === "gross_earned")?.value,
    2000,
  );
  assert.equal(report.metrics.find((m) => m.key === "members")?.value, 2);
  assert.equal(
    report.metrics.find((m) => m.key === "active_earners")?.value,
    1,
  );
  assert.equal(report.reconciliation.issues.length, 0);
  assert.equal(report.reconciliation.accounts_checked, 2);
  assert.equal(report.exposure?.cents, 2000);
  assert.match(report.exposure!.definition, /not an accounting liability/);
  assert.ok(report.metrics.every((m) => m.period && m.source && m.definition));
  assert.equal(report.tiers.Vet, 1);
  assert.equal(report.tiers.Rookie, 1);
  assert.equal(
    (
      await f.run("reader", (db, a) =>
        loyaltyReport(db, a, undefined, undefined, undefined, "sample"),
      )
    ).exposure,
    null,
  );
  await assert.rejects(f.run("a", loyaltyStaff), fail(403));
  await assert.rejects(f.run("editor", reconciliationReport), fail(403));
  const csv = await f.run("staff", (db, a) => loyaltyCohortExport(db, a));
  assert.match(csv, /suppressed/);
  assert.ok(!csv.includes(previewId(1)));
  assert.ok(!csv.includes("Sample collector"));
  const tiers = await f.db.query("select * from ns.tier_qualifications");
  assert.ok(tiers.rows.length > 0);
});
test("loyalty pass 3: forged API reward price/owner rejected; private staff analytics and wrong-owner views stay isolated", async () => {
  const request = new Request("http://127.0.0.1/api/preview/loyalty", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "reserve",
      reward_id: f.reward.id,
      source_id: randomUUID(),
      points: 1,
      customer_id: previewId(2),
    }),
  });
  await assert.rejects(
    f.run("a", (db, a) => loyaltyApi(request, db, a, "sample")),
    fail(400),
  );
  const forged = await f.run("a", (db, a) =>
    wallet(db, { ...a, customer_id: previewId(2) }, "sample"),
  );
  assert.equal(forged.balance, null);
  assert.equal(forged.ledger.length, 0);
  await f.run("a", async (db) => {
    assert.equal(
      (await db.query("select * from ns.loyalty_audit")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from ns.loyalty_jobs")).rows.length,
      0,
    );
  });
});
test("loyalty pass 3: another tenant is denied by actual worker/runtime RLS and compound keys", async () => {
  const tenant = previewId(900),
    customer = previewId(901),
    rule = previewId(902),
    account = previewId(903);
  await f.db.query(
    "insert into ns.tenants(id,slug,shop,is_test) values($1,'loyalty-test-other','loyalty-other.myshopify.com',true)",
    [tenant],
  );
  await f.db.query("insert into ns.customers(tenant_id,id) values($1,$2)", [
    tenant,
    customer,
  ]);
  await f.db.query(
    "insert into ns.loyalty_rules(tenant_id,id,version,parameters,fixture) values($1,$2,1,'{}',true)",
    [tenant, rule],
  );
  await f.db.query(
    "insert into ns.loyalty_accounts(tenant_id,id,customer_id,enrolled_at) values($1,$2,$3,now())",
    [tenant, account, customer],
  );
  await f.db.query(
    "insert into ns.loyalty_ledger(tenant_id,account_id,customer_id,rule_id,points,source_object,operation,reason) values($1,$2,$3,$4,999,'other','credit','Other tenant fixture')",
    [tenant, account, customer, rule],
  );
  for (const who of ["a", "staff", "reader"])
    await f.run(who, async (db) =>
      assert.equal(
        (
          await db.query("select * from ns.loyalty_ledger where tenant_id=$1", [
            tenant,
          ])
        ).rows.length,
        0,
      ),
    );
  await f.worker(async (db) => {
    assert.equal(
      (
        await db.query("select * from ns.loyalty_ledger where tenant_id=$1", [
          tenant,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select * from ns.sessions"),
      /permission denied/,
    );
  });
  await assert.rejects(
    f.db.query(
      "insert into ns.loyalty_ledger(tenant_id,account_id,customer_id,rule_id,points,source_object,operation,reason) values($1,$2,$3,$4,999,'cross','credit','Cross tenant')",
      [TENANT, account, customer, f.rule.id],
    ),
    /foreign key/,
  );
});
test("loyalty pass 3: reconciliation detects corrupted cache and local records survive close/reopen", async () => {
  await f.db.query(
    "update ns.loyalty_accounts set cached_points=cached_points+1 where tenant_id=$1 and customer_id=$2",
    [TENANT, previewId(1)],
  );
  assert.equal(
    (await f.run("staff", reconciliationReport)).issues[0].kind,
    "balance_mismatch",
  );
  await f.db.query(
    "update ns.loyalty_accounts set cached_points=cached_points-1 where tenant_id=$1 and customer_id=$2",
    [TENANT, previewId(1)],
  );
  await f.db.close();
  closed = true;
  const reopened = await openPreviewDatabase(f.dir);
  assert.equal(
    (await reopened.run("a", (db, a) => wallet(db, a, "sample"))).balance,
    2000,
  );
  await reopened.db.close();
});
test.after(async () => {
  if (!closed) await f.db.close();
  await rm(f.dir, { recursive: true, force: true });
});
