import { describe, it, expect } from "@jest/globals";
import {
  barcodePreviewHeight,
  isRetailBarcodeFormat,
} from "../src/shopping/barcode-scanner";

describe("camera viewport and format policy", () => {
  it.each([
    // Scroll viewport excludes the actual SafeArea/header/tab bar; top includes intro/controls.
    [667 - 20 - 82 - 68, 195],
    [844 - 59 - 82 - 102, 195],
    [844 - 59 - 82 - 102, 260],
    [932 - 59 - 82 - 102, 195],
  ])(
    "keeps the complete camera above the fold in viewport %s at offset %s",
    (viewport, top) => {
      const height = barcodePreviewHeight(viewport, top);
      expect(height).toBeGreaterThanOrEqual(180);
      expect(height).toBeLessThanOrEqual(420);
      expect(top + height + 16).toBeLessThanOrEqual(viewport);
    },
  );
  it.each([[601, 340], [601, 390], [497, 340]])("reserves controls and guidance above a short camera at %s/%s", (viewport, top) => {
    const height = barcodePreviewHeight(viewport, top);
    expect(height).toBeGreaterThan(100);
    expect(top + height + 16).toBeLessThanOrEqual(viewport);
  });
  it.each([
    [300, 190],
    [150, 180],
  ])("clamps a short viewport %s at offset %s", (viewport, top) => {
    expect(barcodePreviewHeight(viewport, top)).toBe(
      Math.max(0, viewport - top - 16),
    );
  });
  it.each(["upc_a", "upc_e", "ean13", "ean8", "code128"])(
    "accepts retail format %s",
    (format) => {
      expect(isRetailBarcodeFormat(format)).toBe(true);
    },
  );
  it.each(["qr", "code39", "pdf417", "unknown", ""])(
    "ignores unsupported customer camera format %s",
    (format) => {
      expect(isRetailBarcodeFormat(format)).toBe(false);
    },
  );
});
