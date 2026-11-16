import { describe, it, expect } from "@jest/globals";
import { verifiedScanAddInput } from "../src/shopping/verified-scan";
import { PREVIEW_CATALOG_SELECTION } from "../src/api/public-catalog";

describe("verified barcode cart input", () => {
  it.each(PREVIEW_CATALOG_SELECTION.slice(0, 6))(
    "sends verified canonical Shopify barcode for Add without old-backend alias inference: $barcode",
    (p) => {
      expect(
        verifiedScanAddInput("0" + p.barcode, "code128", p.barcode),
      ).toEqual({ code: p.barcode, format: "code128" });
      expect(
        verifiedScanAddInput("0" + p.barcode, undefined, p.barcode),
      ).toEqual({ code: p.barcode, format: "code128" });
      expect(() =>
        verifiedScanAddInput("SKU-ONE", "code128", p.barcode),
      ).toThrow();
    },
  );
  it("canonicalizes UPC-E correctly and preserves literal leading-zero codes without SKU/partial aliases", () => {
    expect(verifiedScanAddInput("04252614", "upc_e", "042100005264")).toEqual({
      code: "042100005264",
      format: "code128",
    });
    expect(
      verifiedScanAddInput("000BOX-001", "code128", "000BOX-001").code,
    ).toBe("000BOX-001");
    expect(() =>
      verifiedScanAddInput("BOX-001", "code128", "000BOX-001"),
    ).toThrow();
    expect(() =>
      verifiedScanAddInput("0746134150969", "code128", "746134150968"),
    ).toThrow();
  });
});
