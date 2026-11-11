import {
  catalogProductV1Schema,
  CATALOG_SHOP,
  type CatalogProductV1,
} from "@northside/customer-contracts";
import {
  catalogInputSchema,
  type CatalogInput,
  type MobileCatalog,
  type MobileProduct,
} from "@northside/customer-contracts/mvp";
import { MobileApi, MobileFailure } from "../api/client";

// A private snapshot is deliberately NOT a published Storefront response.
export type DraftProduct = Omit<CatalogProductV1, "publication"> & {
  publication: "draft";
};
export type PrivateCatalog = {
  version: "northside.private-catalog.v1";
  shop: typeof CATALOG_SHOP;
  capturedAt: string;
  expiresAt: string;
  products: DraftProduct[];
};
type DraftCatalog = {
  kind: "private-catalog";
  capturedAt: string;
  products: DraftProduct[];
  categories: string[];
  pageInfo: { hasNextPage: false; endCursor: null };
};
type DraftDetail = {
  kind: "private-product-detail";
  capturedAt: string;
  product: DraftProduct;
};
export type BrowseProduct = CatalogProductV1 | DraftProduct;
export type BrowseApi = Omit<
  Pick<MobileApi, "catalog" | "product" | "scan" | "info" | "releases">,
  "catalog" | "product"
> & {
  catalog(
    input?: CatalogInput,
    signal?: AbortSignal,
  ): Promise<MobileCatalog | DraftCatalog>;
  product(
    handle: string,
    after?: string,
    signal?: AbortSignal,
  ): Promise<MobileProduct | DraftDetail>;
};

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new Error("Invalid private catalog");
  return value as Record<string, unknown>;
}
function stamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("Invalid snapshot date");
  return value;
}
export function parsePrivateCatalog(
  value: unknown,
  now = Date.now(),
): PrivateCatalog {
  const root = object(value, [
    "version",
    "shop",
    "capturedAt",
    "expiresAt",
    "products",
  ]);
  if (
    root.version !== "northside.private-catalog.v1" ||
    root.shop !== CATALOG_SHOP
  )
    throw new Error("Wrong private catalog source");
  const capturedAt = stamp(root.capturedAt),
    expiresAt = stamp(root.expiresAt);
  if (
    Date.parse(capturedAt) > now + 300000 ||
    Date.parse(expiresAt) <= now ||
    Date.parse(expiresAt) <= Date.parse(capturedAt) ||
    Date.parse(expiresAt) - Date.parse(capturedAt) > 86400000
  )
    throw new Error("Private selection has expired");
  if (
    !Array.isArray(root.products) ||
    !root.products.length ||
    root.products.length > 6
  )
    throw new Error("Invalid private selection size");
  const shape = catalogProductV1Schema.shape;
  const products = root.products.map((raw): DraftProduct => {
    const item = object(raw, Object.keys(shape));
    if (item.publication !== "draft")
      throw new Error("Private selection must retain Draft status");
    // Validate each unchanged presentation field without broadening the public contract.
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(shape) as (keyof typeof shape)[])
      if (key !== "publication") fields[key] = shape[key].parse(item[key]);
    const p = { ...fields, publication: "draft" } as DraftProduct;
    if (
      !/^preview-[0-9a-f]{24}$/.test(p.handle) ||
      p.productPath !== `/shop/${p.handle}` ||
      p.availableForSale !== false ||
      p.onlineStoreUrl !== null ||
      p.selectedVariantId !== null ||
      !p.variants.nodes.length ||
      p.variants.after !== null ||
      p.variants.pageInfo.hasNextPage ||
      p.variants.pageInfo.endCursor !== null
    )
      throw new Error("Unsafe private product projection");
    const ids = new Set<string>();
    for (const v of p.variants.nodes) {
      if (
        v.productId !== p.id ||
        ids.has(v.id) ||
        v.availability.availableForSale ||
        v.availability.currentlyNotInStock ||
        v.availability.quantityAvailable !== null ||
        v.availability.state !== "unavailable" ||
        v.identifiers.state !== "not_provided"
      )
        throw new Error("Unsafe private variant projection");
      ids.add(v.id);
    }
    if (
      p.minVariantPrice.amountCents !==
      Math.min(...p.variants.nodes.map((v) => v.price.amountCents))
    )
      throw new Error("Private price mismatch");
    return p;
  });
  if (
    new Set(products.map((p) => p.id)).size !== products.length ||
    new Set(products.map((p) => p.handle)).size !== products.length
  )
    throw new Error("Duplicate private product");
  return {
    version: "northside.private-catalog.v1",
    shop: CATALOG_SHOP,
    capturedAt,
    expiresAt,
    products,
  };
}

/** Ephemeral read-only adapter. No HTTP, identity, cart, inventory or checkout methods. */
export class PrivateCatalogApi implements BrowseApi {
  private selection: PrivateCatalog | null;
  private deadline: number;
  constructor(selection: PrivateCatalog, now = Date.now()) {
    this.selection = parsePrivateCatalog(selection, now);
    this.deadline = Math.min(now + 1800000, Date.parse(selection.expiresAt));
  }
  dispose() {
    this.selection = null;
  }
  private read(signal?: AbortSignal) {
    if (signal?.aborted) throw new MobileFailure("cancelled");
    if (!this.selection || Date.now() >= this.deadline) {
      this.dispose();
      throw new MobileFailure("session_expired");
    }
    return this.selection;
  }
  async catalog(
    input: CatalogInput = {},
    signal?: AbortSignal,
  ): Promise<DraftCatalog> {
    const selected = this.read(signal),
      parsed = catalogInputSchema.parse(input);
    // An authenticated Draft snapshot cannot stand in for published arrivals.
    if (parsed.feed) throw new MobileFailure("not_configured");
    if (parsed.after) throw new MobileFailure("invalid_request");
    const needle = parsed.q?.toLocaleLowerCase("en-US");
    return {
      kind: "private-catalog",
      capturedAt: selected.capturedAt,
      products: selected.products.filter(
        (p) =>
          (!parsed.category || p.productType === parsed.category) &&
          (!needle ||
            [p.title, p.description, p.productType]
              .join(" ")
              .toLocaleLowerCase("en-US")
              .includes(needle)),
      ),
      categories: [
        ...new Set(selected.products.map((p) => p.productType).filter(Boolean)),
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }
  async product(
    handle: string,
    after?: string,
    signal?: AbortSignal,
  ): Promise<DraftDetail> {
    const selection = this.read(signal),
      product = selection.products.find((p) => p.handle === handle);
    if (!product || after) throw new MobileFailure("not_found");
    return {
      kind: "private-product-detail",
      capturedAt: selection.capturedAt,
      product,
    };
  }
  releases: MobileApi["releases"] = async () => {
    throw new MobileFailure("not_configured");
  };
  info: MobileApi["info"] = async () => {
    throw new MobileFailure("not_configured");
  };
  scan: MobileApi["scan"] = async () => {
    throw new MobileFailure("not_configured");
  };
}
