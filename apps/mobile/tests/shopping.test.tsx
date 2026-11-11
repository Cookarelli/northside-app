import { describe, it, expect, jest, afterEach } from "@jest/globals";
import {
  ShoppingController,
  type ShoppingPort,
} from "../src/shopping/controller";
import { MobileApi, MobileFailure } from "../src/api/client";
import { MOBILE_CONTRACT_VERSION as contractVersion } from "@northside/customer-contracts/mobile";
import type {
  ShoppingAction,
  ShoppingCart,
  ShoppingResponse,
} from "@northside/customer-contracts/shopping";

const variantId = "gid://shopify/ProductVariant/11";
const token = "S".repeat(43);
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function harness() {
  let cart: ShoppingCart = {
    version: 1,
    sample: true,
    phase: "shopping",
    lines: [],
    subtotalCents: 0,
    currency: "USD",
    paymentStatus: "unpaid",
    handoff: null,
  };
  const calls: { action: ShoppingAction; token?: string }[] = [];
  let hold: ReturnType<typeof deferred<ShoppingResponse>> | undefined;
  let uncertain = false;
  const port: ShoppingPort = jest.fn<ShoppingPort>(
    async (action, credential) => {
      calls.push({ action, token: credential });
      if (action.action !== "start") expect(credential).toBe(token);
      if (action.action === "add") {
        const quantity = (cart.lines[0]?.quantity ?? 0) + 1;
        cart = {
          ...cart,
          version: cart.version + 1,
          lines: [
            {
              variantId,
              productId: "gid://shopify/Product/1",
              title: "SAMPLE card",
              variantTitle: "Base",
              image: null,
              quantity,
              priceCents: 1234,
            },
          ],
          subtotalCents: quantity * 1234,
        };
      }
      if (action.action === "set")
        cart = {
          ...cart,
          version: cart.version + 1,
          lines: action.quantity
            ? [{ ...cart.lines[0], quantity: action.quantity }]
            : [],
          subtotalCents: 1234 * action.quantity,
        };
      if (action.action === "ready")
        cart = {
          ...cart,
          version: cart.version + 1,
          phase: "ready_for_staff",
          handoff: {
            reference: "R".repeat(43),
            expiresAt: Date.now() + 600000,
          },
        };
      if (action.action === "cancel")
        cart = {
          ...cart,
          version: cart.version + 1,
          phase: "shopping",
          handoff: null,
        };
      const response: ShoppingResponse = {
        contractVersion,
        kind: "shopping",
        cart,
        ...(action.action === "start" ? { sessionToken: token } : {}),
        ...(cart.handoff ? { qr: "data:image/png;base64,YQ==" } : {}),
      };
      if (hold) return hold.promise;
      if (uncertain && action.action !== "read") {
        uncertain = false;
        throw new MobileFailure("offline");
      }
      return response;
    },
  );
  const controller = new ShoppingController(port);
  return {
    controller,
    calls,
    port,
    cart: () => cart,
    hold: () => (hold = deferred<ShoppingResponse>()),
    uncertain: () => {
      uncertain = true;
    },
    release: () => {
      hold?.resolve({ contractVersion, kind: "shopping", cart });
      hold = undefined;
    },
  };
}
afterEach(() => {
  jest.useRealTimers();
});

