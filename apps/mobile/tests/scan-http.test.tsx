import { describe, it, expect, jest } from "@jest/globals";
import { MobileApi } from "../src/api/client";

const errorBody = JSON.stringify({
  contractVersion: "northside.mobile.v1",
  kind: "error",
  error: { code: "not_found" },
  requestId: "11111111-1111-4111-8111-111111111111",
});
describe("scan HTTP failure classification", () => {
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
      await expect(
        new MobileApi("https://native.example.test", request).scan(
          "0746134150968",
          undefined,
          "ean13",
        ),
      ).rejects.toThrow(String(code));
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("distinguishes a missing endpoint and transport failure through distinct customer-safe errors", async () => {
    await expect(
      new MobileApi(
        "https://native.example.test",
        async () => new Response("PRIVATE", { status: 404 }),
      ).scan("UNKNOWN", undefined, "code128"),
    ).rejects.toThrow("scan_endpoint_unavailable");
    await expect(
      new MobileApi("https://native.example.test", async () => {
        throw Error("PRIVATE transport info");
      }).scan("UNKNOWN", undefined, "code128"),
    ).rejects.toThrow("offline");
  });
});
