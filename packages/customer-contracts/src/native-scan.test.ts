import { describe, it, expect } from "vitest";
import {
  barcodeCandidates,
  expandUpce,
  matchCatalogScan,
  NORTHSIDE_NATIVE_SELECTION,
  validGtin,
} from "./native-scan";
import type { CatalogProductV1 } from "./catalog";

function product(): CatalogProductV1 {
  const p = NORTHSIDE_NATIVE_SELECTION[0];
  return {
    id: p.id,
    handle: p.handle,
    title: "SYNTHETIC scanner contract",
    description: "",
    productType: "Basketball",
    publication: "published",
    availableForSale: true,
    featuredImage: null,
    minVariantPrice: { amountCents: 6995, currencyCode: "USD" },
    variants: {
      nodes: [
        {
          id: p.variantId,
          productId: p.id,
          title: "Base",
          identifiers: {
            state: "observed",
            sku: "SKU-ONE",
            barcode: p.barcode,
          },
          price: { amountCents: 6995, currencyCode: "USD" },
          availability: {
            state: "unknown",
            availableForSale: true,
            currentlyNotInStock: false,
            quantityAvailable: null,
          },
        },
      ],
      after: null,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    selectedVariantId: null,
    productPath: `/shop/${p.handle}`,
    onlineStoreUrl: null,
  };
}
describe("real-label scanner identity boundary", () => {
  it("keeps all six exact unique product/variant/UPC identities and excludes Optic", () => {
    expect(NORTHSIDE_NATIVE_SELECTION).toHaveLength(6);
    expect(new Set(NORTHSIDE_NATIVE_SELECTION.map((p) => p.id)).size).toBe(6);
    expect(
      new Set(NORTHSIDE_NATIVE_SELECTION.map((p) => p.variantId)).size,
    ).toBe(6);
    expect(NORTHSIDE_NATIVE_SELECTION.every((p) => validGtin(p.barcode))).toBe(
      true,
    );
    expect(NORTHSIDE_NATIVE_SELECTION.some((p) => /optic/.test(p.handle))).toBe(
      false,
    );
    expect(NORTHSIDE_NATIVE_SELECTION[3].barcode).toBe("746134158551");
  });
  it.each([undefined, "upc_a", "code128", "code39"])(
    "matches an exact approved barcode with %s",
    (format) => {
      const p = product();
      expect(
        matchCatalogScan([p], "746134150968", format).selectedVariantId,
      ).toBe(p.variants.nodes[0].id);
    },
  );
  it("matches exact SKU and checksum-proved iOS EAN alias without stripping arbitrary leading zeroes", () => {
    const p = product();
    expect(matchCatalogScan([p], "SKU-ONE", "code128").selectedVariantId).toBe(
      p.variants.nodes[0].id,
    );
    expect(
      matchCatalogScan([p], "0746134150968", "ean13").selectedVariantId,
    ).toBe(p.variants.nodes[0].id);
    expect(() => matchCatalogScan([p], "0746134150968", "code128")).toThrow(
      "not_found",
    );
    expect(() => matchCatalogScan([p], "sku-one")).toThrow("not_found");
  });
  it("expands valid UPC-E and validates EAN-8 checksums", () => {
    expect(expandUpce("04252614")).toBe("042100005264");
    expect(barcodeCandidates("04252614", "upc_e")).toContain("042100005264");
    expect(barcodeCandidates("96385074", "ean8")).toEqual(["96385074"]);
    expect(() => barcodeCandidates("04252615", "upc_e")).toThrow(
      "invalid_request",
    );
    expect(() => barcodeCandidates("0746134150969", "ean13")).toThrow(
      "invalid_request",
    );
  });
  it("maps approved product QR and exact variant without navigating to the URL", () => {
    const p = product(),
      url = `https://9i3hnb-jw.myshopify.com/products/${p.handle}`;
    expect(matchCatalogScan([p], url, "qr").selectedVariantId).toBe(
      p.variants.nodes[0].id,
    );
    expect(
      matchCatalogScan([p], url + "?variant=64521944891761").selectedVariantId,
    ).toBe(p.variants.nodes[0].id);
    expect(() => matchCatalogScan([p], url + "?variant=999")).toThrow(
      "not_found",
    );
  });
  it.each([
    "https://evil.example/products/x",
    "https://9i3hnb-jw.myshopify.com.evil.example/products/x",
    "https://user:secret@9i3hnb-jw.myshopify.com/products/x",
    "https://9i3hnb-jw.myshopify.com/products/x#fragment",
    "https://9i3hnb-jw.myshopify.com/products/x?redirect=https://evil.example",
    "https://northside.example/q/abcdefghijklmnopqrstuvwx",
    "javascript:alert(1)",
  ])("refuses an unsupported URL: %s", (value) => {
    expect(() => matchCatalogScan([product()], value, "qr")).toThrow();
  });
  it("rejects SKU/barcode collisions instead of choosing the first variant", () => {
    const p = product(),
      other = structuredClone(p);
    other.id = "gid://shopify/Product/999";
    other.variants.nodes[0].id = "gid://shopify/ProductVariant/999";
    expect(() => matchCatalogScan([p, other], "SKU-ONE")).toThrow(
      "ambiguous_scan",
    );
    expect(() => matchCatalogScan([p], "SKU-ONE\n")).toThrow("invalid_request");
    expect(() => matchCatalogScan([p], "SKU-ONE", "pdf417")).toThrow(
      "invalid_request",
    );
  });
});
