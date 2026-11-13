import { describe, it, expect, jest } from "@jest/globals";
import {
  scanDiagnosticsEnabled,
  diagnosticValue,
  emptyScanDiagnostic,
  diagnosticOutcome,
  formatScanDiagnostic,
  scanAppIdentity,
} from "../src/shopping/scan-diagnostics";
import { emitScanTrace } from "../src/api/scan-trace";
import { createAppConfig } from "../config/app";
import { verifiedScanAddInput } from "../src/shopping/verified-scan";
import { PREVIEW_CATALOG_SELECTION } from "../src/api/public-catalog";

describe("internal scan diagnostics boundary", () => {
  it("requires explicit nonproduction configuration at build time and runtime", () => {
    expect(createAppConfig({}).extra?.mobile.scanDiagnostics).toBeUndefined();
    for (const variant of ["development", "preview"]) {
      expect(
        scanDiagnosticsEnabled(
          createAppConfig({
            MOBILE_APP_VARIANT: variant,
            MOBILE_SCAN_DIAGNOSTICS: "true",
          }).extra?.mobile,
        ),
      ).toBe(true);
      expect(scanDiagnosticsEnabled({ variant })).toBe(false);
    }
    expect(() =>
      createAppConfig({
        MOBILE_APP_VARIANT: "production",
        MOBILE_SCAN_DIAGNOSTICS: "true",
      }),
    ).toThrow(/diagnostics/);
    for (const config of [
      null,
      {},
      { variant: "production", scanDiagnostics: true },
      { variant: "preview", scanDiagnostics: "true" },
    ])
      expect(scanDiagnosticsEnabled(config)).toBe(false);
  });
  it("preserves leading zeroes while bounding text and redacting URLs, QR and control characters", () => {
    expect(diagnosticValue("0003148023", "code128")).toBe("0003148023");
    expect(diagnosticValue("0746134170294", "ean13")).toBe("0746134170294");
    expect(diagnosticValue("private", "qr")).toContain("redacted");
    for (const value of [
      "https://example.test/q?token=PRIVATE",
      "BOX\nPRIVATE",
      "value&token=PRIVATE",
    ])
      expect(diagnosticValue(value)).not.toContain("PRIVATE");
    expect(diagnosticValue("X".repeat(10000))).toHaveLength(139);
  });
  it("copies only allowlisted fields and never invents a housing identity or assignment", () => {
    const report = {
      ...emptyScanDiagnostic(),
      source: "camera" as const,
      rawValue: "8003148023",
      rawLength: 10,
      format: "code128",
      candidates: ["8003148023"],
      outcome: "product_not_found" as const,
      failureReason: "not_found",
      authorization: "PRIVATE",
      cart: "PRIVATE",
      customer: "PRIVATE",
    };
    const text = formatScanDiagnostic(
      report,
      { forwarded: 1, ignoredFormat: 0, suppressed: 0 },
      scanAppIdentity({}),
    );
    expect(text).not.toContain("PRIVATE");
    expect(JSON.parse(text)).toMatchObject({
      rawValue: "8003148023",
    });
    expect(text).not.toContain('"esl"');
    expect(emptyScanDiagnostic().outcome).toBe("no_forwarded_barcode");
  });
  it.each([
    ["not_found", "product_not_found"],
    ["ambiguous_scan", "ambiguous_barcode"],
    ["offline", "network_error"],
    ["timeout", "network_error"],
    ["service_unavailable", "network_error"],
    ["invalid_request", "invalid_barcode"],
    ["invalid_response", "verification_error"],
    ["server_error", "server_error"],
    ["rate_limited", "server_error"],
    ["scan_access_denied", "access_error"],
    ["product_unavailable", "product_unavailable"],
  ])("distinguishes %s from camera failure", (code, outcome) =>
    expect(diagnosticOutcome(code)).toBe(outcome),
  );
  it("cannot let an observer exception change a lookup", () => {
    const observer = jest.fn(() => {
      throw Error("PRIVATE observer failure");
    });
    expect(() =>
      emitScanTrace(observer, {
        path: "backend-registry",
        stage: "backend-request",
      }),
    ).not.toThrow();
    expect(observer).toHaveBeenCalledTimes(1);
  });
  it("reports real native build separately from JS build and never fabricates a source/update identity", () => {
    expect(
      scanAppIdentity({
        platform: { ios: { buildNumber: "9" } },
        expoConfig: { ios: { buildNumber: "10" } },
      }),
    ).toMatchObject({
      nativeIosBuild: "9",
      configuredBundleBuild: "10",
      nativeAndConfiguredBuildAgree: false,
      sourceCommit: null,
      easBuildId: null,
      otaUpdateId: null,
      otaConfigured: null,
    });
    expect(scanAppIdentity({})).toMatchObject({
      nativeIosBuild: null,
      configuredBundleBuild: null,
      nativeAndConfiguredBuildAgree: null,
    });
    const config = createAppConfig({
      EAS_BUILD_GIT_COMMIT_HASH: "a".repeat(40),
      EAS_BUILD_ID: "11111111-1111-4111-8111-111111111111",
    });
    expect(scanAppIdentity({ expoConfig: config })).toMatchObject({
      sourceCommit: "a".repeat(40),
      easBuildId: "11111111-1111-4111-8111-111111111111",
      otaConfigured: false,
    });
    expect(() =>
      createAppConfig({ EAS_BUILD_GIT_COMMIT_HASH: "PRIVATE" }),
    ).toThrow();
  });
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
