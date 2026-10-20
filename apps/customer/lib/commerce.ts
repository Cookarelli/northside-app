export type Money = { amount: string; currencyCode: string };
export type PageInfo = { hasNextPage: boolean; endCursor: string | null };
export type Connection<T> = { nodes: T[]; pageInfo: PageInfo };
export type Variant = {
  id: string;
  title: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  currentlyNotInStock: boolean;
  price: Money;
};
export type Merchandise = {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  availableForSale: boolean;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: Money };
  variants: Connection<Variant>;
};
export type CartLine = {
  id: string;
  quantity: number;
  merchandise: Variant & { product: { title: string; handle: string } };
  cost: { totalAmount: Money };
};
// Shopify cart IDs (including their secret key) belong only in server storage.
export type CartView = {
  lines: Connection<CartLine>;
  totalQuantity: number;
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
    totalAmountEstimated: boolean;
  };
  discountCodes: { code: string; applicable: boolean }[];
};
export type Cart = CartView & { id: string; checkoutUrl?: string };
export type Browse = {
  q?: string;
  category?: string;
  collection?: string;
  after?: string;
  collectionsAfter?: string;
};
export function shopLink(input: Browse) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value) p.set(key, value);
  return `/shop${p.size ? `?${p}` : ""}`;
}
export function formatMoney(value: Money) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: value.currencyCode,
  }).format(Number(value.amount));
}
export function safeShopBack(value: unknown) {
  if (typeof value !== "string" || value.length > 2500) return "/shop";
  try {
    const url = new URL(value, "https://northside.invalid");
    if (
      url.origin !== "https://northside.invalid" ||
      url.pathname !== "/shop" ||
      url.hash
    )
      return "/shop";
    const p = new URLSearchParams();
    for (const key of [
      "q",
      "category",
      "collection",
      "after",
      "collectionsAfter",
      "page",
    ]) {
      const v = url.searchParams.get(key);
      if (v) p.set(key, v);
    }
    return `/shop${p.size ? `?${p}` : ""}`;
  } catch {
    return "/shop";
  }
}
