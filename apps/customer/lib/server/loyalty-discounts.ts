import "server-only";
import type { VoucherSnapshot } from "../loyalty";
import type { Query } from "./storefront";
import { gid, cents } from "./shopify-config";
import { AccessError } from "./security";
import { validateReward } from "./loyalty";
import { SHOP } from "./providers";
// Prepared for a future authorized POS staff surface. No QR or scanner is enabled.
export function futurePosRewardUrl(code: string) {
  if (!/^NS[A-F0-9]{40}$/.test(code))
    throw new AccessError(400, "invalid_reward_code");
  return `https://${SHOP}/discount/${code}`;
}
type Money = { amount: string; currencyCode: string };
type Connection = {
  nodes: { id: string }[];
  pageInfo: { hasNextPage: boolean };
};
export type DiscountEvidence = {
  id: string;
  code: string;
  status: string;
  usageCount: number;
  snapshot: VoucherSnapshot;
};
export interface LoyaltyDiscountAdapter {
  readonly kind: "shopify" | "sample";
  lookup(
    code: string,
    snapshot: VoucherSnapshot,
    forCancellation?: boolean,
  ): Promise<DiscountEvidence | null>;
  create(
    code: string,
    snapshot: VoucherSnapshot,
  ): Promise<
    | { state: "created"; evidence: DiscountEvidence }
    | { state: "rejected" }
    | { state: "uncertain" }
  >;
  deactivate(id: string): Promise<boolean>;
}
type Node = {
  id: string;
  codeDiscount: {
    __typename: string;
    title: string;
    codes: { nodes: { code: string }[]; pageInfo: { hasNextPage: boolean } };
    context: { __typename: string; customers?: { id: string }[] };
    usageLimit: number;
    appliesOncePerCustomer: boolean;
    startsAt: string;
    endsAt: string | null;
    status: string;
    asyncUsageCount: number;
    combinesWith: VoucherSnapshot["combines"];
    minimumRequirement: {
      __typename: string;
      greaterThanOrEqualToSubtotal?: Money;
    };
    customerGets: {
      items: {
        __typename: string;
        products?: Connection;
        productVariants?: Connection;
        collections?: Connection;
      };
      value: {
        __typename: string;
        amount?: Money;
        appliesOnEachItem?: boolean;
      };
    };
  };
};
const fields = `id codeDiscount { __typename ... on DiscountCodeBasic { title codes(first:2) { nodes { code } pageInfo { hasNextPage } } context { __typename ... on DiscountCustomers { customers { id } } } usageLimit appliesOncePerCustomer startsAt endsAt status asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } minimumRequirement { __typename ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } } customerGets { value { __typename ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem } } items { __typename ... on DiscountProducts { products(first:101) { nodes { id } pageInfo { hasNextPage } } productVariants(first:1) { nodes { id } pageInfo { hasNextPage } } } ... on DiscountCollections { collections(first:101) { nodes { id } pageInfo { hasNextPage } } } } } } }`;
export function discountInput(code: string, s: VoucherSnapshot) {
  if (!/^NS[A-F0-9]{40}$/.test(code))
    throw new AccessError(400, "invalid_reward_code");
  validateReward(s, s.value_cents);
  gid(s.shopify_customer_id, "Customer");
  return {
    title: s.title,
    code,
    context: { customers: { add: [s.shopify_customer_id] } },
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    usageLimit: 1,
    appliesOncePerCustomer: true,
    combinesWith: s.combines,
    minimumRequirement: {
      subtotal: {
        greaterThanOrEqualToSubtotal: (s.minimum_cents / 100).toFixed(2),
      },
    },
    customerGets: {
      value: {
        discountAmount: {
          amount: (s.value_cents / 100).toFixed(2),
          appliesOnEachItem: false,
        },
      },
      items: s.product_ids.length
        ? { products: { productsToAdd: s.product_ids } }
        : { collections: { add: s.collection_ids } },
    },
  };
}
function sameIds(c: Connection | undefined, expected: string[]) {
  return (
    !!c &&
    !c.pageInfo.hasNextPage &&
    JSON.stringify(c.nodes.map((n) => n.id).sort()) ===
      JSON.stringify([...expected].sort())
  );
}
export function validateDiscount(
  node: Node,
  code: string,
  s: VoucherSnapshot,
  forCancellation = false,
): DiscountEvidence {
  const d = node.codeDiscount,
    v = d?.customerGets?.value,
    items = d?.customerGets?.items,
    min = d?.minimumRequirement;
  const match =
    d?.__typename === "DiscountCodeBasic" &&
    d.title === s.title &&
    d.codes.nodes.length === 1 &&
    !d.codes.pageInfo.hasNextPage &&
    d.codes.nodes[0].code === code &&
    d.context.__typename === "DiscountCustomers" &&
    d.context.customers?.length === 1 &&
    d.context.customers[0].id === s.shopify_customer_id &&
    d.usageLimit === 1 &&
    d.appliesOncePerCustomer === true &&
    Date.parse(d.startsAt) === Date.parse(s.starts_at) &&
    (Date.parse(d.endsAt || "") === Date.parse(s.ends_at) ||
      (forCancellation &&
        d.status === "EXPIRED" &&
        Date.parse(d.endsAt || "") <= Date.now() &&
        Date.parse(d.endsAt || "") <= Date.parse(s.ends_at))) &&
    ["ACTIVE", "SCHEDULED", "EXPIRED"].includes(d.status) &&
    Number.isInteger(d.asyncUsageCount) &&
    d.asyncUsageCount >= 0 &&
    Object.entries(s.combines).every(
      ([k, v]) => d.combinesWith[k as keyof typeof s.combines] === v,
    ) &&
    min?.__typename === "DiscountMinimumSubtotal" &&
    min.greaterThanOrEqualToSubtotal &&
    cents(min.greaterThanOrEqualToSubtotal) === s.minimum_cents &&
    v?.__typename === "DiscountAmount" &&
    v.amount &&
    cents(v.amount) === s.value_cents &&
    v.appliesOnEachItem === false &&
    (s.product_ids.length
      ? items.__typename === "DiscountProducts" &&
        sameIds(items.products, s.product_ids) &&
        sameIds(items.productVariants, [])
      : items.__typename === "DiscountCollections" &&
        sameIds(items.collections, s.collection_ids));
  if (!match) throw new AccessError(409, "voucher_contract_mismatch_review");
  return {
    id: gid(node.id, "DiscountCodeNode"),
    code,
    status: d.status,
    usageCount: d.asyncUsageCount,
    snapshot: s,
  };
}
export class ShopifyLoyaltyDiscountAdapter implements LoyaltyDiscountAdapter {
  readonly kind = "shopify" as const;
  constructor(private query: Query) {}
  async lookup(code: string, s: VoucherSnapshot, forCancellation = false) {
    const data = await this.query<{ codeDiscountNodeByCode: Node | null }>(
      `query LoyaltyCode($code:String!) { codeDiscountNodeByCode(code:$code) { ${fields} } }`,
      { code },
    );
    if (data.codeDiscountNodeByCode === null) return null;
    if (!data.codeDiscountNodeByCode)
      throw new AccessError(503, "discount_lookup_uncertain");
    return validateDiscount(
      data.codeDiscountNodeByCode,
      code,
      s,
      forCancellation,
    );
  }
  async create(
    code: string,
    s: VoucherSnapshot,
  ): ReturnType<LoyaltyDiscountAdapter["create"]> {
    try {
      const data = await this.query<{
        discountCodeBasicCreate: {
          codeDiscountNode: Node | null;
          userErrors: { code: string; field: string[]; message: string }[];
        };
      }>(
        `mutation IssueLoyaltyCode($input:DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount:$input) { codeDiscountNode { ${fields} } userErrors { code field message } } }`,
        { input: discountInput(code, s) },
      );
      const r = data.discountCodeBasicCreate;
      if (!r || !Array.isArray(r.userErrors)) return { state: "uncertain" };
      if (r.userErrors.length)
        return {
          state:
            r.codeDiscountNode || r.userErrors.some((e) => e.code === "TAKEN")
              ? "uncertain"
              : "rejected",
        };
      if (!r.codeDiscountNode) return { state: "uncertain" };
      return {
        state: "created",
        evidence: validateDiscount(r.codeDiscountNode, code, s),
      };
    } catch {
      return { state: "uncertain" };
    }
  }
  async deactivate(id: string) {
    const data = await this.query<{
      discountCodeDeactivate: {
        codeDiscountNode: {
          id: string;
          codeDiscount: { status: string };
        } | null;
        userErrors: unknown[];
      };
    }>(
      `mutation StopLoyaltyCode($id:ID!) { discountCodeDeactivate(id:$id) { codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic { status } } } userErrors { field message } } }`,
      { id: gid(id, "DiscountCodeNode") },
    );
    const r = data.discountCodeDeactivate;
    return (
      !!r &&
      r.userErrors.length === 0 &&
      r.codeDiscountNode?.id === id &&
      r.codeDiscountNode.codeDiscount.status === "EXPIRED"
    );
  }
}
