import type { MobileProduct } from "@northside/customer-contracts/mvp";
import type { ScanLookupTrace } from "../api/scan-trace";

export function scanDiagnosticsEnabled(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const value = config as { variant?: unknown; scanDiagnostics?: unknown };
  return (
    value.scanDiagnostics === true &&
    (value.variant === "preview" || value.variant === "development")
  );
}

/** Keep only the last attempt in memory. URLs/QR and control bytes are redacted. */
export function diagnosticValue(raw: string, format?: string) {
  if (format === "qr" || /(?:https?:|:\/\/|[?&#=])/i.test(raw))
    return "[URL/QR payload redacted]";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "[control characters redacted]";
  return raw.length > 128 ? raw.slice(0, 128) + "[truncated]" : raw;
}

export type ScanDiagnostic = {
  schema: "northside.scan-diagnostics.v1";
  source: "camera" | "manual" | null;
  rawValue: string | null;
  rawLength: number;
  format: string | null;
  lookupValue: string | null;
  candidates: string[];
  outcome:
    | "no_forwarded_barcode"
    | "looking_up"
    | "product_found"
    | "product_unavailable"
    | "product_not_found"
    | "ambiguous_barcode"
    | "network_error"
    | "verification_error"
    | "invalid_barcode";
  failureReason: string | null;
  lookup: ScanLookupTrace | null;
  matched: {
    productId: string;
    title: string;
    variantId: string;
    variantTitle: string;
    variantBarcode: string | null;
    appEligible: boolean;
  } | null;
  esl: {
    status: "assignment_feed_not_connected";
    identifier: null;
    assignment: null;
  };
};
export function emptyScanDiagnostic(): ScanDiagnostic {
  return {
    schema: "northside.scan-diagnostics.v1",
    source: null,
    rawValue: null,
    rawLength: 0,
    format: null,
    lookupValue: null,
    candidates: [],
    outcome: "no_forwarded_barcode",
    failureReason: null,
    lookup: null,
    matched: null,
    esl: {
      status: "assignment_feed_not_connected",
      identifier: null,
      assignment: null,
    },
  };
}
export function diagnosticOutcome(code: string): ScanDiagnostic["outcome"] {
  if (code === "not_found") return "product_not_found";
  if (code === "ambiguous_scan") return "ambiguous_barcode";
  if (["offline", "timeout", "service_unavailable"].includes(code))
    return "network_error";
  if (["invalid_request", "unsupported_qr"].includes(code))
    return "invalid_barcode";
  return "verification_error";
}
export function diagnosticMatch(data: MobileProduct, variantId: string) {
  const v = data.product.variants.nodes.find((v) => v.id === variantId)!;
  return {
    productId: data.product.id,
    title: diagnosticValue(data.product.title),
    variantId: v.id,
    variantTitle: diagnosticValue(v.title),
    variantBarcode: v.identifiers.barcode,
    appEligible:
      data.product.availableForSale &&
      v.availability.availableForSale &&
      !v.availability.currentlyNotInStock &&
      v.availability.state !== "unavailable",
  };
}

export function formatScanDiagnostic(
  diagnostic: ScanDiagnostic,
  events: { forwarded: number; ignoredFormat: number; suppressed: number },
  app: { version: string; build: string },
) {
  // An explicit allowlist prevents future screen/cart/auth state from reaching Copy.
  const d = diagnostic;
  return JSON.stringify(
    {
      schema: d.schema,
      source: d.source,
      rawValue: d.rawValue,
      rawLength: d.rawLength,
      format: d.format,
      lookupValue: d.lookupValue,
      candidates: d.candidates,
      outcome: d.outcome,
      failureReason: d.failureReason,
      lookup: d.lookup
        ? {
            path: d.lookup.path,
            stage: d.lookup.stage,
            catalogProducts: d.lookup.catalogProducts,
            unreturnedProducts: d.lookup.unreturnedProducts,
            matchingVariants: d.lookup.matchingVariants,
            reason: d.lookup.reason,
          }
        : null,
      matched: d.matched
        ? {
            productId: d.matched.productId,
            title: d.matched.title,
            variantId: d.matched.variantId,
            variantTitle: d.matched.variantTitle,
            variantBarcode: d.matched.variantBarcode,
            appEligible: d.matched.appEligible,
          }
        : null,
      esl: {
        status: "assignment_feed_not_connected",
        identifier: null,
        assignment: null,
      },
      events: {
        forwarded: events.forwarded,
        ignoredFormat: events.ignoredFormat,
        suppressed: events.suppressed,
      },
      app: { version: app.version, build: app.build },
      note: "Last attempt only. No camera frame is saved. No Shelva assignment feed is connected; housing identity and current assignment are NOT VERIFIED.",
    },
    null,
    2,
  );
}
