import test from "node:test";
import assert from "node:assert/strict";
import {
  discountInput,
  validateDiscount,
  ShopifyLoyaltyDiscountAdapter,
  futurePosRewardUrl,
} from "../lib/server/loyalty-discounts";
import { fetchLoyaltyOrder } from "../lib/server/loyalty-orders";
import { applyDiscount } from "../lib/server/storefront";
import type { Query } from "../lib/server/storefront";
import type { VoucherSnapshot } from "../lib/loyalty";
import { previewId } from "../lib/server/grading-preview";
const code = "NS" + "A".repeat(40),
  money = (n: string) => ({ amount: n, currencyCode: "USD" }),
  bag = (n: string) => ({ shopMoney: money(n) }),
  page = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false } });
const snapshot: VoucherSnapshot = {
  title: "SAMPLE $5 reward",
  rule_id: previewId(1),
  reward_id: previewId(2),
  customer_id: previewId(3),
  shopify_customer_id: "gid://shopify/Customer/1",
  points_cost: 500,
  value_cents: 500,
  currency: "USD",
  minimum_cents: 1000,
  product_ids: ["gid://shopify/Product/1"],
  collection_ids: [],
  expiry_days: 30,
  starts_at: "2026-09-01T00:00:00.000Z",
  ends_at: "2026-10-01T00:00:00.000Z",
  combines: {
    orderDiscounts: false,
    productDiscounts: false,
    shippingDiscounts: false,
  },
};
const node = () => ({
  id: "gid://shopify/DiscountCodeNode/1",
  codeDiscount: {
    __typename: "DiscountCodeBasic",
    title: snapshot.title,
    codes: page([{ code }]),
    context: {
      __typename: "DiscountCustomers",
      customers: [{ id: snapshot.shopify_customer_id }],
    },
    usageLimit: 1,
    appliesOncePerCustomer: true,
    startsAt: snapshot.starts_at,
    endsAt: snapshot.ends_at,
    status: "ACTIVE",
    asyncUsageCount: 0,
    combinesWith: { ...snapshot.combines },
    minimumRequirement: {
      __typename: "DiscountMinimumSubtotal",
      greaterThanOrEqualToSubtotal: money("10.00"),
    },
    customerGets: {
      value: {
        __typename: "DiscountAmount",
        amount: money("5.00"),
        appliesOnEachItem: false,
      },
      items: {
        __typename: "DiscountProducts",
        products: page([{ id: "gid://shopify/Product/1" }]),
        productVariants: page([]),
      },
    },
  },
});
test("Shopify loyalty contract: modern customer context, one-use fixed value, minimum eligible spend and exact response checks", () => {
  assert.equal(
    futurePosRewardUrl(code),
    `https://9i3hnb-jw.myshopify.com/discount/${code}`,
  );
  assert.throws(() => futurePosRewardUrl("A/B?customer=1"));
  const input = discountInput(code, snapshot);
  assert.deepEqual(input.context, {
    customers: { add: [snapshot.shopify_customer_id] },
  });
  assert.ok(!("customerSelection" in input));
  assert.equal(input.usageLimit, 1);
  assert.equal(
    input.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal,
    "10.00",
  );
  assert.equal(
    validateDiscount(node(), code, snapshot).id,
    "gid://shopify/DiscountCodeNode/1",
  );
  for (const change of [
    (n: ReturnType<typeof node>) => {
      n.codeDiscount.context.customers[0].id = "gid://shopify/Customer/2";
    },
    (n: ReturnType<typeof node>) => {
      n.codeDiscount.usageLimit = 2;
    },
    (n: ReturnType<typeof node>) => {
      n.codeDiscount.customerGets.value.amount.amount = "3.00";
    },
    (n: ReturnType<typeof node>) => {
      n.codeDiscount.minimumRequirement.greaterThanOrEqualToSubtotal.amount =
        "1.00";
    },
    (n: ReturnType<typeof node>) => {
      n.codeDiscount.combinesWith.orderDiscounts = true;
    },
    (n: ReturnType<typeof node>) => {
      n.codeDiscount.customerGets.items.products.pageInfo.hasNextPage = true;
    },
  ]) {
    const n = node();
    change(n);
    assert.throws(() => validateDiscount(n, code, snapshot));
  }
  assert.throws(() => discountInput(code, { ...snapshot, minimum_cents: 400 }));
  assert.throws(() =>
    discountInput(code, {
      ...snapshot,
      combines: { ...snapshot.combines, productDiscounts: true },
    }),
  );
  const cancelled = node();
  cancelled.codeDiscount.status = "EXPIRED";
  cancelled.codeDiscount.endsAt = "2026-09-01T00:00:00.000Z";
  assert.throws(() => validateDiscount(cancelled, code, snapshot));
  assert.equal(
    validateDiscount(cancelled, code, snapshot, true).status,
    "EXPIRED",
  );
});
test("Shopify loyalty contract: network uncertainty and userErrors differ; lookup validates before recovery", async () => {
  let command = "";
  const q: Query = async <T>(query: string) => {
    command = query;
    return {
      discountCodeBasicCreate: { codeDiscountNode: node(), userErrors: [] },
    } as T;
  };
  assert.equal(
    (await new ShopifyLoyaltyDiscountAdapter(q).create(code, snapshot)).state,
    "created",
  );
  assert.match(command, /discountCodeBasicCreate/);
  assert.match(command, /context/);
  const failed: Query = async <T>() =>
    ({
      discountCodeBasicCreate: {
        codeDiscountNode: null,
        userErrors: [{ code: "INVALID", field: ["input"], message: "invalid" }],
      },
    }) as T;
  assert.equal(
    (await new ShopifyLoyaltyDiscountAdapter(failed).create(code, snapshot))
      .state,
    "rejected",
  );
  const timed: Query = async () => {
    throw Error("timeout");
  };
  assert.equal(
    (await new ShopifyLoyaltyDiscountAdapter(timed).create(code, snapshot))
      .state,
    "uncertain",
  );
  const looked: Query = async <T>() =>
    ({ codeDiscountNodeByCode: node() }) as T;
  assert.equal(
    (await new ShopifyLoyaltyDiscountAdapter(looked).lookup(code, snapshot))
      ?.code,
    code,
  );
});
const rawOrder = () => ({
  id: "gid://shopify/Order/1",
  customer: { id: "gid://shopify/Customer/1" },
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  displayFinancialStatus: "PARTIALLY_REFUNDED",
  cancelledAt: null,
  currencyCode: "USD",
  sourceName: "pos",
  taxesIncluded: false,
  test: false,
  customAttributes: [],
  transactions: [
    { kind: "SALE", status: "SUCCESS", processedAt: "2026-09-01T00:01:00Z" },
  ],
  lineItems: page([
    {
      id: "gid://shopify/LineItem/1",
      product: { id: "gid://shopify/Product/1" },
      variant: { id: "gid://shopify/ProductVariant/1" },
      isGiftCard: false,
      quantity: 2,
      currentQuantity: 1,
      originalTotalSet: bag("20.00"),
      priceAfterAllDiscountsBeforeTaxesSet: bag("7.50"),
      discountAllocations: [
        {
          allocatedAmountSet: bag("5.00"),
          discountApplication: { __typename: "DiscountCodeApplication", code },
        },
      ],
      sellingPlan: null,
    },
  ]),
  refunds: [
    {
      id: "gid://shopify/Refund/1",
      transactions: page([
        { kind: "REFUND", status: "SUCCESS", amountSet: bag("8.10") },
      ]),
      totalRefundedSet: bag("8.10"),
      refundLineItems: page([
        {
          lineItem: { id: "gid://shopify/LineItem/1" },
          quantity: 1,
          subtotalSet: bag("7.50"),
          totalTaxSet: bag("0.60"),
        },
      ]),
      refundShippingLines: page([]),
      orderAdjustments: page([]),
    },
  ],
});
test("Shopify loyalty order contract: authoritative net line allocation, POS identity, refunds and unknown attribution", async () => {
  const raw = rawOrder(),
    q: Query = async <T>() => ({ order: raw }) as T;
  const o = await fetchLoyaltyOrder(q, raw.id);
  assert.equal(o.lines[0].originalNetCents, 1500);
  assert.equal(o.lines[0].currentNetCents, 750);
  assert.equal(o.lines[0].refundedCents, 750);
  assert.equal(o.ambiguousRefund, false);
  assert.equal(o.discounts[0].amountCents, 500);
  assert.equal(o.channel, "pos");
  raw.refunds[0].totalRefundedSet = bag("10.00");
  assert.equal((await fetchLoyaltyOrder(q, raw.id)).ambiguousRefund, true);
  raw.lineItems.pageInfo.hasNextPage = true;
  await assert.rejects(
    fetchLoyaltyOrder(q, raw.id),
    /complete_order_snapshot_required/,
  );
});
test("Storefront reward application: owner token, applicability, stacking and unsupported cart errors", async () => {
  const cart = {
    id: "gid://shopify/Cart/sample",
    totalQuantity: 1,
    cost: {
      subtotalAmount: money("10.00"),
      totalAmount: money("10.00"),
      totalAmountEstimated: false,
    },
    lines: page([]),
    discountCodes: [] as { code: string; applicable: boolean }[],
  };
  let applies = false,
    warning = false;
  const calls: string[] = [];
  const q: Query = async <T>(query: string, variables: object) => {
    calls.push(query);
    if (query.includes("query Cart")) return { cart } as T;
    if (query.includes("cartBuyerIdentityUpdate"))
      return {
        cartBuyerIdentityUpdate: { cart, userErrors: [], warnings: [] },
      } as T;
    assert.deepEqual((variables as { codes: string[] }).codes, [code]);
    return {
      cartDiscountCodesUpdate: {
        cart: { ...cart, discountCodes: [{ code, applicable: applies }] },
        userErrors: [],
        warnings: warning ? [{ code: "UNSUPPORTED" }] : [],
      },
    } as T;
  };
  assert.equal(
    (await applyDiscount(q, cart.id, code, "verified-owner-token")).applicable,
    false,
  );
  applies = true;
  assert.equal(
    (await applyDiscount(q, cart.id, code, "verified-owner-token")).applicable,
    true,
  );
  await assert.rejects(
    applyDiscount(q, cart.id, code, ""),
    /owned_reward_required/,
  );
  warning = true;
  await assert.rejects(
    applyDiscount(q, cart.id, code, "token"),
    /cart_changed_review_required/,
  );
  cart.discountCodes = [{ code: "OTHER", applicable: true }];
  await assert.rejects(
    applyDiscount(q, cart.id, code, "token"),
    /review_existing_cart_discounts/,
  );
  assert.ok(calls.some((q) => q.includes("cartBuyerIdentityUpdate")));
});
