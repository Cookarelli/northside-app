import { describe, it, expect } from "vitest";
import {
  barcodeCandidates,
  expandUpce,
  matchCatalogScan,
  NORTHSIDE_NATIVE_SELECTION,
  validGtin,
} from "./native-scan";
import type { CatalogProductV1 } from "./catalog";

function product(p = NORTHSIDE_NATIVE_SELECTION[0]): CatalogProductV1 {
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
  it("preserves eight historical regression identities without an Optic example", () => {
    expect(NORTHSIDE_NATIVE_SELECTION).toHaveLength(8);
    expect(new Set(NORTHSIDE_NATIVE_SELECTION.map((p) => p.id)).size).toBe(8);
    expect(
      new Set(NORTHSIDE_NATIVE_SELECTION.map((p) => p.variantId)).size,
    ).toBe(8);
    expect(NORTHSIDE_NATIVE_SELECTION.every((p) => validGtin(p.barcode))).toBe(
      true,
    );
    expect(NORTHSIDE_NATIVE_SELECTION.some((p) => /optic/.test(p.handle))).toBe(
      false,
    );
    expect(NORTHSIDE_NATIVE_SELECTION[3].barcode).toBe("746134158551");
  });
  it("adds only the verified helmet after the unchanged seven original identities", () => {
    expect(NORTHSIDE_NATIVE_SELECTION.slice(0, 7).map((p) => p.id)).toEqual(
      [
        "15993233277297",
        "15993233375601",
        "15993233473905",
        "15993234522481",
        "15993234555249",
        "16135959413105",
        "15993268240753",
      ].map((id) => `gid://shopify/Product/${id}`),
    );
    const h = NORTHSIDE_NATIVE_SELECTION[7];
    expect(h).toEqual({
      id: "gid://shopify/Product/16135959970161",
      variantId: "gid://shopify/ProductVariant/68224353927537",
      barcode: "793397728021",
      handle:
        "2026-fanatics-under-wraps-replica-helmet-full-size-square-mghiqfcx",
    });
    const p = product(h);
    for (const [code, format] of [
      [h.barcode, "upc_a"],
      [h.barcode, "ean13"],
      ["0" + h.barcode, "ean13"],
      ["0" + h.barcode, "code128"],
      [h.barcode, undefined],
    ] as const)
      expect(matchCatalogScan([p], code, format).selectedVariantId).toBe(
        h.variantId,
      );
    p.variants.nodes[0].identifiers.sku = h.barcode;
    p.variants.nodes[0].identifiers.barcode = "DIFFERENT-BARCODE";
    expect(() => matchCatalogScan([p], h.barcode, "code128")).toThrow(
      "not_found",
    );
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
  it("rejects SKU-only matches and accepts checksum-proved iOS EAN alias without stripping arbitrary leading zeroes", () => {
    const p = product();
    expect(() => matchCatalogScan([p], "SKU-ONE", "code128")).toThrow(
      "not_found",
    );
    expect(
      matchCatalogScan([p], "0746134150968", "ean13").selectedVariantId,
    ).toBe(p.variants.nodes[0].id);
    expect(
      matchCatalogScan([p], "0746134150968", "code128").selectedVariantId,
    ).toBe(p.variants.nodes[0].id);
    expect(() => matchCatalogScan([p], "sku-one")).toThrow("not_found");
  });
  it("ignores another variant's SKU and rejects equivalent UPC/EAN barcode collisions", () => {
    const p = product(),
      other = product(NORTHSIDE_NATIVE_SELECTION[1]);
    other.variants.nodes[0].identifiers.sku =
      p.variants.nodes[0].identifiers.barcode;
    expect(
      matchCatalogScan([p, other], "746134150968", "upc_a").selectedVariantId,
    ).toBe(p.variants.nodes[0].id);
    other.variants.nodes[0].identifiers.barcode = "0746134150968";
    expect(() => matchCatalogScan([p, other], "746134150968", "upc_a")).toThrow(
      "ambiguous_scan",
    );
    for (const format of ["code128", undefined])
      expect(() =>
        matchCatalogScan([p, other], "0746134150968", format),
      ).toThrow("ambiguous_scan");
    expect(
      matchCatalogScan([other], "746134150968", "ean13").selectedVariantId,
    ).toBe(other.variants.nodes[0].id);
  });
  it.each(NORTHSIDE_NATIVE_SELECTION.slice(0, 6))(
    "resolves checksum-valid Code128/manual GTIN equivalents for $barcode",
    (selection) => {
      const p = product(selection);
      for (const format of ["code128", undefined]) {
        expect(
          matchCatalogScan([p], "0" + selection.barcode, format)
            .selectedVariantId,
        ).toBe(selection.variantId);
        expect(
          matchCatalogScan([p], selection.barcode, format).selectedVariantId,
        ).toBe(selection.variantId);
        expect(barcodeCandidates("0" + selection.barcode, format)).toEqual([
          "0" + selection.barcode,
          selection.barcode,
        ]);
      }
    },
  );
  it("never strips arbitrary zeros, fixes a bad checksum, or infers UPC-E from an unknown format", () => {
    for (const code of [
      "00746134150968",
      "0746134150969",
      "8003148023",
      "04252614",
      "000BOX-001",
    ])
      expect(barcodeCandidates(code, "code128")).toEqual([code]);
    expect(barcodeCandidates("0053334437622", "code128")).toEqual([
      "0053334437622",
      "053334437622",
    ]);
  });
  it("matches a literal Code128 barcode independently of its SKU", () => {
    const p = product();
    p.variants.nodes[0].identifiers.barcode = "000BOX-001";
    expect(
      matchCatalogScan([p], "000BOX-001", "code128").selectedVariantId,
    ).toBe(p.variants.nodes[0].id);
    expect(() => matchCatalogScan([p], "BOX-001", "code128")).toThrow(
      "not_found",
    );
    expect(() => matchCatalogScan([p], "SKU-ONE", "code128")).toThrow(
      "not_found",
    );
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
  it.each(NORTHSIDE_NATIVE_SELECTION.filter((p) => p.barcode.length === 12))(
    "accepts the installed iOS decoder's normalized UPC for $barcode",
    (selection) => {
      const p = product(selection);
      expect(
        matchCatalogScan([p], selection.barcode, "ean13").selectedVariantId,
      ).toBe(selection.variantId);
      expect(
        matchCatalogScan([p], "0" + selection.barcode, "ean13")
          .selectedVariantId,
      ).toBe(selection.variantId);
    },
  );
  it("resolves Golf's leading-zero manufacturer UPC and legacy QR without SKU substitution by stable IDs", () => {
    const selection = NORTHSIDE_NATIVE_SELECTION[6];
    expect(selection).toMatchObject({
      id: "gid://shopify/Product/15993268240753",
      variantId: "gid://shopify/ProductVariant/64522039460209",
      barcode: "053334437622",
      handle: "2026-upper-deck-allure-golf-hobby-box-regular",
    });
    const p = product(selection);
    p.title = "2026 Upper Deck Golf Hobby Box";
    p.variants.nodes[0].identifiers.sku = "92840090001065";
    const url = `https://9i3hnb-jw.myshopify.com/products/${selection.handle}`;
    expect(matchCatalogScan([p], url, "qr").selectedVariantId).toBe(
      selection.variantId,
    );
    expect(
      matchCatalogScan([p], selection.barcode, "code128").selectedVariantId,
    ).toBe(selection.variantId);
    expect(matchCatalogScan([p], selection.barcode).selectedVariantId).toBe(
      selection.variantId,
    );
    expect(
      matchCatalogScan([p], "053334437622", "upc_a").selectedVariantId,
    ).toBe(selection.variantId);
    expect(
      matchCatalogScan([p], "0053334437622", "ean13").selectedVariantId,
    ).toBe(selection.variantId);
    expect(() => matchCatalogScan([p], "92840090001065", "code128")).toThrow(
      "not_found",
    );
    expect(() => matchCatalogScan([p], "53334437622", "code128")).toThrow(
      "not_found",
    );
    expect(() => matchCatalogScan([p], "92840090001065", "ean13")).toThrow(
      "invalid_request",
    );
    expect(() => matchCatalogScan([p], "92840090001065", "upc_a")).toThrow(
      "invalid_request",
    );
    expect(() => matchCatalogScan([p], selection.barcode, "qr")).toThrow(
      "invalid_request",
    );
    expect(() =>
      matchCatalogScan([p], url + "?variant=64522039525745", "qr"),
    ).toThrow("not_found");
    expect(() => matchCatalogScan([], url, "qr")).toThrow("not_found");
  });
  it("retains checksum and exact-identity checks for normalized iOS UPCs", () => {
    expect(() =>
      matchCatalogScan([product()], "746134150969", "ean13"),
    ).toThrow("invalid_request");
    expect(() =>
      matchCatalogScan([product()], "195166245478", "ean13"),
    ).toThrow("not_found");
    expect(() => barcodeCandidates("74613415096", "ean13")).toThrow(
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
  it("resolves the existing Monopoly ESL short QR only against its fresh approved identity", () => {
    const p = product(NORTHSIDE_NATIVE_SELECTION[4]);
    const url = "https://9i3hnb-jw.myshopify.com/m";
    expect(matchCatalogScan([p], url, "qr").selectedVariantId).toBe(
      p.variants.nodes[0].id,
    );
    expect(matchCatalogScan([p], url).selectedVariantId).toBe(
      p.variants.nodes[0].id,
    );
    expect(() => matchCatalogScan([], url, "qr")).toThrow("not_found");
    for (const change of [
      "product",
      "handle",
      "variant",
      "barcode",
      "publication",
    ]) {
      const changed = structuredClone(p);
      if (change === "product") changed.id = "gid://shopify/Product/999";
      if (change === "handle") changed.handle = "another-product";
      if (change === "variant")
        changed.variants.nodes[0].id = "gid://shopify/ProductVariant/999";
      if (change === "barcode")
        changed.variants.nodes[0].identifiers.barcode = "746134150968";
      // Deliberately malformed provider data at this runtime boundary.
      if (change === "publication")
        Object.assign(changed, { publication: "unknown" });
      expect(() => matchCatalogScan([changed], url, "qr")).toThrow("not_found");
    }
  });
  it.each([
    "https://9i3hnb-jw.myshopify.com/m/",
    "https://9i3hnb-jw.myshopify.com/m?variant=64521956655473",
    "https://9i3hnb-jw.myshopify.com/m?redirect=https://evil.example",
    "https://9i3hnb-jw.myshopify.com/m#fragment",
    "https://user@9i3hnb-jw.myshopify.com/m",
    "http://9i3hnb-jw.myshopify.com/m",
    "https://evil.example/m",
    "https://9i3hnb-jw.myshopify.com/M",
  ])("does not broaden the exact ESL short QR alias: %s", (url) => {
    expect(() =>
      matchCatalogScan([product(NORTHSIDE_NATIVE_SELECTION[4])], url, "qr"),
    ).toThrow("unsupported_qr");
  });
  it("does not treat the ESL hardware barcode as merchandise", () => {
    expect(() =>
      matchCatalogScan(
        [product(NORTHSIDE_NATIVE_SELECTION[4])],
        "8003147344",
        "code128",
      ),
    ).toThrow("not_found");
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
  it("rejects duplicate barcodes instead of choosing the first variant", () => {
    const p = product(),
      other = structuredClone(p);
    other.id = "gid://shopify/Product/999";
    other.variants.nodes[0].id = "gid://shopify/ProductVariant/999";
    expect(() =>
      matchCatalogScan([p, other], p.variants.nodes[0].identifiers.barcode!),
    ).toThrow("ambiguous_scan");
    expect(() => matchCatalogScan([p], "SKU-ONE\n")).toThrow("invalid_request");
    expect(() => matchCatalogScan([p], "SKU-ONE", "pdf417")).toThrow(
      "invalid_request",
    );
  });
});

it("a product QR without variant cannot select one variant from a partial page", () => {
  const p = product(),
    url = `https://9i3hnb-jw.myshopify.com/products/${p.handle}`;
  p.variants.pageInfo = { hasNextPage: true, endCursor: "next-variant-page" };
  expect(() => matchCatalogScan([p], url, "qr")).toThrow("not_found");
  p.variants.pageInfo = { hasNextPage: false, endCursor: null };
  p.variants.after = "previous-page";
  expect(() => matchCatalogScan([p], url, "qr")).toThrow("not_found");
  expect(
    matchCatalogScan(
      [p],
      `${url}?variant=${p.variants.nodes[0].id.split("/").at(-1)}`,
      "qr",
    ).selectedVariantId,
  ).toBe(p.variants.nodes[0].id);
});
