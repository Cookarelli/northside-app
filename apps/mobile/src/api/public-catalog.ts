import {
  CATALOG_SHOP,
  CATALOG_SHOPIFY_API_VERSION,
  catalogProductV1Schema,
  type CatalogProductV1,
} from "@northside/customer-contracts";
import { MOBILE_CONTRACT_VERSION } from "@northside/customer-contracts/mobile";
import {
  catalogInputSchema,
  mobileCatalogSchema,
  mobileProductSchema,
  type CatalogInput,
} from "@northside/customer-contracts/mvp";
import { boundedText, MobileFailure, type MobileApi } from "./client";
import type { BrowseApi } from "../private-preview/catalog";

export { NORTHSIDE_NATIVE_SELECTION as PREVIEW_CATALOG_SELECTION } from "../../../../packages/customer-contracts/src/native-scan";
import {
  NORTHSIDE_NATIVE_SELECTION as PREVIEW_CATALOG_SELECTION,
  matchCatalogScan,
} from "../../../../packages/customer-contracts/src/native-scan";

export const PUBLIC_CATALOG_ENDPOINT = `https://${CATALOG_SHOP}/api/${CATALOG_SHOPIFY_API_VERSION}/graphql.json`;
export const PUBLIC_CATALOG_QUERY = `query NorthsidePreviewCatalog($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id handle title description productType publishedAt availableForSale
      featuredImage { url altText }
      priceRange { minVariantPrice { amount currencyCode } }
      variants(first: 2) {
        nodes {
          id title sku barcode availableForSale currentlyNotInStock
          price { amount currencyCode }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MobileFailure("invalid_response");
  return value as Record<string, unknown>;
}
function money(value: unknown) {
  const v = object(value);
  if (
    v.currencyCode !== "USD" ||
    typeof v.amount !== "string" ||
    !/^(0|[1-9][0-9]{0,10})(\.[0-9]{1,2})?$/.test(v.amount)
  )
    throw new MobileFailure("invalid_response");
  const [whole, fraction = ""] = v.amount.split(".");
  return {
    amountCents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
    currencyCode: "USD" as const,
  };
}
function project(
  value: unknown,
  expected: (typeof PREVIEW_CATALOG_SELECTION)[number],
): { product: CatalogProductV1; verified: boolean } {
  const p = object(value),
    variants = object(p.variants),
    page = object(variants.pageInfo);
  if (
    p.id !== expected.id ||
    p.handle !== expected.handle ||
    typeof p.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(p.publishedAt)) ||
    Date.parse(p.publishedAt) > Date.now() ||
    !Array.isArray(variants.nodes) ||
    variants.nodes.length !== 1 ||
    page.hasNextPage !== false
  )
    throw new MobileFailure("invalid_response");
  const v = object(variants.nodes[0]);
  if (
    v.id !== expected.variantId ||
    typeof v.availableForSale !== "boolean" ||
    typeof v.currentlyNotInStock !== "boolean"
  )
    throw new MobileFailure("invalid_response");
  const parsed = catalogProductV1Schema.safeParse({
    id: p.id,
    handle: p.handle,
    title: p.title,
    description: p.description,
    productType: p.productType,
    publication: "published",
    availableForSale: p.availableForSale,
    featuredImage: p.featuredImage,
    minVariantPrice: money(object(p.priceRange).minVariantPrice),
    variants: {
      nodes: [
        {
          id: v.id,
          productId: p.id,
          title: v.title,
          identifiers: { state: "observed", sku: v.sku, barcode: v.barcode },
          price: money(v.price),
          availability: {
            state:
              !v.availableForSale || v.currentlyNotInStock
                ? "unavailable"
                : "unknown",
            availableForSale: v.availableForSale,
            currentlyNotInStock: v.currentlyNotInStock,
            quantityAvailable: null,
          },
        },
      ],
      after: null,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    selectedVariantId: null,
    productPath: `/shop/${expected.handle}`,
    onlineStoreUrl: null,
  });
  if (!parsed.success) throw new MobileFailure("invalid_response");
  return { product: parsed.data, verified: v.barcode === expected.barcode };
}

/** Tokenless public product reads; no accounts, scan lookup, cart or checkout. */
export class PublicCatalogApi implements BrowseApi {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 12000,
    private readonly scanFallback?: Pick<MobileApi, "scan">,
  ) {}

  private async read(
    selection: readonly (typeof PREVIEW_CATALOG_SELECTION)[number][],
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new MobileFailure("cancelled");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.request(PUBLIC_CATALOG_ENDPOINT, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: PUBLIC_CATALOG_QUERY,
          variables: { ids: selection.map((p) => p.id) },
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new MobileFailure("cancelled");
      if (!response.ok) throw new MobileFailure("service_unavailable");
      if (
        response.headers.get("x-shopify-api-version") !==
          CATALOG_SHOPIFY_API_VERSION ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new MobileFailure("invalid_response");
      const payload = object(JSON.parse(await boundedText(response)));
      if (controller.signal.aborted) throw new MobileFailure("cancelled");
      if (payload.errors !== undefined)
        throw new MobileFailure("service_unavailable");
      const nodes = object(payload.data).nodes;
      if (!Array.isArray(nodes) || nodes.length !== selection.length)
        throw new MobileFailure("invalid_response");
      // Null means not publicly visible, never a fabricated sold-out listing.
      return nodes.flatMap((p, i) =>
        p === null ? [] : [project(p, selection[i])],
      );
    } catch (error) {
      if (timedOut) throw new MobileFailure("timeout");
      if (signal?.aborted) throw new MobileFailure("cancelled");
      if (error instanceof MobileFailure) throw error;
      throw new MobileFailure(
        error instanceof SyntaxError ? "invalid_response" : "offline",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  private observation() {
    const now = Date.now();
    return {
      observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
    };
  }
  async catalog(input: CatalogInput = {}, signal?: AbortSignal) {
    const parsed = catalogInputSchema.safeParse(input);
    if (!parsed.success || input.after)
      throw new MobileFailure("invalid_request");
    if (input.feed) throw new MobileFailure("not_configured");
    const products = (await this.read(PREVIEW_CATALOG_SELECTION, signal))
      .filter((record) => record.verified)
      .map((record) => record.product);
    const terms = (input.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = products.filter(
      (p) =>
        (!input.category || p.productType === input.category) &&
        terms.every((term) =>
          [
            p.title,
            p.description,
            p.productType,
            ...p.variants.nodes.flatMap((v) => [
              v.identifiers.sku,
              v.identifiers.barcode,
            ]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(term),
        ),
    );
    return mobileCatalogSchema.parse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "catalog",
      products: filtered,
      categories: [
        ...new Set(products.map((p) => p.productType).filter(Boolean)),
      ].sort(),
      pageInfo: { hasNextPage: false, endCursor: null },
      ...this.observation(),
    });
  }
  async product(handle: string, after?: string, signal?: AbortSignal) {
    const selected = PREVIEW_CATALOG_SELECTION.find((p) => p.handle === handle);
    if (!selected || after) throw new MobileFailure("not_found");
    const records = await this.read([selected], signal);
    if (!records.length) throw new MobileFailure("not_found");
    if (!records[0].verified) throw new MobileFailure("invalid_response");
    return mobileProductSchema.parse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "product-detail",
      product: records[0].product,
      ...this.observation(),
    });
  }
  scan: BrowseApi["scan"] = async (code, signal, format) => {
    const records = await this.read(PREVIEW_CATALOG_SELECTION, signal);
    try {
      // Keep drifted records' claims in the index: filtering first could hide
      // a barcode/SKU collision and select the wrong otherwise-verified item.
      const product = matchCatalogScan(
        records.map((record) => record.product),
        code,
        format,
      );
      if (
        !records.some(
          (record) => record.verified && record.product.id === product.id,
        )
      )
        throw new MobileFailure("invalid_response");
      return mobileProductSchema.parse({
        contractVersion: MOBILE_CONTRACT_VERSION,
        kind: "product-detail",
        product,
        ...this.observation(),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "unsupported_qr" &&
        this.scanFallback
      )
        return this.scanFallback.scan(code, signal, format);
      throw new MobileFailure(
        error instanceof Error &&
          [
            "invalid_request",
            "unsupported_qr",
            "ambiguous_scan",
            "not_found",
          ].includes(error.message)
          ? error.message
          : "invalid_response",
      );
    }
  };
  info: BrowseApi["info"] = async () => {
    throw new MobileFailure("not_configured");
  };
  releases: BrowseApi["releases"] = async () => {
    throw new MobileFailure("not_configured");
  };
}
