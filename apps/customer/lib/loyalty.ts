export type TierRule = { label: string; threshold_cents: number };
export type LoyaltyRules = {
  points_per_dollar: number;
  qualification_days: number;
  tiers: TierRule[];
  eligible_products: {
    id: string;
    kind: "retail" | "grading" | "consignment" | "break";
  }[];
  approved_service_kinds: ("grading" | "consignment" | "break")[];
  excluded_product_ids: string[];
  points_expiry: "none";
  rounding: "floor_per_line_cumulative";
  tier_returns: "reduce_original_period";
  refund_restoration: "manual_review";
};
export type RewardTerms = {
  title: string;
  minimum_cents: number;
  product_ids: string[];
  collection_ids: string[];
  expiry_days: number;
  combines: {
    orderDiscounts: boolean;
    productDiscounts: boolean;
    shippingDiscounts: boolean;
  };
};
export type LoyaltyRule = {
  id: string;
  version: number;
  parameters: LoyaltyRules;
  approved_by: string | null;
  effective_at: string | null;
  created_at: string;
  fixture: boolean;
};
export type LoyaltyReward = RewardTerms & {
  id: string;
  rule_id: string;
  points_cost: number;
  value_cents: number;
  active: boolean;
  currency: "USD";
};
export type LoyaltyOrderLine = {
  id: string;
  productId: string | null;
  variantId: string | null;
  isGiftCard: boolean;
  quantity: number;
  currentQuantity: number;
  originalNetCents: number;
  refundedCents: number;
  refundedQuantity: number;
  currentNetCents?: number;
};
export type LoyaltyOrder = {
  id: string;
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  financialStatus: string;
  cancelled: boolean;
  currency: "USD";
  channel: string;
  lines: LoyaltyOrderLine[];
  ambiguousRefund: boolean;
  discounts: { code: string; amountCents: number }[];
  campaignRef: string | null;
};
export type LoyaltyWallet = {
  state: "not_launched" | "not_enrolled" | "ready";
  rule: LoyaltyRule | null;
  balance: number | null;
  held: number;
  spendable: number;
  negative_review: boolean;
  enrolled_at: string | null;
  tier: {
    label: string;
    qualifying_cents: number;
    next: TierRule | null;
    period_start: string;
    period_end: string;
  } | null;
  rewards: LoyaltyReward[];
  ledger: {
    id: string;
    points: number;
    kind: string;
    reason: string;
    rule_id: string;
    created_at: string;
  }[];
  reservations: {
    id: string;
    status: string;
    points: number;
    created_at: string;
    snapshot: VoucherSnapshot;
  }[];
  vouchers: {
    id: string;
    reservation_id: string;
    code: string;
    status: string;
    issued_at: string;
    snapshot: VoucherSnapshot;
    used_cents: number;
    used_orders: number;
  }[];
};
export type VoucherSnapshot = RewardTerms & {
  rule_id: string;
  reward_id: string;
  customer_id: string;
  shopify_customer_id: string;
  points_cost: number;
  value_cents: number;
  currency: "USD";
  starts_at: string;
  ends_at: string;
};
export const loyaltyMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
