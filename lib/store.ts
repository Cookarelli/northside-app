export const inventoryPools = {
  retail: "Northside Retail Floor",
  breaker: "Northside Breaker Storage",
  excess: "Northside Excess Storage",
} as const;
export type Pool = keyof typeof inventoryPools;
export type Aisle = {
  id: string;
  number: number;
  label: string;
  sides: string[];
  categories: string[];
  x: number | null;
  y: number | null;
  active: boolean;
  version: number;
};
export type StoreNode = {
  id: string;
  label: string;
  kind: "entrance" | "service_counter" | "path";
  x: number;
  y: number;
  active: boolean;
  version: number;
};
export type StoreLocation = {
  id: string;
  pool: Pool;
  label: string;
  aisle_id: string | null;
  side: string | null;
  zone: string;
  categories: string[];
  approved_retail: boolean;
  active: boolean;
  version: number;
};
export type StoreProduct = {
  id: string;
  shopify_product_id: string;
  title: string;
  family: string;
  handle: string;
  fixture: boolean;
  version: number;
};
export type StoreVariant = {
  id: string;
  product_id: string;
  shopify_variant_id: string;
  sku: string;
  barcode: string | null;
  verified: boolean;
  evidence: string;
  version: number;
};
export type StoreQR = {
  id: string;
  token: string;
  product_id: string;
  variant_id: string | null;
  placement_id: string | null;
  campaign_key: string | null;
  destination: "product" | "retail_locator";
  active: boolean;
  version: number;
};
export type RetailProduct = {
  id: string;
  product_id: string;
  title: string;
  handle: string;
  fixture: boolean;
  variants: {
    id: string;
    variant_id: string;
    sku: string;
    locations: {
      label: string;
      zone: string;
      side: string | null;
      aisle: string | null;
    }[];
  }[];
};
export type ScanResult = {
  product: RetailProduct;
  selected_variant: string | null;
  campaign_key: string | null;
  destination: string;
  availability: {
    checked_at: string;
    source: "sample" | "shopify";
    variants: {
      id: string;
      title: string;
      available: boolean;
      quantity: number | null;
      price: { amount: string; currencyCode: string };
    }[];
  };
};
export type ScanInput = {
  kind: "qr" | "barcode" | "handle";
  value: string;
  variant?: string;
};
export function parseScan(
  input: unknown,
  origin: string,
  sample = false,
): ScanInput {
  if (
    typeof input !== "string" ||
    input.length > 2048 ||
    !input.trim() ||
    /[\u0000-\u001f\u007f]/.test(input)
  )
    throw Error("malformed_scan");
  const raw = input.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw))
    return { kind: "barcode", value: raw };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw Error("unsupported_code_use_manual_search");
  }
  if (u.username || u.password || u.hash)
    throw Error("unsupported_code_use_manual_search");
  const prefix = sample ? "/q/sample/" : "/q/";
  if (u.origin === origin && u.pathname.startsWith(prefix) && !u.search) {
    const token = u.pathname.slice(prefix.length);
    if (/^[A-Za-z0-9_-]{24}$/.test(token) && raw === origin + prefix + token)
      return { kind: "qr", value: token };
    throw Error("malformed_northside_code");
  }
  if (
    u.origin === "https://9i3hnb-jw.myshopify.com" &&
    /^\/products\/[a-z0-9][a-z0-9-]{0,149}$/.test(u.pathname) &&
    [...u.searchParams.keys()].every((k) => k === "variant") &&
    u.searchParams.getAll("variant").length <= 1
  ) {
    const variant = u.searchParams.get("variant");
    if (variant !== null && !/^[1-9][0-9]{0,29}$/.test(variant))
      throw Error("missing_or_invalid_variant");
    return {
      kind: "handle",
      value: u.pathname.slice(10),
      ...(variant
        ? { variant: "gid://shopify/ProductVariant/" + variant }
        : {}),
    };
  }
  throw Error(
    u.hostname.includes("shopify")
      ? "shopcode_not_a_verified_cart_item"
      : "foreign_or_unsupported_code",
  );
}
export class ScanDeduplicator {
  private last = "";
  private at = 0;
  accept(code: string, now = Date.now()) {
    if (code === this.last && now - this.at < 3000) return false;
    this.last = code;
    this.at = now;
    return true;
  }
  clear() {
    this.last = "";
    this.at = 0;
  }
}
export const pickupStates = [
  "paid",
  "preparing",
  "ready",
  "collected",
  "canceled",
] as const;
export function pickupNext(current: string, next: string) {
  return (
    (
      {
        paid: ["preparing", "canceled"],
        preparing: ["ready", "canceled"],
        ready: ["collected", "canceled"],
        collected: [],
        canceled: [],
      } as Record<string, string[]>
    )[current]?.includes(next) || false
  );
}
