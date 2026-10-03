import "server-only";
import { type Query } from "./storefront";
import { cents, gid } from "./shopify-config";
import { AccessError } from "./security";
import type { LoyaltyOrder } from "../loyalty";
import { integer } from "./loyalty";
type Bag = { shopMoney: { amount: string; currencyCode: string } };
type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean } };
type RefundLine = {
  lineItem: { id: string };
  quantity: number;
  subtotalSet: Bag;
  totalTaxSet: Bag;
};
type Allocation = {
  allocatedAmountSet: Bag;
  discountApplication: { __typename: string; code?: string };
};
type RawOrder = {
  id: string;
  customer: { id: string } | null;
  createdAt: string;
  updatedAt: string;
  displayFinancialStatus: string;
  cancelledAt: string | null;
  currencyCode: string;
  sourceName: string;
  taxesIncluded: boolean;
  test: boolean;
  customAttributes: { key: string; value: string }[];
  transactions: { kind: string; status: string; processedAt: string | null }[];
  lineItems: Page<{
    id: string;
    product: { id: string } | null;
    variant: { id: string } | null;
    isGiftCard: boolean;
    quantity: number;
    currentQuantity: number;
    originalTotalSet: Bag;
    priceAfterAllDiscountsBeforeTaxesSet: Bag;
    discountAllocations: Allocation[];
    sellingPlan: unknown;
  }>;
  refunds: {
    id: string;
    totalRefundedSet: Bag;
    refundLineItems: Page<RefundLine>;
    refundShippingLines: Page<{ subtotalAmountSet: Bag; taxAmountSet: Bag }>;
    orderAdjustments: Page<{ id: string }>;
    transactions: Page<{ kind: string; status: string; amountSet: Bag }>;
  }[];
};
const money = `shopMoney { amount currencyCode }`,
  page = `pageInfo { hasNextPage }`;
