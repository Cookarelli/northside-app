import { describe, it, expect, jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { MobileApi } from "../src/api/client";
import { AuthController, type AuthPorts } from "../src/auth/controller";
import { MOBILE_CONTRACT_VERSION as contractVersion, mobileIntentRequestSchema } from "@northside/customer-contracts/mobile";

const idA = "11111111-1111-4111-8111-111111111111",
  idB = "22222222-2222-4222-8222-222222222222";
const opaque = (n: number) =>
  String.fromCharCode(65 + (n % 26)).repeat(42) +
  String.fromCharCode(65 + (Math.floor(n / 26) % 26));
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function harness() {
  let counter = 0,
    now = Date.now(),
    customerId = idA,
    intent: { intentId: string; challenge: string; appState: string } | undefined,
    exchangeCount = 0,
    renewCount = 0,
    offline = false,
    unauthorized = false;
  const values = new Map<string, string>();
  let mode = "success",
    hold: ReturnType<typeof deferred<Response>> | undefined;
  let holdPath = "/me";
  const session = () => ({
    contractVersion,
    kind: "session",
    accessToken: opaque(++counter),
    renewalToken: opaque(++counter),
    accessExpiresAt: new Date(now + 600000).toISOString(),
    absoluteExpiresAt: new Date(now + 3600000).toISOString(),
    customerId,
    providerRenewal: "refresh_available",
  });
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  const error = (code: string, status = 401) =>
    response(
      { contractVersion, kind: "error", error: { code }, requestId: idA },
      status,
    );
  const request = jest.fn<typeof fetch>(async (url, init) => {
    if (offline) throw Error("synthetic private network details");
    const path = new URL(String(url)).pathname,
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/intents")) {
      const savedIntent = { ...mobileIntentRequestSchema.parse(body), intentId: opaque(++counter) };
      intent = savedIntent;
      return response({
        contractVersion,
        kind: "auth-intent",
        intentId: savedIntent.intentId,
        startUrl:
          "https://stage.example.test/api/mobile/v1/auth/start?intent=" +
          savedIntent.intentId,
        expiresAt: new Date(now + 300000).toISOString(),
      });
    }
    if (path.endsWith("/exchange")) {
      exchangeCount++;
      if (!intent) throw new Error("SAMPLE exchange requires a saved intent");
      expect(
        createHash("sha256").update(body.verifier).digest("base64url"),
      ).toBe(intent.challenge);
      return response(session());
    }
    if (path.endsWith("/renew")) {
      renewCount++;
      if (hold && holdPath === "/renew") {
        await hold.promise;
        return response(session());
      }
      return response(session());
    }
    if (path.endsWith("/logout"))
      return response({
        contractVersion,
        kind: "logout",
        revoked: true,
        providerLogout: "not_performed",
      });
    if (hold && path.endsWith(holdPath)) return hold.promise;
    if (unauthorized) return error("session_expired");
    if (path.endsWith("/shopping"))
      return response({
        contractVersion,
        kind: "shopping",
        sessionToken: opaque(20),
        cart: {
          version: 1,
          sample: true,
          phase: "shopping",
          lines: [],
          subtotalCents: 0,
          currency: "USD",
          paymentStatus: "unpaid",
          handoff: null,
        },
      });
    if (path.endsWith("/me"))
      return response({
        contractVersion,
        kind: "account",
        customer: {
          id: customerId,
          firstName: customerId === idA ? "Customer A" : "Customer B",
          lastName: null,
          email: null,
        },
        sessionExpiresAt: new Date(now + 3600000).toISOString(),
      });
    if (path.endsWith("/orders"))
      return response({
        contractVersion,
        kind: "orders",
        orders: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    return response({ contractVersion, kind: "services", items: [] });
  });
  const callback = () => {
    if (!intent) throw new Error("SAMPLE callback requires a saved intent");
    return `northside-synthetic://auth/return?ticket=${opaque(++counter)}&intent=${intent.intentId}&state=${intent.appState}`;
  };
  const ports: AuthPorts = {
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
      return opaque(++counter);
    },
    async challenge(v) {
      return createHash("sha256").update(v).digest("base64url");
    },
    browser: {
      async open() {
        if (mode === "hold") return new Promise(() => {});
        return mode === "cancel"
          ? { type: "cancel" }
          : { type: "success", url: callback() };
      },
      dismiss() {},
    },
    now: () => now,
  };
  const api = new MobileApi(
    "https://stage.example.test",
    request,
    2000,
    async () => {},
  );
  const make = () =>
    new AuthController(
      api,
      {
        variant: "development",
        returnUri: "northside-synthetic://auth/return",
      },
      ports,
    );
  return {
    make,
    api,
    ports,
    values,
    request,
    response,
    callback,
    counts: () => ({ exchangeCount, renewCount }),
    setMode: (v: string) => {
      mode = v;
    },
    setOffline: (v: boolean) => {
      offline = v;
    },
    expire: () => {
      now += 600001;
    },
    advance: (ms: number) => {
      now += ms;
    },
    setCustomer: (id: string) => {
      customerId = id;
    },
    setUnauthorized: () => {
      unauthorized = true;
    },
    hold: (path = "/me") => {
      holdPath = path;
      hold = deferred<Response>();
      return hold;
    },
  };
}
async function pending(h: ReturnType<typeof harness>) {
  h.setMode("hold");
  const c = h.make();
  await c.initialize();
  void c.login();
  for (let i = 0; i < 30 && !h.values.has("pending"); i++)
    await Promise.resolve();
  expect(h.values.has("pending")).toBe(true);
  return c;
}

describe("native customer authentication safety with simulated provider/backend", () => {
  it("keeps the shopping identity through held renewal and shares renewal with simultaneous commands", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    const identity = c.shoppingIdentity();
    h.expire();
    const held = h.hold("/renew");
    const first = c.shoppingOn(h.api, { action: "start" });
    for (let i = 0; i < 30 && h.counts().renewCount === 0; i++)
      await Promise.resolve();
    expect(h.counts().renewCount).toBe(1);
    expect(c.shoppingIdentity()).toBe(identity);
    const second = c.shoppingOn(h.api, { action: "start" });
    held.resolve(h.response({}));
    await Promise.all([first, second]);
    expect(c.shoppingIdentity()).toBe(identity);
    expect(c.snapshot().status).toBe("authenticated");
    expect(h.counts().renewCount).toBe(1);
    await c.logout();
  });
  it("never renews or forwards native credentials to another API origin", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.expire();
    const request = jest.fn<typeof fetch>();
    const other = new MobileApi("https://other.example.test", request);
    await expect(c.shoppingOn(other, { action: "start" })).rejects.toThrow(
      "not_configured",
    );
    expect(request).not.toHaveBeenCalled();
    expect(h.counts().renewCount).toBe(0);
    await c.logout();
  });
  it("rejects a late shopping response after logout and changes the cart identity on account switch", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    const identity = c.shoppingIdentity();
    const held = h.hold("/shopping");
    const command = c.shoppingOn(h.api, { action: "start" }).catch((e) => e);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await c.logout();
    held.resolve(
      h.response({
        contractVersion,
        kind: "shopping",
        sessionToken: opaque(20),
        cart: {
          version: 1,
          sample: true,
          phase: "shopping",
          lines: [],
          subtotalCents: 0,
          currency: "USD",
          paymentStatus: "unpaid",
          handoff: null,
        },
      }),
    );
    expect((await command).code).toBe("cancelled");
    expect(c.shoppingIdentity()).not.toBe(identity);
    h.setCustomer(idB);
    await c.login();
    expect(c.shoppingIdentity()).not.toBe(identity);
    expect(c.snapshot().account?.customer.id).toBe(idB);
    await c.logout();
  });
  it("first login uses PKCE, stores only renewal credential and fetches validated private records", async () => {
    const h = harness(),
      c = h.make();
    await c.initialize();
    await c.login();
    expect(c.snapshot().account?.customer.id).toBe(idA);
    expect([...h.values.keys()]).toEqual(["renewal"]);
    expect(h.counts().exchangeCount).toBe(1);
    expect(
      h.request.mock.calls.every(([, init]) => init?.credentials === "omit"),
    ).toBe(true);
  });
  it("restores an existing customer through one rotation; profile is never persisted", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    const reopened = h.make();
    await reopened.initialize();
    expect(reopened.snapshot().account?.customer.id).toBe(idA);
    expect(h.counts().renewCount).toBe(1);
    expect(JSON.stringify([...h.values])).not.toContain("Customer A");
  });
  it("cancellation clears pending verifier without exchanging a ticket", async () => {
    const h = harness();
    h.setMode("cancel");
    const c = h.make();
    await c.login();
    expect(c.snapshot().message).toBe("cancelled");
    expect(h.values.size).toBe(0);
    expect(h.counts().exchangeCount).toBe(0);
  });
  it("logout and reopen have no retained session or private data", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    await c.logout();
    expect(c.snapshot().account).toBeUndefined();
    expect(h.values.has("renewal")).toBe(false);
    expect(h.values.has("pending")).toBe(false);
    const reopened = h.make();
    await reopened.initialize();
    expect(reopened.snapshot().status).toBe("signed_out");
    expect(h.counts().renewCount).toBe(0);
  });
  it("offline logout clears local credentials and reports unconfirmed server revocation", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.setOffline(true);
    await c.logout();
    expect(h.values.has("renewal")).toBe(false);
    expect(h.values.has("pending")).toBe(false);
    expect(c.snapshot().logoutConfirmed).toBe(false);
    expect(c.snapshot().account).toBeUndefined();
  });
  it("switching accounts clears A before fetching B", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    await c.logout();
    h.setCustomer(idB);
    await c.login();
    expect(c.snapshot().account?.customer.firstName).toBe("Customer B");
    expect(JSON.stringify(c.snapshot())).not.toContain("Customer A");
  });
  it.each([
    "https://evil.example.test/auth/return",
    "northside-synthetic://wrong/return",
    "northside-synthetic://auth/elsewhere",
  ])("rejects untrusted return %s", async (base) => {
    const h = harness(),
      c = await pending(h);
    const url = new URL(h.callback());
    await c.receive(base + url.search);
    expect(h.counts().exchangeCount).toBe(0);
    expect(c.snapshot().message).toBe("invalid_callback");
  });
  it.each(["state", "intent"])(
    "rejects wrong %s and consumes the local flow",
    async (key) => {
      const h = harness(),
        c = await pending(h);
      const url = new URL(h.callback());
      url.searchParams.set(key, opaque(24));
      await c.receive(url.toString());
      expect(h.counts().exchangeCount).toBe(0);
      expect(h.values.size).toBe(0);
    },
  );
  it("rejects duplicate query parameters", async () => {
    const h = harness(),
      c = await pending(h);
    await c.receive(h.callback() + "&state=duplicate");
    expect(h.counts().exchangeCount).toBe(0);
  });
  it("consumes a callback once including duplicate and reopened deep links", async () => {
    const h = harness(),
      c = await pending(h),
      url = h.callback();
    await Promise.all([c.receive(url), c.receive(url)]);
    await c.receive(url);
    expect(h.counts().exchangeCount).toBe(1);
    const reopened = h.make();
    await reopened.initialize(url);
    expect(h.counts().exchangeCount).toBe(1);
  });
  it("cold-start pending flow completes without a second browser launch", async () => {
    const h = harness();
    await pending(h);
    const cold = h.make();
    await cold.initialize(h.callback());
    expect(cold.snapshot().status).toBe("authenticated");
    expect(h.counts().exchangeCount).toBe(1);
  });
  it("expired server access wipes private data and requires login", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.setUnauthorized();
    await c.load();
    expect(c.snapshot().status).toBe("signed_out");
    expect(c.snapshot().account).toBeUndefined();
    expect(h.values.size).toBe(0);
  });
  it("renews expiring access once and retains customer identity", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.expire();
    await c.load();
    expect(h.counts().renewCount).toBe(1);
    expect(c.snapshot().account?.customer.id).toBe(idA);
  });
  it("expires a continuously foreground account and clears its OS credential without another request", async () => {
    jest.useFakeTimers();
    try {
      const h = harness(),
        c = h.make();
      await c.login();
      const requests = h.request.mock.calls.length;
      h.advance(3600000);
      await jest.advanceTimersByTimeAsync(3600000);
      expect(c.snapshot().status).toBe("signed_out");
      expect(c.snapshot().message).toBe("session_expired");
      expect(c.snapshot().account).toBeUndefined();
      expect(h.values.has("renewal")).toBe(false);
      expect(h.request.mock.calls.length).toBe(requests);
    } finally {
      jest.useRealTimers();
    }
  });
  it("replaces the expiry deadline when switching accounts", async () => {
    jest.useFakeTimers();
    try {
      const h = harness(),
        c = h.make();
      await c.login();
      h.advance(1800000);
      await jest.advanceTimersByTimeAsync(1800000);
      await c.logout();
      h.setCustomer(idB);
      await c.login();
      h.advance(1800000);
      await jest.advanceTimersByTimeAsync(1800000);
      expect(c.snapshot().account?.customer.id).toBe(idB);
      await c.logout();
    } finally {
      jest.useRealTimers();
    }
  });
  it("checks the absolute deadline on resume even when a suspended timer has not run", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    c.setVisibility(false);
    h.advance(3600001);
    c.setVisibility(true);
    await c.load();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(c.snapshot().status).toBe("signed_out");
    expect(c.snapshot().account).toBeUndefined();
    expect(h.counts().renewCount).toBe(0);
    expect(h.values.has("renewal")).toBe(false);
  });
  it("cannot publish authenticated state when acceptance crosses the absolute deadline", async () => {
    const h = harness(),
      c = h.make();
    const request = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) => {
      const response = await request(url, init);
      if (String(url).endsWith("/exchange")) {
        const receipt = (await response.clone().json()) as {
          absoluteExpiresAt: string;
        };
        const deadline = Date.parse(receipt.absoluteExpiresAt);
        h.ports.now = jest
          .fn<() => number>()
          .mockReturnValueOnce(deadline - 1)
          .mockReturnValueOnce(deadline - 1)
          .mockReturnValueOnce(deadline - 1)
          .mockReturnValue(deadline);
      }
      return response;
    });
    await c.login();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(c.snapshot().status).toBe("signed_out");
    expect(c.snapshot().account).toBeUndefined();
    expect(h.values.has("renewal")).toBe(false);
  });
  it("lost renewal response fails closed with no retry or reusable local credential", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.expire();
    h.setOffline(true);
    await c.load();
    expect(c.snapshot().status).toBe("signed_out");
    expect(h.values.size).toBe(0);
    expect(
      h.request.mock.calls.filter(([u]) => String(u).endsWith("/renew")),
    ).toHaveLength(1);
  });
  it("a late A response cannot repopulate caches after logout", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    const hold = h.hold(),
      load = c.load();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await c.logout();
    hold.resolve(
      h.response({
        contractVersion,
        kind: "account",
        customer: {
          id: idA,
          firstName: "Customer A",
          lastName: null,
          email: null,
        },
        sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
    await load;
    expect(c.snapshot().account).toBeUndefined();
    expect(c.snapshot().status).toBe("signed_out");
  });
  it("offline private reads drop cached details and expose a safe error", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.setOffline(true);
    await c.load();
    expect(c.snapshot().message).toBe("offline");
    expect(c.snapshot().account).toBeUndefined();
    expect(JSON.stringify(c.snapshot())).not.toContain("synthetic private");
  });
});

