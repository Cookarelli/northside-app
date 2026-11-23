import { describe, expect, it, jest } from "@jest/globals";
import { waitFor } from "@testing-library/react-native";
import { MobileApi } from "../src/api/client";
import { AuthController } from "../src/auth/controller";
import type { ServiceRequestInput } from "@northside/customer-contracts/service-requests";
const ID = "11111111-1111-4111-8111-111111111111",
  TERM = "22222222-2222-4222-8222-222222222222",
  TOKEN = "A".repeat(43),
  CLAIM = "C".repeat(43);
const config = {
  contractVersion: "1",
  location: {
    address: "6800 Forest Hills Road, Suite 3, Loves Park, Illinois",
    receivingPostalCode: null,
    receivingStartsAt: null,
    receivingActive: false,
  },
  terms: [
    {
      id: TERM,
      service: "grading",
      version: "SAMPLE-v1",
      title: "SAMPLE terms",
      body: "SAMPLE fixture terms only",
    },
  ],
  serviceLevels: [],
};
const input: ServiceRequestInput = {
  request_id: ID,
  claim_token: CLAIM,
  kind: "inquiry",
  service: "grading",
  contact: {
    name: "SAMPLE collector",
    email: "sample@example.invalid",
    phone: "8155550100",
  },
  details: { question: "SAMPLE question" },
  terms_id: null,
  terms_accepted: false,
};
const receipt = {
  contractVersion: "1",
  id: ID,
  reference: "NS-SAMPLE-API",
  state: "new",
  duplicate: false,
  next_steps: "Saved for staff review; receipt unconfirmed.",
};
const list = { contractVersion: "1", requests: [] };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
describe("actual MobileApi shared service transport", () => {
  it.each(["ios", "android"] as const)(
    "uses exact private request routes and%s body with bearer credentials, omitted cookies and validated replies",
    async (platform) => {
      const request = jest.fn<typeof fetch>(async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/config")) return json(config);
        if (init?.method === "GET") return json(list);
        return json(
          JSON.parse(String(init?.body)).action === "claim"
            ? { claim_id: ID, pending_staff_verification: true }
            : receipt,
        );
      });
      const api = new MobileApi(
        "https://services-verifier.example.invalid",
        request,
      );
      expect(await api.serviceRequestConfig(TOKEN)).toEqual(config);
      expect(await api.serviceRequests(TOKEN)).toEqual(list);
      expect(
        await api.submitServiceRequest(TOKEN, input, platform),
      ).toEqual(receipt);
      expect(await api.claimServiceRequest(TOKEN, ID, CLAIM)).toEqual({
        claim_id: ID,
        pending_staff_verification: true,
      });
      expect(request.mock.calls.map(([url]) => url)).toEqual([
        "https://services-verifier.example.invalid/api/mobile/v1/me/service-requests/config",
        ...Array(3).fill(
          "https://services-verifier.example.invalid/api/mobile/v1/me/service-requests",
        ),
      ]);
      for (const [, init] of request.mock.calls) {
        expect(init).toEqual(
          expect.objectContaining({
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            headers: expect.objectContaining({
              Authorization: `Bearer ${TOKEN}`,
              Accept: "application/json",
            }),
          }),
        );
        expect(init?.headers).not.toHaveProperty("Cookie");
      }
      expect(request.mock.calls[0][1]?.method).toBe("GET");
      expect(request.mock.calls[1][1]?.method).toBe("GET");
      expect(request.mock.calls[2][1]?.method).toBe("POST");
      expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
        action: "submit",
        platform,
        input,
      });
      expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({
        action: "claim",
        id: ID,
        claim_token: CLAIM,
      });
    },
  );
  it("rejects malformed request/extra identity fields before fetch and validates safe approved-term config", async () => {
    const request = jest.fn<typeof fetch>(async () =>
        json({
          ...config,
          location: { ...config.location, receivingActive: true },
        }),
      ),
      api = new MobileApi("https://services-verifier.example.invalid", request);
    for (const bad of [
      { ...input, customer_id: ID },
      { ...input, contact: { ...input.contact, email: "invalid" } },
      {
        ...input,
        kind: "service_request" as const,
        terms_id: null,
        terms_accepted: false,
      },
    ])
      expect(() => api.submitServiceRequest(TOKEN, bad, "ios")).toThrow(
        "invalid_request",
      );
    expect(request).not.toHaveBeenCalled();
    await expect(api.serviceRequestConfig(TOKEN)).rejects.toThrow(
      "invalid_response",
    );
  });
  it("a lost POST response is never automatically retried; explicit caller retry keeps exact payload and idempotency credentials", async () => {
    const request = jest
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new Error("PRIVATE upstream details"))
        .mockResolvedValueOnce(json({ ...receipt, duplicate: true })),
      api = new MobileApi("https://services-verifier.example.invalid", request);
    await expect(api.submitServiceRequest(TOKEN, input, "ios")).rejects.toThrow(
      "offline",
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      (await api.submitServiceRequest(TOKEN, input, "ios")).duplicate,
    ).toBe(true);
    expect(request.mock.calls[1][1]?.body).toBe(request.mock.calls[0][1]?.body);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("malformed list/receipt or provider text is rejected without exposing raw private server error", async () => {
    const request = jest
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({
            contractVersion: "1",
            requests: [{ id: ID, reference: "PRIVATE incomplete DTO" }],
          }),
        )
        .mockResolvedValueOnce(json({ ...receipt, id: "not-uuid" }))
        .mockResolvedValueOnce(json({ error: "PRIVATE DATABASE DETAIL" }, 500)),
      api = new MobileApi("https://services-verifier.example.invalid", request);
    await expect(api.serviceRequests(TOKEN)).rejects.toThrow(
      "invalid_response",
    );
    await expect(
      api.submitServiceRequest(TOKEN, input, "android"),
    ).rejects.toThrow("invalid_response");
    await expect(api.claimServiceRequest(TOKEN, ID, CLAIM)).rejects.toThrow(
      "service_unavailable",
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("already cancelled service reads do not fetch and service writes do not implicitly retry503", async () => {
    const request = jest.fn<typeof fetch>(async () =>
        json(
          {
            contractVersion: "northside.mobile.v1",
            kind: "error",
            error: { code: "service_unavailable" },
            requestId: ID,
          },
          503,
        ),
      ),
      api = new MobileApi(
        "https://services-verifier.example.invalid",
        request,
        1000,
        async () => {},
      ),
      abort = new AbortController();
    abort.abort();
    await expect(api.serviceRequestConfig(TOKEN, abort.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(request).not.toHaveBeenCalled();
    await expect(api.submitServiceRequest(TOKEN, input, "ios")).rejects.toThrow(
      "service_unavailable",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
async function authHarness() {
  const now = Date.now(),
    values = new Map<string, string>([["renewal", "R".repeat(43)]]);
  let hold: Promise<Response> | null = null;
  const request = jest.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/renew"))
      return json({
        contractVersion: "northside.mobile.v1",
        kind: "session",
        accessToken: TOKEN,
        renewalToken: "N".repeat(43),
        accessExpiresAt: new Date(now + 600000).toISOString(),
        absoluteExpiresAt: new Date(now + 3600000).toISOString(),
        customerId: ID,
        providerRenewal: "refresh_available",
      });
    if (path.endsWith("/logout"))
      return json({
        contractVersion: "northside.mobile.v1",
        kind: "logout",
        revoked: true,
        providerLogout: "not_performed",
      });
    if (path.endsWith("/me"))
      return json({
        contractVersion: "northside.mobile.v1",
        kind: "account",
        customer: { id: ID, firstName: "SAMPLE", lastName: null, email: null },
        sessionExpiresAt: new Date(now + 3600000).toISOString(),
      });
    if (path.endsWith("/orders"))
      return json({
        contractVersion: "northside.mobile.v1",
        kind: "orders",
        orders: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    if (path.endsWith("/service-requests/config")) return json(config);
    if (path.endsWith("/service-requests")) {
      if (init?.method === "GET") return json(list);
      if (JSON.parse(String(init?.body)).action === "claim")
        return json({ claim_id: ID, pending_staff_verification: true });
      return hold ?? json(receipt);
    }
    return json({
      contractVersion: "northside.mobile.v1",
      kind: "services",
      items: [],
    });
  });
  const api = new MobileApi(
      "https://services-verifier.example.invalid",
      request,
      1000,
      async () => {},
    ),
    controller = new AuthController(
      api,
      { variant: "development", returnUri: "northside-verifier://auth/return" },
      {
        storage: {
          async get(k) {
            return values.get(k) ?? null;
          },
          async set(k, v) {
            values.set(k, v);
          },
          async remove(k) {
            values.delete(k);
          },
        },
        async token() {
          return CLAIM;
        },
        async challenge() {
          return CLAIM;
        },
        browser: {
          async open() {
            return { type: "cancel" };
          },
          dismiss() {},
        },
        now: () => now,
      },
    );
  await controller.initialize();
  expect(controller.snapshot().status).toBe("authenticated");
  return {
    controller,
    request,
    hold: (value: Promise<Response>) => {
      hold = value;
    },
  };
}
describe("actual AuthController new request methods", () => {
  it("reuses verified parent-session auth for config/list/claim/submit without credentials entering snapshot", async () => {
    const h = await authHarness();
    try {
      expect(await h.controller.serviceRequestConfig()).toEqual(config);
      expect(await h.controller.serviceRequests()).toEqual(list);
      expect(await h.controller.claimServiceRequest(ID, CLAIM)).toEqual({
        claim_id: ID,
        pending_staff_verification: true,
      });
      expect(await h.controller.submitServiceRequest(input, "ios")).toEqual(
        receipt,
      );
      const calls = h.request.mock.calls.filter(([url]) =>
        String(url).includes("/service-requests"),
      );
      expect(calls).toHaveLength(4);
      for (const [, init] of calls)
        expect(init?.headers).toEqual(
          expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
        );
      expect(JSON.stringify(h.controller.snapshot())).not.toContain(TOKEN);
    } finally {
      await h.controller.logout();
    }
  });
  it("a post that ignores abort cannot return saved-request data after logout", async () => {
    const h = await authHarness(),
      late = deferred<Response>();
    try {
      h.hold(late.promise);
      const pending = h.controller.submitServiceRequest(input, "ios");
      const rejected = expect(pending).rejects.toThrow("cancelled");
      await waitFor(() =>
        expect(
          h.request.mock.calls.some(([url]) =>
            String(url).endsWith("/service-requests"),
          ),
        ).toBe(true),
      );
      await h.controller.logout();
      late.resolve(json(receipt));
      await rejected;
      expect(h.controller.snapshot().status).toBe("signed_out");
    } finally {
      await h.controller.logout();
    }
  });
});
