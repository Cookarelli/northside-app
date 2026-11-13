import { describe, it, expect, jest } from "@jest/globals";
import {
  scanDiagnosticsEnabled,
  diagnosticValue,
  emptyScanDiagnostic,
  diagnosticOutcome,
  formatScanDiagnostic,
} from "../src/shopping/scan-diagnostics";
import { emitScanTrace } from "../src/api/scan-trace";
import { createAppConfig } from "../config/app";

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
      { version: "0.1.0", build: "9" },
    );
    expect(text).not.toContain("PRIVATE");
    expect(JSON.parse(text)).toMatchObject({
      rawValue: "8003148023",
      esl: {
        status: "assignment_feed_not_connected",
        identifier: null,
        assignment: null,
      },
    });
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
});
