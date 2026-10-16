import "server-only";
import { createHash } from "node:crypto";
import { type Sql, type Actor, requireRole } from "./db";
import { TENANT, SHOP } from "./providers";
import { AccessError } from "./security";
import { integer, shortText, uuid } from "./loyalty";
import { gid } from "./shopify-config";
import {
  eventLock,
  exception,
  breakAudit,
  timestamp,
  modeCheck,
  type BreakMode,
} from "./breaks";
import type { BreakMapping, BreakPurchase } from "../breaks";
import type { LoyaltyOrder } from "../loyalty";
export async function allocationCount(db: Sql, mapping: string) {
  return Number(
    (
      await db.query<{ n: string }>(
        "select count(*) n from ns.break_allocations where tenant_id=$1 and mapping_id=$2 and active",
        [TENANT, mapping],
      )
    ).rows[0].n,
  );
}
async function allocate(
  db: Sql,
  p: BreakPurchase,
  m: BreakMapping,
  quantity: number,
) {
  if (!p.customer_id || quantity < 1) return false;
  // The caller holds the event lock. A partial unique index also prevents a competing grant.
  const used = (
    await db.query<{ slot: number }>(
      "select slot from ns.break_allocations where tenant_id=$1 and mapping_id=$2 and (active or purchase_id=$3)",
      [TENANT, m.id, p.id],
    )
  ).rows.map((x) => x.slot);
  const free = Array.from({ length: m.capacity }, (_, i) => i + 1).filter(
    (n) => !used.includes(n),
  );
  if (free.length < quantity) return false;
  for (const slot of free.slice(0, quantity))
    await db.query(
      "insert into ns.break_allocations(tenant_id,event_id,mapping_id,purchase_id,customer_id,slot) values($1,$2,$3,$4,$5,$6)",
      [TENANT, m.event_id, m.id, p.id, p.customer_id, slot],
    );
  return true;
}
async function history(
  db: Sql,
  p: BreakPurchase,
  source: string,
  status: string,
  current: number,
) {
  await db.query(
    "insert into ns.break_purchase_events(tenant_id,purchase_id,customer_id,event_id,source_id,details) values($1,$2,$3,$4,$5,$6) on conflict do nothing",
    [
      TENANT,
      p.id,
      p.customer_id,
      p.event_id,
      source,
      JSON.stringify({
        status,
        quantity: current,
        note: "Paid order reconciliation. Refunds and cancellations retain spot capacity for staff review.",
      }),
    ],
  );
}
export async function reconcileBreakOrder(
  db: Sql,
  o: LoyaltyOrder,
  mode: BreakMode = "live",
) {
  const fixture = modeCheck(mode);
  gid(o.id, "Order");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    TENANT + "/break-order/" + o.id,
  ]);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(o))
    .digest("hex");
  const prior = (
    await db.query<{
      fingerprint: string;
      provider_updated_at: string;
      state: string;
    }>(
      "select * from ns.break_orders where tenant_id=$1 and order_id=$2 for update",
      [TENANT, o.id],
    )
  ).rows[0];
  if (
    prior &&
    new Date(prior.provider_updated_at).getTime() > Date.parse(o.updatedAt)
  )
    return { state: "stale_ignored" };
  if (
    prior &&
    new Date(prior.provider_updated_at).getTime() === Date.parse(o.updatedAt) &&
    prior.fingerprint !== fingerprint
  ) {
    await exception(
      db,
      TENANT,
      null,
      o.id,
      "conflicting_snapshot",
      o.id + "/" + fingerprint,
      "Two different current snapshots have the same provider version; recheck Shopify.",
    );
    return { state: "review" };
  }
  const customer = o.customerId
    ? (
        await db.query<{ customer_id: string }>(
          "select customer_id from ns.shopify_customers where tenant_id=$1 and shop=$2 and shopify_id=$3",
          [TENANT, SHOP, o.customerId],
        )
      ).rows[0]?.customer_id
    : null;
  const mappings = (
    await db.query<BreakMapping & { fixture: boolean }>(
      "select m.*,e.fixture from ns.shopify_spot_mappings m join ns.break_events e on e.tenant_id=m.tenant_id and e.id=m.event_id where m.tenant_id=$1",
      [TENANT],
    )
  ).rows;
  const mapped = o.lines.some((l) =>
    mappings.some((m) => m.variant_id === l.variantId),
  );
  let state = mapped ? "reconciled" : "no_mapped_spots";
  const previousPurchases = (
    await db.query<BreakPurchase>(
      "select * from ns.break_purchases where tenant_id=$1 and source='shopify' and source_order=$2",
      [TENANT, o.id],
    )
  ).rows;
  // Lock events in stable order to avoid deadlocks for orders containing several breaks.
  const eventIds = [
    ...new Set([
      ...previousPurchases.map((p) => p.event_id),
      ...o.lines.flatMap((l) =>
        mappings
          .filter((m) => m.variant_id === l.variantId)
          .map((m) => m.event_id),
      ),
    ]),
  ].sort();
  for (const id of eventIds) await eventLock(db, TENANT, id);
  for (const p of previousPurchases) {
    if (
      !o.lines.some(
        (l) =>
          l.id === p.source_line &&
          mappings.some(
            (m) => m.id === p.mapping_id && m.variant_id === l.variantId,
          ),
      )
    ) {
      state = "review";
      await exception(
        db,
        TENANT,
        p.event_id,
        o.id,
        "paid_line_missing",
        o.id + "/" + p.source_line + "/" + fingerprint,
        "Previously paid mapped line is absent or changed. Retain capacity and review the current Shopify order.",
      );
      await db.query(
        "update ns.break_purchases set status='review',updated_at=now() where tenant_id=$1 and id=$2",
        [TENANT, p.id],
      );
    }
  }
  for (const line of o.lines) {
    const m = mappings.find((m) => m.variant_id === line.variantId);
    if (!m) {
      if (mapped || mappings.some((m) => m.product_id === line.productId)) {
        state = "review";
        await exception(
          db,
          TENANT,
          null,
          o.id,
          "unknown_variant",
          o.id + "/" + line.id + "/unknown",
          "Unmapped order line: " +
            line.id +
            ". Verify the exact paid variant; no spot granted.",
        );
      }
      continue;
    }
    if (m.fixture !== fixture)
      throw new AccessError(409, "fixture_live_mapping_mismatch");
    const e = await eventLock(db, TENANT, m.event_id);
    let p = (
      await db.query<BreakPurchase>(
        "select * from ns.break_purchases where tenant_id=$1 and source='shopify' and source_order=$2 and source_line=$3 for update",
        [TENANT, o.id, line.id],
      )
    ).rows[0];
    const amounts = [
      line.quantity,
      line.currentQuantity,
      line.refundedQuantity,
      line.originalNetCents,
      line.refundedCents,
    ];
    if (
      amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      line.quantity < 1 ||
      line.quantity > 500 ||
      line.currentQuantity > line.quantity ||
      line.refundedQuantity > line.quantity ||
      line.refundedCents > line.originalNetCents
    ) {
      state = "review";
      await exception(
        db,
        TENANT,
        m.event_id,
        o.id,
        "malformed_line",
        o.id + "/" + line.id + "/" + fingerprint,
        "Unsupported quantity or amount in current paid line. No new allocation.",
      );
      if (p)
        await db.query(
          "update ns.break_purchases set status='review',updated_at=now() where tenant_id=$1 and id=$2",
          [TENANT, p.id],
        );
      continue;
    }
    const validPaid =
      !!o.paidAt &&
      ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.financialStatus);
    let review =
      o.ambiguousRefund ||
      line.isGiftCard ||
      line.productId !== m.product_id ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 500 ||
      line.currentQuantity < 0 ||
      line.currentQuantity > line.quantity ||
      line.refundedQuantity < 0 ||
      line.refundedQuantity > line.quantity ||
      line.refundedCents < 0 ||
      line.refundedCents > line.originalNetCents;
    if (line.refundedCents > 0 && line.refundedQuantity === 0) review = true;
    if (!validPaid) {
      if (p || o.paidAt) {
        state = "review";
        await exception(
          db,
          TENANT,
          m.event_id,
          o.id,
          "payment_state",
          o.id + "/" + fingerprint + "/payment",
          "Current payment state needs review. Existing allocations retained.",
        );
        if (p)
          await db.query(
            "update ns.break_purchases set status='review',updated_at=now() where tenant_id=$1 and id=$2",
            [TENANT, p.id],
          );
      } else if (state !== "review") state = "awaiting_payment";
      continue;
    }
    const remaining = o.cancelled
      ? 0
      : Math.min(line.currentQuantity, line.quantity - line.refundedQuantity);
    if (o.financialStatus === "REFUNDED" && remaining > 0) review = true;
    let status = review
      ? "review"
      : o.cancelled
        ? "canceled"
        : remaining === 0
          ? "refunded"
          : remaining < line.quantity
            ? "partially_refunded"
            : "confirmed";
    if (!p) {
      p = (
        await db.query<BreakPurchase>(
          "insert into ns.break_purchases(tenant_id,event_id,mapping_id,customer_id,source,source_order,source_line,quantity,current_quantity,status,paid_at,amount_cents) values($1,$2,$3,$4,'shopify',$5,$6,$7,$8,'review',$9,$10) returning *",
          [
            TENANT,
            m.event_id,
            m.id,
            customer || null,
            o.id,
            line.id,
            integer(line.quantity, 1, 500),
            remaining,
            o.paidAt,
            integer(line.originalNetCents),
          ],
        )
      ).rows[0];
    } else if (
      p.quantity !== line.quantity ||
      p.mapping_id !== m.id ||
      (p.customer_id && p.customer_id !== customer) ||
      remaining > p.current_quantity
    ) {
      review = true;
      status = "review";
    }
    if (!p.customer_id && customer) {
      await db.query(
        "update ns.break_purchases set customer_id=$3 where tenant_id=$1 and id=$2",
        [TENANT, p.id, customer],
      );
      p = { ...p, customer_id: customer };
    }
    if (!p.customer_id) {
      review = true;
      status = "review";
    }
    const previousAlloc = (
      await db.query<{ n: string }>(
        "select count(*) n from ns.break_allocations where tenant_id=$1 and purchase_id=$2",
        [TENANT, p.id],
      )
    ).rows[0];
    if (!review && remaining > 0 && Number(previousAlloc.n) === 0) {
      if (
        !m.active ||
        e.status === "canceled" ||
        e.started_at ||
        !(await allocate(db, p, m, remaining))
      ) {
        review = true;
        status = "review";
      }
    }
    if (e.status === "canceled" && remaining > 0) {
      review = true;
      status = "review";
    }
    if (review || remaining < line.quantity) {
      state = "review";
      await exception(
        db,
        TENANT,
        m.event_id,
        o.id,
        review ? "allocation_review" : "refund_restock_review",
        o.id + "/" + line.id + "/" + fingerprint,
        "Review current payment, ownership and spot capacity. Existing allocations stay held; no automatic restock.",
      );
    }
    await db.query(
      "update ns.break_purchases set current_quantity=$3,status=$4,updated_at=now() where tenant_id=$1 and id=$2",
      [
        TENANT,
        p.id,
        review ? Math.min(p.current_quantity, remaining) : remaining,
        status,
      ],
    );
    await history(db, p, fingerprint, status, remaining);
  }
  await db.query(
    "insert into ns.break_orders(tenant_id,order_id,snapshot,provider_updated_at,fingerprint,state) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,order_id) do update set snapshot=excluded.snapshot,provider_updated_at=excluded.provider_updated_at,fingerprint=excluded.fingerprint,state=excluded.state,updated_at=now()",
    [
      TENANT,
      o.id,
      JSON.stringify(o),
      timestamp(o.updatedAt),
      fingerprint,
      state,
    ],
  );
  return { state };
}
export async function legacyPurchase(
  db: Sql,
  a: Actor,
  input: {
    mapping_id: string;
    customer_id: string;
    reference: string;
    evidence: string;
    quantity: number;
    amount_cents: number;
    paid_at: string;
  },
  reason: string,
) {
  requireRole(a, ["owner", "admin", "operations"]);
  const m = (
    await db.query<BreakMapping>(
      "select * from ns.shopify_spot_mappings where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(input.mapping_id)],
    )
  ).rows[0];
  if (!m) throw new AccessError(404, "mapping_not_found");
  const e = await eventLock(db, a.tenant_id, m.event_id);
  if (e.started_at || ["complete", "canceled"].includes(e.status))
    throw new AccessError(409, "legacy_intake_closed");
  const customer = uuid(input.customer_id),
    reference = shortText(input.reference, 120),
    evidence = shortText(input.evidence, 2000),
    quantity = integer(input.quantity, 1, m.capacity);
  if (
    !(
      await db.query<{ ok: boolean }>("select ns.grading_verified($1,$2) ok", [
        a.tenant_id,
        customer,
      ])
    ).rows[0].ok
  )
    throw new AccessError(409, "verified_customer_required");
  const old = (
    await db.query<BreakPurchase>(
      "select * from ns.break_purchases where tenant_id=$1 and source='legacy' and source_order=$2 and source_line=$3",
      [a.tenant_id, reference, m.id],
    )
  ).rows[0];
  if (old) {
    if (
      old.customer_id !== customer ||
      old.quantity !== quantity ||
      Number(old.amount_cents) !== input.amount_cents
    )
      throw new AccessError(
        409,
        "external_reference_already_used_with_different_purchase",
      );
    return old;
  }
  const p = (
    await db.query<BreakPurchase>(
      "insert into ns.break_purchases(tenant_id,event_id,mapping_id,customer_id,source,source_order,source_line,quantity,current_quantity,status,paid_at,amount_cents,legacy_evidence) values($1,$2,$3,$4,'legacy',$5,$3::uuid::text,$6,$6,'confirmed',$7,$8,$9) returning *",
      [
        a.tenant_id,
        m.event_id,
        m.id,
        customer,
        reference,
        quantity,
        timestamp(input.paid_at),
        integer(input.amount_cents),
        evidence,
      ],
    )
  ).rows[0];
  if (!(await allocate(db, p, m, quantity)))
    throw new AccessError(409, "spot_capacity_already_held");
  await db.query(
    "update ns.break_events set sale_open=false where tenant_id=$1 and id=$2",
    [a.tenant_id, m.event_id],
  );
  await history(db, p, "legacy-recorded", "confirmed", quantity);
  await breakAudit(db, a, m.event_id, "legacy.recorded", reason, null, {
    purchase: p.id,
    reference,
    evidence,
  });
  return p;
}
export async function reviewPurchase(
  db: Sql,
  a: Actor,
  id: string,
  action: "release" | "void-legacy",
  quantity: number,
  reason: string,
) {
  requireRole(a, ["owner", "admin", "operations"]);
  shortText(reason);
  let p = (
    await db.query<BreakPurchase>(
      "select * from ns.break_purchases where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(id)],
    )
  ).rows[0];
  if (!p) throw new AccessError(404, "purchase_not_found");
  const e = await eventLock(db, a.tenant_id, p.event_id);
  p = (
    await db.query<BreakPurchase>(
      "select * from ns.break_purchases where tenant_id=$1 and id=$2 for update",
      [a.tenant_id, p.id],
    )
  ).rows[0];
  if (action === "void-legacy") {
    if (p.source !== "legacy")
      throw new AccessError(
        409,
        "shopify_refunds_require_current_provider_evidence",
      );
    await db.query(
      "update ns.break_purchases set current_quantity=0,status='canceled',updated_at=now() where tenant_id=$1 and id=$2",
      [a.tenant_id, p.id],
    );
    await history(db, p, "legacy-void", "canceled", 0);
  } else {
    if (
      e.started_at ||
      !e.starts_at ||
      Date.parse(e.starts_at) <= Date.now() ||
      !["scheduled", "delayed"].includes(e.status)
    )
      throw new AccessError(409, "started_or_unscheduled_spots_cannot_reopen");
    if (!["refunded", "canceled", "partially_refunded"].includes(p.status))
      throw new AccessError(409, "verified_refund_required");
    const held = (
      await db.query<{ id: string }>(
        "select id from ns.break_allocations where tenant_id=$1 and purchase_id=$2 and active order by slot desc for update",
        [a.tenant_id, p.id],
      )
    ).rows;
    integer(quantity, 1, held.length - p.current_quantity);
    for (const x of held.slice(0, quantity))
      await db.query(
        "update ns.break_allocations set active=false where tenant_id=$1 and id=$2",
        [a.tenant_id, x.id],
      );
  }
  await db.query(
    "update ns.break_events set sale_open=false where tenant_id=$1 and id=$2",
    [a.tenant_id, p.event_id],
  );
  await breakAudit(db, a, p.event_id, "purchase." + action, reason, null, {
    purchase: id,
    quantity,
  });
}
