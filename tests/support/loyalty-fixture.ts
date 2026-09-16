import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openPreviewDatabase,
  previewId,
} from "../../lib/server/grading-preview";
import {
  createRule,
  approveRule,
  enroll,
  createReward,
  rewardActive,
  reconcileLoyaltyOrder,
} from "../../lib/server/loyalty";
import type { Sql } from "../../lib/server/db";
import { TENANT, SHOP } from "../../lib/server/providers";
import type {
  LoyaltyRules,
  LoyaltyOrder,
  VoucherSnapshot,
} from "../../lib/loyalty";
import type {
  LoyaltyDiscountAdapter,
  DiscountEvidence,
} from "../../lib/server/loyalty-discounts";
export const sampleRules: LoyaltyRules = {
  points_per_dollar: 10,
  qualification_days: 365,
  tiers: [
    { label: "Rookie", threshold_cents: 0 },
    { label: "Vet", threshold_cents: 10000 },
    { label: "HOF", threshold_cents: 100000 },
    { label: "GOAT", threshold_cents: 1000000 },
  ],
  eligible_products: [{ id: "gid://shopify/Product/1", kind: "retail" }],
  approved_service_kinds: [],
  excluded_product_ids: [],
  points_expiry: "none",
  rounding: "floor_per_line_cumulative",
  tier_returns: "reduce_original_period",
  refund_restoration: "manual_review",
};
export const sampleOrder = (n: number, customer = 1): LoyaltyOrder => ({
  id: `gid://shopify/Order/${n}`,
  customerId: `gid://shopify/Customer/${customer}`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  paidAt: new Date().toISOString(),
  financialStatus: "PAID",
  cancelled: false,
  currency: "USD",
  channel: "web",
  lines: [
    {
      id: `gid://shopify/LineItem/${n}`,
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/1",
      isGiftCard: false,
      quantity: 1,
      currentQuantity: 1,
      originalNetCents: 20000,
      refundedCents: 0,
      refundedQuantity: 0,
    },
  ],
  ambiguousRefund: false,
  discounts: [],
  campaignRef: null,
});
export async function loyaltyFixture() {
  const dir = await mkdtemp(join(tmpdir(), "northside-loyalty-")),
    f = await openPreviewDatabase(dir);
  await f.db.exec(
    await readFile("supabase/migrations/202609120006_loyalty.sql", "utf8"),
  );
  for (const n of [1, 2])
    await f.db.query(
      "insert into ns.shopify_customers(tenant_id,customer_id,shop,shopify_id) values($1,$2,$3,$4)",
      [TENANT, previewId(n), SHOP, `gid://shopify/Customer/${n}`],
    );
  const d = await f.run("staff", (db, a) =>
    createRule(db, a, sampleRules, "SAMPLE draft", "sample"),
  );
  const rule = await f.run("staff", (db, a) =>
    approveRule(
      db,
      a,
      d.id,
      new Date(Date.now() - 60000).toISOString(),
      "SAMPLE approved economics",
      "sample",
    ),
  );
  for (const who of ["a", "b"])
    await f.run(who, (db, a) => enroll(db, a, "sample"));
  const reward = await f.run("staff", (db, a) =>
    createReward(
      db,
      a,
      {
        rule_id: rule.id,
        points_cost: 500,
        value_cents: 500,
        terms: {
          title: "SAMPLE $5 reward",
          minimum_cents: 1000,
          product_ids: ["gid://shopify/Product/1"],
          collection_ids: [],
          expiry_days: 30,
          combines: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
        },
      },
      "SAMPLE reward",
    ),
  );
  await f.run("staff", (db, a) =>
    rewardActive(db, a, reward.id, true, "SAMPLE activation", "sample"),
  );
  const worker = <T>(fn: (db: Sql) => Promise<T>) =>
    f.db.transaction(async (tx) => {
      await tx.exec("set local role northside_loyalty");
      return fn(tx as unknown as Sql);
    });
  await worker((db) => reconcileLoyaltyOrder(db, sampleOrder(100), "sample"));
  return {
    ...f,
    dir,
    worker,
    rule,
    reward,
    close: async () => {
      await f.db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
export class SampleAdapter implements LoyaltyDiscountAdapter {
  readonly kind = "sample" as const;
  records = new Map<string, DiscountEvidence>();
  creates = 0;
  timeout = false;
  reject = false;
  async lookup(code: string, s: VoucherSnapshot) {
    void s;
    return this.records.get(code) || null;
  }
  async create(
    code: string,
    s: VoucherSnapshot,
  ): ReturnType<LoyaltyDiscountAdapter["create"]> {
    this.creates++;
    if (this.reject) return { state: "rejected" };
    const e = {
      id: `gid://shopify/DiscountCodeNode/${this.creates}`,
      code,
      status: "ACTIVE",
      usageCount: 0,
      snapshot: s,
    };
    this.records.set(code, e);
    if (this.timeout) return { state: "uncertain" };
    return { state: "created", evidence: e };
  }
  async deactivate(id: string) {
    for (const e of this.records.values())
      if (e.id === id) {
        e.status = "EXPIRED";
        return true;
      }
    return false;
  }
}
export const fail = (status: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === status;
