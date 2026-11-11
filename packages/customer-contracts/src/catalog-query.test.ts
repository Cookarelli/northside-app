import { describe, expect, it } from "vitest";
import {
  catalogBrowseRequestV1Schema,
  validateCatalogBrowseRequestV1,
  type CatalogBrowseRequestV1,
} from "./catalog-query";

describe("mobile catalog browse request v1", () => {
  it.each([
    {},
    { q: "Pikachu 2026" },
    { category: "Sports Cards" },
    { q: "ルーキー", category: "Sports Cards" },
    { collection: "trading-cards", category: "Sports Cards" },
  ])("accepts supported discovery filters: %j", (input) => {
    expect(validateCatalogBrowseRequestV1(input)).toEqual({
      success: true,
      data: input,
    });
  });

  it("keeps product and collection cursors independent and opaque", () => {
    const input: CatalogBrowseRequestV1 = {
      q: "rookie",
      category: "Sports Cards",
      after: "eyJsYXN0X2lkIjoxfQ==+/",
      collectionsAfter: "collection:cursor/%2B=",
    };
    expect(validateCatalogBrowseRequestV1(input)).toEqual({
      success: true,
      data: input,
    });
  });

  it("preserves literal search punctuation for server escaping", () => {
    const input = { q: 'rookie" OR product_type:* \\ special' };
    expect(validateCatalogBrowseRequestV1(input)).toEqual({
      success: true,
      data: input,
    });
  });

  it("accepts exact length boundaries without truncating filters or cursors", () => {
    const input = {
      q: "q".repeat(100),
      category: "c".repeat(80),
      after: "a".repeat(1500),
      collectionsAfter: "b".repeat(1500),
    };
    expect(catalogBrowseRequestV1Schema.parse(input)).toEqual(input);
    expect(
      catalogBrowseRequestV1Schema.parse({ collection: "a".repeat(150) }),
    ).toEqual({ collection: "a".repeat(150) });
  });

  it("rejects search plus collection instead of silently ignoring the collection", () => {
    expect(
      validateCatalogBrowseRequestV1({
        q: "rookie",
        collection: "trading-cards",
      }),
    ).toEqual({
      success: false,
      error: { code: "invalid_catalog_query" },
    });
  });

  it.each([
    null,
    undefined,
    [],
    "q=rookie",
    { q: 123 },
    { category: ["Sports Cards"] },
    { after: 123 },
    { collectionsAfter: null },
    { q: "q".repeat(101) },
    { category: "c".repeat(81) },
    { collection: "a".repeat(151) },
    { after: "a".repeat(1501) },
    { collectionsAfter: "b".repeat(1501) },
    { collection: "Sports Cards" },
    { collection: "../private" },
    { collection: "https://foreign.invalid" },
  ])("rejects malformed or over-limit requests: %j", (input) => {
    expect(validateCatalogBrowseRequestV1(input)).toEqual({
      success: false,
      error: { code: "invalid_catalog_query" },
    });
  });

  it.each(["q", "category", "collection", "after", "collectionsAfter"])(
    "rejects empty, blank and control-bearing %s without normalization",
    (key) => {
      for (const value of ["", "   ", "ok\u0000bad", "ok\nbad", "ok\u007fbad"])
        expect(validateCatalogBrowseRequestV1({ [key]: value })).toEqual({
          success: false,
          error: { code: "invalid_catalog_query" },
        });
    },
  );

  it.each([
    "shop",
    "publication",
    "status",
    "includeDrafts",
    "inventoryLocationId",
    "customerId",
    "staffNotes",
    "adminToken",
    "first",
    "sortKey",
  ])("rejects unsupported or authority-bearing field %s", (key) => {
    const input = { q: "rookie", [key]: "private-synthetic-value" };
    const result = validateCatalogBrowseRequestV1(input);
    expect(result).toEqual({
      success: false,
      error: { code: "invalid_catalog_query" },
    });
    expect(JSON.stringify(result)).not.toContain("private-synthetic-value");
    expect(input[key as keyof typeof input]).toBe("private-synthetic-value");
  });
});