describe("versioned transport safety", () => {
  it.each(["text/plain", "text/html", "application/json"])(
    "surfaces an edge 429 safely without retrying a read or renewal: %s",
    async (contentType) => {
      const request = jest.fn<typeof fetch>(
        async () =>
          new Response("edge throttle; not an application response", {
            status: 429,
            headers: { "Content-Type": contentType },
          }),
      );
      const api = new MobileApi("https://stage.example.test", request);
      await expect(api.account(opaque(1))).rejects.toThrow("rate_limited");
      await expect(api.renew(opaque(2))).rejects.toThrow("rate_limited");
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
  it("rejects insecure or credential-bearing API origins", () => {
    for (const origin of [
      "http://example.test",
      "https://name:password@example.test",
      "https://example.test/api",
    ])
      expect(() => new MobileApi(origin)).toThrow();
  });
  it("retries reads once, never callback/renewal writes", async () => {
    const request = jest.fn<typeof fetch>(async () => {
        throw Error("private");
      }),
      api = new MobileApi(
        "https://stage.example.test",
        request,
        100,
        async () => {},
      );
    await expect(api.account(opaque(1))).rejects.toThrow("offline");
    expect(request).toHaveBeenCalledTimes(2);
    request.mockClear();
    await expect(api.renew(opaque(2))).rejects.toThrow("offline");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("aborts timed out requests", async () => {
    const request: typeof fetch = (_u, init) =>
        new Promise((_r, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(Error("timeout")),
          ),
        ),
      api = new MobileApi(
        "https://stage.example.test",
        request,
        5,
        async () => {},
      );
    await expect(api.renew(opaque(1))).rejects.toThrow("timeout");
  });
  it("rejects successful responses that contain private extensions", async () => {
    const h = harness();
    const api = new MobileApi("https://stage.example.test", async () =>
      h.response({
        contractVersion,
        kind: "services",
        items: [],
        adminToken: "SYNTHETIC",
      }),
    );
    await expect(api.services(opaque(1), "cards")).rejects.toThrow(
      "invalid_response",
    );
  });
});

describe("session lifecycle regression cases", () => {
  it("duplicate initialization rotates a stored session only once", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    const reopened = h.make();
    await Promise.all([reopened.initialize(), reopened.initialize()]);
    expect(h.counts().renewCount).toBe(1);
    expect(reopened.snapshot().status).toBe("authenticated");
  });
  it("sign-out during in-flight renewal retains the family revocation credential", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    const credential = h.values.get("renewal");
    const hold = deferred<Response>(),
      original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) =>
      String(url).endsWith("/renew") ? hold.promise : original(url, init),
    );
    h.expire();
    const loading = c.load();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await c.logout();
    expect(
      h.request.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/logout") &&
          JSON.parse(String(init?.body)).renewalToken === credential,
      ),
    ).toBe(true);
    hold.resolve(h.response({}));
    await loading;
    expect(c.snapshot().status).toBe("signed_out");
    expect(c.snapshot().account).toBeUndefined();
  });
  it("partial secure-store deletion attempts both keys and prevents reopen restoration", async () => {
    const h = harness(),
      c = h.make();
    await c.login();
    h.values.set("pending", "synthetic pending");
    const remove = h.ports.storage.remove,
      attempts: string[] = [];
    h.ports.storage.remove = async (key) => {
      attempts.push(key);
      if (key === "renewal") throw Error("OS storage unavailable");
      await remove(key);
    };
    h.setOffline(true);
    await c.logout();
    expect(attempts).toContain("pending");
    expect(c.snapshot().message).toBe("storage_unavailable");
    expect(c.snapshot().localCredentialsCleared).toBe(false);
    const reopened = h.make();
    h.setOffline(false);
    await reopened.initialize();
    expect(reopened.snapshot().status).toBe("signed_out");
    expect(h.counts().renewCount).toBe(0);
  });
});

