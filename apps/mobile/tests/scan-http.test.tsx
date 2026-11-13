import { describe, it, expect, jest } from "@jest/globals";
import { MobileApi } from "../src/api/client";

const errorBody = JSON.stringify({
  contractVersion: "northside.mobile.v1",
  kind: "error",
  error: { code: "not_found" },
  requestId: "11111111-1111-4111-8111-111111111111",
});
describe("scan HTTP evidence and safe failure classification", () => {
  it.each([
    [404, "not_found"],
    [500, "server_error"],
    [503, "server_error"],
    [429, "rate_limited"],
    [401, "scan_access_denied"],
    [403, "scan_access_denied"],
    [400, "invalid_response"],
  ])(
    "does not call HTTP %s an unknown barcode unless the contract and status agree",
    async (status, code) => {
      const request = jest.fn<typeof fetch>(
        async () =>
          new Response(errorBody, {
            status: Number(status),
            headers: { "content-type": "application/json" },
          }),
      );
      const trace = jest.fn();
      await expect(
        new MobileApi("https://native.example.test", request).scan(
          "0746134150968",
          undefined,
          "ean13",
          trace,
        ),
      ).rejects.toThrow(String(code));
      expect(trace).toHaveBeenLastCalledWith(
        expect.objectContaining({
          httpStatus: Number(status),
          endpoint: "https://native.example.test/api/mobile/v1/scan",
        }),
      );
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("distinguishes a missing endpoint and transport failure without copying raw error data", async () => {
    const trace = jest.fn();
    await expect(
      new MobileApi(
        "https://native.example.test",
        async () => new Response("PRIVATE", { status: 404 }),
      ).scan("UNKNOWN", undefined, "code128", trace),
    ).rejects.toThrow("scan_endpoint_unavailable");
    expect(trace).toHaveBeenLastCalledWith(
      expect.objectContaining({ httpStatus: 404 }),
    );
    trace.mockClear();
    await expect(
      new MobileApi("https://native.example.test", async () => {
        throw Error("PRIVATE transport info");
      }).scan("UNKNOWN", undefined, "code128", trace),
    ).rejects.toThrow("offline");
    expect(trace).toHaveBeenLastCalledWith(
      expect.objectContaining({ httpStatus: null }),
    );
    expect(JSON.stringify(trace.mock.calls)).not.toContain("PRIVATE");
  });
});
