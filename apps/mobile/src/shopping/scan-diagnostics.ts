import type { MobileProduct } from "@northside/customer-contracts/mvp";
import type { ScanLookupTrace } from "../api/scan-trace";
import {
  CATALOG_SHOP,
  CATALOG_SHOPIFY_API_VERSION,
} from "@northside/customer-contracts";
import { NORTHSIDE_NATIVE_SELECTION } from "../../../../packages/customer-contracts/src/native-scan";

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
  schema: "northside.scan-diagnostics.v2";
  recordedAt: string | null;
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
    | "server_error"
    | "access_error"
    | "cancelled"
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
  canonicalAddInput: { code: string; format: "code128" } | null;
};
export function emptyScanDiagnostic(): ScanDiagnostic {
  return {
    schema: "northside.scan-diagnostics.v2",
    recordedAt: null,
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
    canonicalAddInput: null,
  };
}
export function diagnosticOutcome(code: string): ScanDiagnostic["outcome"] {
  if (code === "not_found") return "product_not_found";
  if (code === "ambiguous_scan") return "ambiguous_barcode";
  if (code === "product_unavailable") return "product_unavailable";
  if (["offline", "timeout", "service_unavailable"].includes(code))
    return "network_error";
  if (
    ["server_error", "rate_limited", "scan_endpoint_unavailable"].includes(code)
  )
    return "server_error";
  if (code === "scan_access_denied") return "access_error";
  if (code === "cancelled") return "cancelled";
  if (["invalid_request", "unsupported_qr"].includes(code))
    return "invalid_barcode";
  return "verification_error";
}

export type ScanAppIdentity = {
  configuredVersion: string | null;
  configuredBundleBuild: string | null;
  nativeIosBuild: string | null;
  nativeAndConfiguredBuildAgree: boolean | null;
  sourceCommit: string | null;
  easBuildId: string | null;
  executionEnvironment: string | null;
  otaConfigured: boolean | null;
  otaUpdateId: null;
  otaRuntime: "not_installed";
  commerceEndpoint: string | null;
};
function safeEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.origin + u.pathname
      : null;
  } catch {
    return null;
  }
}
/** The native build comes from Info.plist, independently of the JS manifest. */
export function scanAppIdentity(constants: {
  platform?: { ios?: { buildNumber?: string | null } };
  executionEnvironment?: string;
  expoConfig?: {
    version?: string;
    ios?: { buildNumber?: string };
    updates?: { enabled?: boolean };
    extra?: {
      mobile?: {
        buildIdentity?: { sourceCommit?: unknown; easBuildId?: unknown };
        commerceApiOrigin?: unknown;
      };
    };
  } | null;
}): ScanAppIdentity {
  const c = constants.expoConfig,
    identity = c?.extra?.mobile?.buildIdentity;
  const native = constants.platform?.ios?.buildNumber ?? null,
    configured = c?.ios?.buildNumber ?? null;
  return {
    configuredVersion: c?.version ?? null,
    configuredBundleBuild: configured,
    nativeIosBuild: native,
    nativeAndConfiguredBuildAgree:
      native && configured ? native === configured : null,
    sourceCommit:
      typeof identity?.sourceCommit === "string" &&
      /^[a-f0-9]{40}$/.test(identity.sourceCommit)
        ? identity.sourceCommit
        : null,
    easBuildId:
      typeof identity?.easBuildId === "string" &&
      /^[a-f0-9-]{36}$/.test(identity.easBuildId)
        ? identity.easBuildId
        : null,
    executionEnvironment: constants.executionEnvironment ?? null,
    otaConfigured: c?.updates?.enabled ?? null,
    otaUpdateId: null,
    otaRuntime: "not_installed",
    commerceEndpoint: safeEndpoint(c?.extra?.mobile?.commerceApiOrigin),
  };
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
  app: ScanAppIdentity,
) {
  // An explicit allowlist prevents future screen/cart/auth state from reaching Copy.
  const d = diagnostic;
  return JSON.stringify(
    {
      schema: d.schema,
      recordedAt: d.recordedAt,
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
            endpoint: safeEndpoint(d.lookup.endpoint),
            httpStatus: d.lookup.httpStatus ?? null,
            apiVersion: d.lookup.apiVersion ?? null,
            requestCache: d.lookup.requestCache,
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
      canonicalAddInput: d.canonicalAddInput
        ? { code: d.canonicalAddInput.code, format: d.canonicalAddInput.format }
        : null,
      events: {
        forwarded: events.forwarded,
        ignoredFormat: events.ignoredFormat,
        suppressed: events.suppressed,
      },
      app: {
        configuredVersion: app.configuredVersion,
        configuredBundleBuild: app.configuredBundleBuild,
        nativeIosBuild: app.nativeIosBuild,
        nativeAndConfiguredBuildAgree: app.nativeAndConfiguredBuildAgree,
        sourceCommit: app.sourceCommit,
        easBuildId: app.easBuildId,
        executionEnvironment: app.executionEnvironment,
        otaConfigured: app.otaConfigured,
        otaUpdateId: app.otaUpdateId,
        otaRuntime: app.otaRuntime,
        commerceEndpoint: safeEndpoint(app.commerceEndpoint),
      },
      catalog: {
        shop: CATALOG_SHOP,
        apiVersion: CATALOG_SHOPIFY_API_VERSION,
        scope: app.commerceEndpoint
          ? "server-managed-storefront-publication"
          : "approved-preview-products",
        configuredProductCount: app.commerceEndpoint
          ? null
          : NORTHSIDE_NATIVE_SELECTION.length,
      },
      note: "Last recorded attempt retained in memory until another lookup, identity change, Clear or app restart. No camera frame is saved. Native build and configured JS build are separate. OTA runtime is not installed; no runtime update ID is available. Product barcodes only.",
    },
    null,
    2,
  );
}