function trackingHarness() {
  const h = harness(),
    original = h.request.getMockImplementation()!;
  const timestamp = () => new Date().toISOString();
  const terms = {
    service: "grading" as const,
    current: {
      id: idB,
      version: "SAMPLE v1",
      title: "SAMPLE terms",
      body: "SAMPLE isolated terms, not approved business policy.",
      publishedAt: timestamp(),
    },
    acceptedAt: null,
  };
  const card = {
    id: idB,
    cardId: idB,
    service: "grading" as const,
    title: "SAMPLE owned grading card",
    status: "Examination in progress",
    receivedDate: "2026-09-01",
    recordedAt: timestamp(),
    updatedAt: timestamp(),
  };
  const view = () => ({
    contractVersion,
    kind: "card-tracking",
    service: "grading",
    cards: [card],
    terms,
  });
  let held: ReturnType<typeof deferred<Response>> | undefined;
  h.request.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.includes("/me/tracking/")) {
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toMatch(
        /^Bearer [A-Za-z0-9_-]{43}$/,
      );
      expect(String(url)).not.toContain("token=");
      if (held) return held.promise;
      if (path.includes("/photos/"))
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          headers: { "content-type": "image/png" },
        });
      if (path.endsWith("/terms"))
        return h.response({ ...terms, acceptedAt: timestamp() });
      return h.response(view());
    }
    return original(url, init);
  });
  return {
    ...h,
    terms,
    view,
    holdTracking: () => {
      held = deferred<Response>();
      return held;
    },
  };
}