export async function fetchLoyaltyOrder(
  query: Query,
  id: string,
): Promise<LoyaltyOrder> {
  gid(id, "Order");
  const data = await query<{ order: RawOrder | null }>(
    `query LoyaltyOrder($id:ID!) { order(id:$id) { id customer { id } createdAt updatedAt displayFinancialStatus cancelledAt currencyCode sourceName taxesIncluded test customAttributes { key value } transactions(first:250) { kind status processedAt } lineItems(first:250) { ${page} nodes { id product { id } variant { id } isGiftCard quantity currentQuantity originalTotalSet { ${money} } priceAfterAllDiscountsBeforeTaxesSet { ${money} } sellingPlan { name } discountAllocations { allocatedAmountSet { ${money} } discountApplication { __typename ... on DiscountCodeApplication { code } } } } } refunds(first:100) { id transactions(first:250) { ${page} nodes { kind status amountSet { ${money} } } } totalRefundedSet { ${money} } refundLineItems(first:250) { ${page} nodes { lineItem { id } quantity subtotalSet { ${money} } totalTaxSet { ${money} } } } refundShippingLines(first:100) { ${page} nodes { subtotalAmountSet { ${money} } taxAmountSet { ${money} } } } orderAdjustments(first:1) { ${page} nodes { id } } } } }`,
    { id },
  );
  const o = data.order;
  if (
    !o ||
    o.id !== id ||
    o.currencyCode !== "USD" ||
    o.lineItems.pageInfo.hasNextPage ||
    o.refunds.length >= 100 ||
    o.transactions.length >= 250
  )
    throw new AccessError(503, "complete_order_snapshot_required");
  if (
    !Number.isFinite(Date.parse(o.updatedAt)) ||
    !Number.isFinite(Date.parse(o.createdAt))
  )
    throw new AccessError(503, "invalid_provider_timestamp");
  const refunds = new Map<string, { cents: number; quantity: number }>();
  let ambiguous = o.taxesIncluded || o.test;
  for (const r of o.refunds) {
    if (
      r.refundLineItems.pageInfo.hasNextPage ||
      r.refundShippingLines.pageInfo.hasNextPage ||
      r.orderAdjustments.nodes.length ||
      r.orderAdjustments.pageInfo.hasNextPage
    )
      ambiguous = true;
    let attributed = 0;
    for (const l of r.refundLineItems.nodes) {
      const old = refunds.get(l.lineItem.id) || { cents: 0, quantity: 0 };
      integer(l.quantity);
      const net = cents(l.subtotalSet.shopMoney);
      old.cents += net;
      old.quantity += l.quantity;
      refunds.set(l.lineItem.id, old);
      attributed += net + cents(l.totalTaxSet.shopMoney);
    }
    for (const s of r.refundShippingLines.nodes)
      attributed +=
        cents(s.subtotalAmountSet.shopMoney) + cents(s.taxAmountSet.shopMoney);
    if (attributed !== cents(r.totalRefundedSet.shopMoney)) ambiguous = true;
    if (
      !r.transactions ||
      r.transactions.pageInfo.hasNextPage ||
      r.transactions.nodes.some(
        (t) => t.kind !== "REFUND" || t.status !== "SUCCESS",
      ) ||
      r.transactions.nodes.reduce(
        (n, t) => n + cents(t.amountSet.shopMoney),
        0,
      ) !== cents(r.totalRefundedSet.shopMoney)
    )
      ambiguous = true;
  }
  const discounts = new Map<string, number>();
  const lines = o.lineItems.nodes.map((l) => {
    gid(l.id, "LineItem");
    integer(l.quantity, 1);
    integer(l.currentQuantity);
    if (l.sellingPlan) ambiguous = true;
    let discount = 0;
    for (const d of l.discountAllocations) {
      const n = cents(d.allocatedAmountSet.shopMoney);
      discount += n;
      if (
        d.discountApplication.__typename === "DiscountCodeApplication" &&
        d.discountApplication.code
      ) {
        const code = d.discountApplication.code.toUpperCase();
        discounts.set(code, (discounts.get(code) || 0) + n);
      }
    }
    const original = cents(l.originalTotalSet.shopMoney) - discount;
    if (original < 0)
      throw new AccessError(503, "invalid_line_discount_allocation");
    const refunded = refunds.get(l.id) || { cents: 0, quantity: 0 };
    refunds.delete(l.id);
    return {
      id: l.id,
      productId: l.product ? gid(l.product.id, "Product") : null,
      variantId: l.variant ? gid(l.variant.id, "ProductVariant") : null,
      isGiftCard: l.isGiftCard,
      quantity: l.quantity,
      currentQuantity: l.currentQuantity,
      originalNetCents: original,
      currentNetCents: cents(l.priceAfterAllDiscountsBeforeTaxesSet.shopMoney),
      refundedCents: refunded.cents,
      refundedQuantity: refunded.quantity,
    };
  });
  if (refunds.size) ambiguous = true;
  const paid = o.transactions
    .filter(
      (t) =>
        t.status === "SUCCESS" &&
        ["SALE", "CAPTURE"].includes(t.kind) &&
        t.processedAt,
    )
    .map((t) => t.processedAt!)
    .filter((t) => Number.isFinite(Date.parse(t)))
    .sort();
  // Only the opaque consent reference written by the server is eligible for later aggregate attribution; not identity.
  const campaign = o.customAttributes.find(
    (x) => x.key === "ns_first_campaign",
  )?.value;
  return {
    id: o.id,
    customerId: o.customer ? gid(o.customer.id, "Customer") : null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    paidAt: paid[0] || null,
    financialStatus: o.displayFinancialStatus,
    cancelled: !!o.cancelledAt,
    currency: "USD",
    channel: o.sourceName === "pos" ? "pos" : "online_or_other",
    lines,
    ambiguousRefund: ambiguous,
    discounts: [...discounts].map(([code, amountCents]) => ({
      code,
      amountCents,
    })),
    campaignRef:
      campaign && /^[A-Za-z0-9_-]{22,64}$/.test(campaign) ? campaign : null,
  };
}