describe("ephemeral unpaid shopping controller", () => {
  it("adds only on explicit action, merges intentional quantity, edits/removes and freezes unpaid handoff", async () => {
    const h = harness();
    expect(h.calls).toHaveLength(0);
    await h.controller.add("036000291452", variantId, 1234, "upc_a");
    expect(h.calls.map((c) => c.action.action)).toEqual(["start", "add"]);
    expect(h.calls[1].action).toMatchObject({
      version: 1,
      code: "036000291452",
      format: "upc_a",
    });
    await h.controller.add("036000291452", variantId, 1234);
    expect(h.controller.snapshot().cart?.lines[0].quantity).toBe(2);
    await h.controller.set(variantId, 3);
    await h.controller.ready();
    expect(h.controller.snapshot().cart).toMatchObject({
      paymentStatus: "unpaid",
      subtotalCents: 3702,
      phase: "ready_for_staff",
    });
    expect(h.controller.snapshot().qr).toBeDefined();
    await h.controller.cancel();
    expect(h.controller.snapshot().qr).toBeUndefined();
    await h.controller.set(variantId, 0);
    expect(h.controller.snapshot().cart?.lines).toEqual([]);
    expect(JSON.stringify(h.controller.snapshot())).not.toContain(token);
    h.controller.dispose();
  });
  it("coalesces rapid repeated Add taps into one mutation", async () => {
    const h = harness();
    await h.controller.start();
    h.hold();
    const first = h.controller.add("036000291452", variantId, 1234);
    await h.controller.add("036000291452", variantId, 1234);
    expect(h.calls.filter((c) => c.action.action === "add")).toHaveLength(1);
    h.release();
    await first;
    expect(h.controller.snapshot().cart?.lines[0].quantity).toBe(1);
    h.controller.dispose();
  });
  it("never retries a possibly committed write; refresh recovers the canonical version before another Add", async () => {
    const h = harness();
    await h.controller.start();
    h.uncertain();
    await expect(
      h.controller.add("036000291452", variantId, 1234),
    ).rejects.toThrow("offline");
    expect(h.controller.snapshot().needsRefresh).toBe(true);
    expect(h.controller.snapshot().cart).toBeUndefined();
    expect(h.controller.snapshot().qr).toBeUndefined();
    await expect(
      h.controller.add("036000291452", variantId, 1234),
    ).rejects.toThrow("cart_changed_reload");
    expect(h.calls.map((c) => c.action.action)).toEqual(["start", "add"]);
    await h.controller.read();
    expect(h.controller.snapshot().cart?.lines[0].quantity).toBe(1);
    await h.controller.add("036000291452", variantId, 1234);
    expect(h.calls.at(-1)?.action).toMatchObject({ action: "add", version: 2 });
    expect(h.controller.snapshot().cart?.lines[0].quantity).toBe(2);
    h.controller.dispose();
  });
  it("hides private list and code on background; resumes with a server read", async () => {
    const h = harness();
    await h.controller.add("036000291452", variantId, 1234);
    await h.controller.ready();
    h.controller.setActive(false);
    expect(h.controller.snapshot()).toEqual({
      status: "paused",
      busy: false,
      needsRefresh: true,
    });
    h.hold();
    h.controller.setActive(true);
    expect(h.controller.snapshot().cart).toBeUndefined();
    expect(h.calls.at(-1)?.action.action).toBe("read");
    h.release();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(h.controller.snapshot().cart?.paymentStatus).toBe("unpaid");
    h.controller.dispose();
  });
  it("initial inactive state cannot send child mount commands", async () => {
    const port = jest.fn<ShoppingPort>();
    const c = new ShoppingController(port, Date.now, false);
    await c.start();
    await c.add("036000291452", variantId, 1234);
    expect(port).not.toHaveBeenCalled();
    expect(c.snapshot().status).toBe("paused");
    c.dispose();
  });
  it("private Draft/disconnected adapter has no shopping capability", async () => {
    const c = new ShoppingController(null);
    await c.start();
    await c.add("036000291452", variantId, 1234);
    await c.ready();
    expect(c.snapshot()).toEqual({ status: "unconfigured", busy: false });
    c.dispose();
  });
  it("disposal/account replacement rejects late responses and clears credentials", async () => {
    const h = harness();
    await h.controller.start();
    h.hold();
    const pending = h.controller.add("036000291452", variantId, 1234);
    h.controller.dispose();
    h.release();
    await pending;
    expect(h.controller.snapshot().cart).toBeUndefined();
    await h.controller.start();
    expect(h.calls).toHaveLength(2);
  });
  it("expires the counter QR without claiming payment or retaining an active reference in UI", async () => {
    jest.useFakeTimers();
    const h = harness();
    await h.controller.add("036000291452", variantId, 1234);
    await h.controller.ready();
    jest.advanceTimersByTime(600001);
    expect(h.controller.snapshot()).toMatchObject({
      handoffExpired: true,
      qr: undefined,
      cart: { paymentStatus: "unpaid" },
    });
    h.controller.dispose();
  });
  it.each(["paid", "private", "subtotal", "token"])(
    "rejects unsafe %s response and hides previous list",
    async (mode) => {
      const h = harness();
      await h.controller.start();
      (h.port as jest.Mock<ShoppingPort>).mockImplementationOnce(
        async () =>
          ({
            contractVersion,
            kind: "shopping",
            cart: {
              ...h.cart(),
              ...(mode === "paid"
                ? { paymentStatus: "paid" }
                : mode === "private"
                  ? { internalInventory: 50 }
                  : mode === "subtotal"
                    ? { subtotalCents: 1 }
                    : {}),
            },
            ...(mode === "token" ? { sessionToken: token } : {}),
          }) as unknown as ShoppingResponse,
      );
      await expect(h.controller.read()).rejects.toThrow("invalid_response");
      expect(h.controller.snapshot().needsRefresh).toBe(true);
      expect(h.controller.snapshot().cart).toBeUndefined();
      h.controller.dispose();
    },
  );
  it.each([
    "cart_owner_mismatch",
    "shopping_session_expired",
    "session_expired",
  ])("drops session token after %s", async (code) => {
    const h = harness();
    await h.controller.start();
    (h.port as jest.Mock<ShoppingPort>).mockRejectedValueOnce(
      new MobileFailure(code),
    );
    await expect(h.controller.read()).rejects.toThrow(code);
    expect(h.controller.snapshot().needsRefresh).toBe(false);
    await h.controller.start();
    expect(h.calls.at(-1)).toMatchObject({
      action: { action: "start" },
      token: undefined,
    });
    h.controller.dispose();
  });
});

