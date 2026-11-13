/** Public catalog metadata only. Never include provider payloads, headers or tokens. */
export type ScanLookupTrace = {
  path: "public-shopify-variant-barcode" | "backend-registry";
  stage:
    | "catalog-read"
    | "barcode-match"
    | "identity-verification"
    | "eligibility-check"
    | "backend-request"
    | "complete";
  endpoint?: string;
  httpStatus?: number | null;
  apiVersion?: string | null;
  requestCache?: "no-store";
  catalogProducts?: number;
  unreturnedProducts?: number;
  matchingVariants?: number;
  reason?:
    | "no_matching_visible_variant"
    | "multiple_variant_barcodes"
    | "catalog_identity_changed";
};
export type ScanTraceListener = (trace: ScanLookupTrace) => void;

/** Optional QA observers must never change a shopping operation's outcome. */
export function emitScanTrace(
  listener: ScanTraceListener | undefined,
  trace: ScanLookupTrace,
) {
  try {
    listener?.(trace);
  } catch {
    /* Observation is best effort. */
  }
}
