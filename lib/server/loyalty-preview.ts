import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  previewDatabase,
  previewActor,
  previewId,
  openPreviewDatabase,
} from "./grading-preview";
import {
  createRule,
  approveRule,
  createReward,
  rewardActive,
  enroll,
  reconcileLoyaltyOrder,
  uuid,
} from "./loyalty";
import { type Sql } from "./db";
import { TENANT, SHOP } from "./providers";
import { AccessError } from "./security";
import type { LoyaltyRules, LoyaltyOrder, VoucherSnapshot } from "../loyalty";
import type {
  LoyaltyDiscountAdapter,
  DiscountEvidence,
} from "./loyalty-discounts";
import {
  claimLoyaltyJob,
  issueReward,
  deactivateReward,
} from "./loyalty-redemption";
export const exampleRules: LoyaltyRules = {
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
type Database = Awaited<ReturnType<typeof openPreviewDatabase>>;
export const sampleWorker = <T>(f: Database, fn: (db: Sql) => Promise<T>) =>
  f.db.transaction(async (tx) => {
    await tx.exec("set local role northside_loyalty");
    return fn(tx as unknown as Sql);
  });
export async function initializeLoyaltyPreview(f: Database) {
  if (
    !(
      await f.db.query<{ name: string | null }>(
        "select to_regclass('ns.loyalty_jobs')::text name",
      )
    ).rows[0].name
  )
    await f.db.exec(
      await readFile(
        resolve("supabase/migrations/202609120006_loyalty.sql"),
        "utf8",
      ),
    );
  // This provider simulator exists only in the ignored local database, never in hosted migrations.
  await f.db.exec(
    "create table if not exists ns.loyalty_sample_codes(code text primary key,evidence jsonb not null); grant select,insert,update on ns.loyalty_sample_codes to northside_loyalty;",
  );
  for (const n of [1, 2])
    await f.db.query(
      "insert into ns.shopify_customers(tenant_id,customer_id,shop,shopify_id) values($1,$2,$3,$4) on conflict do nothing",
      [TENANT, previewId(n), SHOP, `gid://shopify/Customer/${n}`],
    );
  if (
    !(
      await f.db.query(
        "select id from ns.loyalty_rules where fixture=true limit 1",
      )
    ).rows.length
  ) {
    const d = await f.run("staff", (db, a) =>
      createRule(
        db,
        a,
        exampleRules,
        "Initial fictional economic draft",
        "sample",
      ),
    );
    const rule = await f.run("staff", (db, a) =>
      approveRule(
        db,
        a,
        d.id,
        new Date(Date.now() - 86400000).toISOString(),
        "SAMPLE approval; not Joey's actual approval",
        "sample",
      ),
    );
    const reward = await f.run("staff", (db, a) =>
      createReward(
        db,
        a,
        {
          rule_id: rule.id,
          points_cost: 500,
          value_cents: 500,
          terms: {
            title: "SAMPLE $5 collector reward",
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
        "Initial fictional reward terms",
      ),
    );
    await f.run("staff", (db, a) =>
      rewardActive(
        db,
        a,
        reward.id,
        true,
        "SAMPLE reward approval only",
        "sample",
      ),
    );
    await f.run("a", (db, a) => enroll(db, a, "sample"));
    const at = new Date().toISOString(),
      order: LoyaltyOrder = {
        id: "gid://shopify/Order/900001",
        customerId: "gid://shopify/Customer/1",
        createdAt: at,
        updatedAt: at,
        paidAt: at,
        financialStatus: "PAID",
        cancelled: false,
        currency: "USD",
        channel: "online_sample",
        lines: [
          {
            id: "gid://shopify/LineItem/900001",
            productId: "gid://shopify/Product/1",
            variantId: "gid://shopify/ProductVariant/1",
            isGiftCard: false,
            quantity: 1,
            currentQuantity: 1,
            originalNetCents: 12500,
            refundedCents: 0,
            refundedQuantity: 0,
          },
        ],
        ambiguousRefund: false,
        discounts: [],
        campaignRef: null,
      };
    await sampleWorker(f, (db) => reconcileLoyaltyOrder(db, order, "sample"));
  }
}
export class LocalDiscountSimulator implements LoyaltyDiscountAdapter {
  readonly kind = "sample" as const;
  constructor(
    private db: Sql,
    private timeout = false,
  ) {}
  async lookup(code: string, s: VoucherSnapshot) {
    void s;
    return (
      (
        await this.db.query<{ evidence: DiscountEvidence }>(
          "select evidence from ns.loyalty_sample_codes where code=$1",
          [code],
        )
      ).rows[0]?.evidence || null
    );
  }
  async create(
    code: string,
    s: VoucherSnapshot,
  ): ReturnType<LoyaltyDiscountAdapter["create"]> {
    const evidence: DiscountEvidence = {
      id:
        "gid://shopify/DiscountCodeNode/" +
        BigInt("0x" + code.slice(2, 18)).toString(),
      code,
      status: "ACTIVE",
      usageCount: 0,
      snapshot: s,
    };
    await this.db.query(
      "insert into ns.loyalty_sample_codes(code,evidence) values($1,$2) on conflict do nothing",
      [code, JSON.stringify(evidence)],
    );
    return this.timeout
      ? { state: "uncertain" }
      : { state: "created", evidence };
  }
  async deactivate(id: string) {
    const r = await this.db.query(
      "update ns.loyalty_sample_codes set evidence=jsonb_set(evidence,'{status}','\"EXPIRED\"') where evidence->>'id'=$1 returning code",
      [id],
    );
    return !!r.rows.length;
  }
}
const globalState = globalThis as unknown as {
  northsideLoyaltyReady?: Promise<void>;
};
export async function loyaltyPreview(request: Request) {
  const who = previewActor(request),
    f = await previewDatabase();
  globalState.northsideLoyaltyReady ??= initializeLoyaltyPreview(f);
  await globalState.northsideLoyaltyReady;
  return { who, f };
}
export async function processSampleRewards(
  request: Request,
  reservationId?: string,
  timeout = false,
) {
  const { who, f } = await loyaltyPreview(request);
  if (who !== "staff") {
    uuid(reservationId);
    if (
      !(
        await f.run(who, (db, a) =>
          db.query(
            "select id from ns.redemption_reservations where tenant_id=$1 and customer_id=$2 and id=$3",
            [a.tenant_id, a.customer_id, reservationId],
          ),
        )
      ).rows.length
    )
      throw new AccessError(404, "reservation_not_found");
  }
  let count = 0;
  for (let i = 0; i < (reservationId ? 1 : 10); i++) {
    const job = await sampleWorker(f, (db) =>
      claimLoyaltyJob(db, reservationId ? "issue" : undefined, reservationId),
    );
    if (!job) break;
    await sampleWorker(f, async (db) => {
      const adapter = new LocalDiscountSimulator(db, timeout);
      if (job.kind === "issue") await issueReward(db, job, adapter, "sample");
      else if (job.kind === "deactivate")
        await deactivateReward(db, job, adapter, "sample");
      else throw new AccessError(409, "no_live_order_fetch_in_samples");
    });
    count++;
  }
  return {
    processed: count,
    message: count
      ? "Sample processing attempted. Check the wallet below: uncertain exchanges keep their hold until a later retry confirms the voucher. No Shopify request was made."
      : "No sample job is due yet. Uncertain jobs keep points reserved until their retry is due.",
  };
}
