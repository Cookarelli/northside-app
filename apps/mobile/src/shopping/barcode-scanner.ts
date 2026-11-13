/** Camera formats for the customer Scan tab. Independent QR workflows stay separate. */
export const RETAIL_BARCODE_FORMATS = [
  "upc_a",
  "upc_e",
  "ean13",
  "ean8",
  "code128",
] as const;
export function isRetailBarcodeFormat(
  format: string,
): format is (typeof RETAIL_BARCODE_FORMATS)[number] {
  return (RETAIL_BARCODE_FORMATS as readonly string[]).includes(format);
}

/** The measured scroll viewport already excludes the safe area, header and tab bar. */
export function barcodePreviewHeight(viewport: number, top: number) {
  return Math.max(0, Math.min(420, Math.floor(viewport - top - 16)));
}