describe("private card tracking uses existing native authentication", () => {
  it.each(["/my-cards?service=consignment", "/service-requests?topic=advance"] as const)("keeps %s through validated sign-in and resets it on logout", async (destination) => {
    const h = harness(),
      c = h.make();
    await c.login(destination);
    expect(c.accountDestination()).toBe(destination);
    expect(c.snapshot().account?.customer.id).toBe(idA);
    expect(
      h.request.mock.calls.map(([url]) => String(url)).join(" "),
    ).not.toContain("returnTo=");
    await c.logout();
    expect(c.accountDestination()).toBe("/account");
  });
  it("restores an allowlisted section from a protected pending cold-start attempt", async () => {
    const h = harness();
    h.setMode("hold");
    const first = h.make();
    void first.login("/my-cards?service=grading");
    for (let i = 0; i < 50 && !h.values.has("pending"); i++)
      await Promise.resolve();
    expect(h.values.has("pending")).toBe(true);
    const restored = h.make();
    await restored.initialize(h.callback());
    expect(restored.snapshot().account?.customer.id).toBe(idA);
    expect(restored.accountDestination()).toBe("/my-cards?service=grading");
    await restored.logout();
  });
  it("never accepts an untrusted stored destination as a redirect", async () => {
    const h = harness();
    await pending(h);
    const p = JSON.parse(h.values.get("pending")!);
    p.destination = "https://untrusted.invalid/private";
    h.values.set("pending", JSON.stringify(p));
    const restored = h.make();
    await restored.initialize(h.callback());
    expect(restored.accountDestination()).toBe("/account");
    await restored.logout();
  });
  it("refreshes card tracking across access renewal while keeping the validated customer boundary", async () => {
    const h = trackingHarness(),
      c = h.make();
    await c.login();
    const before = c.snapshot().account;
    h.expire();
    const data = await c.tracking("grading");
    expect(h.counts().renewCount).toBe(1);
    expect(c.snapshot().account).toEqual(before);
    expect(data.cards[0].title).toBe("SAMPLE owned grading card");
    expect(c.snapshot().status).toBe("authenticated");
    await c.logout();
  });
  it("renews a private photo without putting credentials or image bytes in platform storage", async () => {
    const h = trackingHarness(),
      c = h.make();
    await c.login();
    h.expire();
    const uri = await c.trackingPhoto("grading", idB, idA);
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(h.counts().renewCount).toBe(1);
    expect(c.snapshot().account?.customer.id).toBe(idA);
    expect([...h.values.values()].join(" ")).not.toContain("data:image");
    await c.logout();
  });
  it("records terms through renewal with a strict version and authenticated actor", async () => {
    const h = trackingHarness(),
      c = h.make();
    await c.login();
    h.expire();
    const data = await c.acceptTerms({
      service: "grading",
      terms_id: idB,
      card_id: idB,
      confirmed: true,
    });
    expect(data.acceptedAt).toBeTruthy();
    expect(c.snapshot().account?.customer.id).toBe(idA);
    const body = JSON.parse(
      String(
        h.request.mock.calls.find(([url]) =>
          String(url).endsWith("/tracking/terms"),
        )?.[1]?.body,
      ),
    );
    expect(Object.keys(body).sort()).toEqual([
      "card_id",
      "confirmed",
      "service",
      "terms_id",
    ]);
    await c.logout();
  });
  it("rejects a late private response after logout even if the transport ignores abort", async () => {
    const h = trackingHarness(),
      c = h.make();
    await c.login();
    const held = h.holdTracking();
    const request = c.tracking("grading");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await c.logout();
    held.resolve(h.response(h.view()));
    await expect(request).rejects.toMatchObject({ code: "cancelled" });
    expect(c.snapshot().account).toBeUndefined();
    expect(c.snapshot().services).toBeUndefined();
  });
  it("rejects a renewal that changes customer before requesting any private card", async () => {
    const h = trackingHarness(),
      c = h.make();
    await c.login();
    h.setCustomer(idB);
    h.expire();
    await expect(c.tracking("grading")).rejects.toBeTruthy();
    expect(c.snapshot().status).toBe("signed_out");
    expect(c.snapshot().account).toBeUndefined();
    expect(
      h.request.mock.calls.some(([url]) =>
        String(url).includes("/me/tracking/"),
      ),
    ).toBe(false);
  });
  it("does not send a tracking request while hidden or already cancelled", async () => {
    const h = trackingHarness(),
      c = h.make();
    await c.login();
    const count = h.request.mock.calls.length;
    const abort = new AbortController();
    abort.abort();
    await expect(c.tracking("grading", abort.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    c.setVisibility(false);
    await expect(c.tracking("grading")).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(h.request.mock.calls.length).toBe(count);
    await c.logout();
  });
  it("rejects extra private data in a tracking response instead of displaying it", async () => {
    const h = trackingHarness();
    const invalid = { ...h.view(), internal_notes: "PRIVATE STAFF REASON" };
    h.request.mockResolvedValueOnce(h.response(invalid));
    await expect(h.api.tracking(opaque(1), "grading")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