describe("versioned mobile shopping transport", () => {
  it("calls browser fetch without binding the API client as its receiver", async () => {
    let calls = 0;
    const request: typeof fetch = async function(this: unknown) {
      if (this instanceof MobileApi) throw new TypeError("Illegal invocation");
      calls++;
      return new Response(JSON.stringify({ contractVersion, kind: "shopping", sessionToken: token, cart: { version: 1, sample: true, phase: "shopping", lines: [], subtotalCents: 0, currency: "USD", paymentStatus: "unpaid", handoff: null } }), { headers: { "content-type": "application/json" } });
    };
    const api = new MobileApi("https://stage.example.test", request);
    expect((await api.shopping({ action: "start" })).cart.paymentStatus).toBe("unpaid");
    expect(calls).toBe(1);
  });
  it("uses POST and header credential, omits cookies and never retries writes", async () => {
    const request = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("PRIVATE transport details"));
    const api = new MobileApi("https://stage.example.test", request);
    await expect(
      api.shopping({ action: "read" }, token, "A".repeat(43)),
    ).rejects.toThrow("offline");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([
      "https://stage.example.test/api/mobile/v1/shopping",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        body: '{"action":"read"}',
        headers: expect.objectContaining({
          Authorization: `Bearer ${"A".repeat(43)}`,
          "X-Northside-Shopping-Session": token,
        }),
      }),
    ]);
  });
  it("parses only allowlisted cart errors and rejects invalid local commands before fetch", async () => {
    const request = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            contractVersion,
            kind: "error",
            error: { code: "quantity_unavailable" },
            requestId: "11111111-1111-4111-8111-111111111111",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      );
    const api = new MobileApi("https://stage.example.test", request);
    await expect(
      api.shopping({ action: "ready", version: 1 }, token),
    ).rejects.toThrow("quantity_unavailable");
    expect(() =>
      api.shopping(
        { action: "set", version: 1, variantId, quantity: -1 },
        token,
      ),
    ).toThrow("invalid_request");
    expect(() => api.shopping({ action: "read" }, "bad")).toThrow(
      "invalid_request",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "preview", "production"] as const)(
    "rejects cleartext API for %s",
    (variant) => {
      expect(
        () =>
          new MobileApi("http://127.0.0.1:8098", fetch, undefined, undefined, {
            variant,
          }),
      ).toThrow("not_configured");
    },
  );
  it("allows only explicit development loopback, never remote cleartext", () => {
    expect(
      new MobileApi("http://127.0.0.1:8098", fetch, undefined, undefined, {
        variant: "development",
      }).base,
    ).toBe("http://127.0.0.1:8098/api/mobile/v1");
    expect(
      () =>
        new MobileApi("http://192.168.1.2:8098", fetch, undefined, undefined, {
          variant: "development",
        }),
    ).toThrow("not_configured");
  });
});
