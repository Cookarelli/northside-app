import { describe, it, expect, jest, afterEach } from "@jest/globals";
import {
  PublicCatalogApi,
  PREVIEW_CATALOG_SELECTION,
  PUBLIC_CATALOG_ENDPOINT,
} from "../src/api/public-catalog";
import {
  ShoppingController,
  type CartHandleStore,
  type ShoppingPort,
} from "../src/shopping/controller";
import type { ShoppingCart } from "@northside/customer-contracts/shopping";
import { createAppConfig } from "../config/app";
import profile from "../eas.json";

function raw(index: number) {
  const p = PREVIEW_CATALOG_SELECTION[index];
  return {
    id: p.id,
    handle: p.handle,
    title: `SYNTHETIC scanner product ${index}`,
    description: "",
    productType: "Basketball",
    publishedAt: "2026-11-10T16:30:55Z",
    availableForSale: true,
    featuredImage: null,
    priceRange: { minVariantPrice: { amount: "69.95", currencyCode: "USD" } },
    variants: {
      nodes: [
        {
          id: p.variantId,
          title: "Base",
          sku: `SYNTHETIC-${index}`,
          barcode: p.barcode,
          availableForSale: true,
          currentlyNotInStock: false,
          price: { amount: "69.95", currencyCode: "USD" },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
function shoppingHarness() {
  let saved: string | null = null,
    quantity = 0,
    offline = false,
    hold: (() => void) | undefined,
    delay: Promise<void> | undefined;
  const storage: CartHandleStore = {
    get: async () => saved,
    set: async (value) => {
      saved = value;
    },
    remove: async () => {
      saved = null;
    },
  };
  const calls: string[] = [];
  const response = (): ShoppingCart => ({
    version: calls.length + 1,
    source: "shopify_cart",
    sample: false,
    phase: "shopping",
    lines: quantity
      ? [
          {
            variantId: PREVIEW_CATALOG_SELECTION[0].variantId,
            productId: PREVIEW_CATALOG_SELECTION[0].id,
            title: "SYNTHETIC cart item",
            variantTitle: "Base",
            image: null,
            sku: "SYNTHETIC-SKU",
            quantity,
            priceCents: 6995,
            lineTotalCents: 6995 * quantity,
            availability: "available",
          },
        ]
      : [],
    subtotalCents: 6995 * quantity,
    currency: "USD",
    paymentStatus: "unpaid",
    handoff: null,
    cost: {
      subtotalCents: 6995 * quantity,
      totalCents: 6995 * quantity,
      estimated: true,
      checkoutEnabled: false,
    },
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const port: ShoppingPort = jest.fn<ShoppingPort>(async (action, token) => {
    calls.push(action.action);
    if (offline) throw Error("PRIVATE network detail");
    if (action.action !== "start") expect(token).toBe("S".repeat(43));
    if (action.action === "add") {
      quantity++;
      if (delay) await delay;
    }
    if (action.action === "set") quantity = action.quantity;
    return {
      contractVersion: "northside.mobile.v1",
      kind: "shopping",
      cart: response(),
      ...(action.action === "start" ? { sessionToken: "S".repeat(43) } : {}),
    };
  });
  return {
    storage,
    port,
    calls,
    saved: () => saved,
    offline: () => {
      offline = true;
    },
    delay: () => {
      delay = new Promise<void>((resolve) => {
        hold = resolve;
      });
    },
    release: () => hold?.(),
  };
}
afterEach(() => {
  jest.useRealTimers();
});
describe("native live scanning", () => {
  it("uses the existing live adapter for all seven exact barcodes/SKUs and current product QR labels", async () => {
    const request = jest.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: { nodes: PREVIEW_CATALOG_SELECTION.map((_, i) => raw(i)) },
          }),
          {
            headers: {
              "content-type": "application/json",
              "x-shopify-api-version": "2026-07",
            },
          },
        ),
    );
    const api = new PublicCatalogApi(request);
    for (let i = 0; i < PREVIEW_CATALOG_SELECTION.length; i++) {
      const p = PREVIEW_CATALOG_SELECTION[i];
      expect((await api.scan(p.barcode)).product.selectedVariantId).toBe(
        p.variantId,
      );
      expect((await api.scan(p.barcode, undefined, p.barcode.length === 12 ? "ean13" : "code128")).product.selectedVariantId).toBe(p.variantId);
      expect(
        (await api.scan(`SYNTHETIC-${i}`, undefined, "code128")).product
          .selectedVariantId,
      ).toBe(p.variantId);
      expect(
        (
          await api.scan(
            `https://9i3hnb-jw.myshopify.com/products/${p.handle}`,
            undefined,
            "qr",
          )
        ).product.selectedVariantId,
      ).toBe(p.variantId);
    }
    expect(
      (await api.scan("0746134150968", undefined, "ean13")).product
        .selectedVariantId,
    ).toBe(PREVIEW_CATALOG_SELECTION[0].variantId);
    await expect(api.scan("746134157646")).rejects.toThrow("not_found");
    await expect(api.scan("https://evil.example/qr")).rejects.toThrow(
      "unsupported_qr",
    );
    expect(
      request.mock.calls.every(([url]) => url === PUBLIC_CATALOG_ENDPOINT),
    ).toBe(true);
  });
  it("only delegates opaque QR lookup to the fixed backend port, never to the scanned URL", async () => {
    const request = jest.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: { nodes: PREVIEW_CATALOG_SELECTION.map((_, i) => raw(i)) },
          }),
          {
            headers: {
              "content-type": "application/json",
              "x-shopify-api-version": "2026-07",
            },
          },
        ),
    );
    const fallback = {
      scan: jest.fn<PublicCatalogApi["scan"]>(async () => {
        throw Error("registry unavailable");
      }),
    };
    await expect(
      new PublicCatalogApi(request, 12000, fallback).scan(
        "https://native.example/q/abcdefghijklmnopqrstuvwx",
        undefined,
        "qr",
      ),
    ).rejects.toThrow("registry unavailable");
    expect(fallback.scan).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(PUBLIC_CATALOG_ENDPOINT);
  });
});
describe("persistent opaque native cart", () => {
  it("restores a canonical cart after process restart without creating a second cart or storing contents", async () => {
    const h = shoppingHarness(),
      first = new ShoppingController(h.port, Date.now, true, h.storage);
    await first.add(
      "746134150968",
      PREVIEW_CATALOG_SELECTION[0].variantId,
      6995,
    );
    expect(h.saved()).toBe("S".repeat(43));
    expect(first.snapshot().cart?.lines[0].quantity).toBe(1);
    expect(JSON.stringify(first.snapshot())).not.toContain("S".repeat(43));
    first.dispose();
    const restarted = new ShoppingController(h.port, Date.now, true, h.storage);
    await restarted.restore();
    expect(h.calls).toEqual(["start", "add", "read"]);
    expect(restarted.snapshot().cart?.lines[0].quantity).toBe(1);
    restarted.dispose();
  });
  it("does not create a cart on empty restoration or show cached prices while offline", async () => {
    const h = shoppingHarness(),
      first = new ShoppingController(h.port, Date.now, true, h.storage);
    await first.restore();
    expect(h.calls).toEqual([]);
    await first.add(
      "746134150968",
      PREVIEW_CATALOG_SELECTION[0].variantId,
      6995,
    );
    first.dispose();
    h.offline();
    const restored = new ShoppingController(h.port, Date.now, true, h.storage);
    await expect(restored.restore()).rejects.toThrow("service_unavailable");
    expect(restored.snapshot().cart).toBeUndefined();
    expect(restored.snapshot().needsRefresh).toBe(true);
    restored.dispose();
  });
  it("fails closed on SecureStore read/write failures before an Add is sent", async () => {
    const h = shoppingHarness();
    const brokenRead = new ShoppingController(h.port, Date.now, true, {
      ...h.storage,
      get: async () => {
        throw Error("PRIVATE storage failure");
      },
    });
    await expect(
      brokenRead.add(
        "746134150968",
        PREVIEW_CATALOG_SELECTION[0].variantId,
        6995,
      ),
    ).rejects.toThrow("storage_unavailable");
    expect(h.calls).toEqual([]);
    brokenRead.dispose();
    const brokenWrite = new ShoppingController(h.port, Date.now, true, {
      ...h.storage,
      set: async () => {
        throw Error("PRIVATE storage failure");
      },
    });
    await expect(
      brokenWrite.add(
        "746134150968",
        PREVIEW_CATALOG_SELECTION[0].variantId,
        6995,
      ),
    ).rejects.toThrow("storage_unavailable");
    expect(h.calls).toEqual(["start"]);
    brokenWrite.dispose();
  });
  it("does not release the duplicate-action guard when prices expire during a pending write", async () => {
    jest.useFakeTimers();
    const h = shoppingHarness(),
      c = new ShoppingController(h.port, Date.now, true, h.storage);
    await c.add("746134150968", PREVIEW_CATALOG_SELECTION[0].variantId, 6995);
    jest.advanceTimersByTime(59000);
    h.delay();
    const writing = c.add(
      "746134150968",
      PREVIEW_CATALOG_SELECTION[0].variantId,
      6995,
    );
    for (let i = 0; i < 20; i++) await Promise.resolve();
    jest.advanceTimersByTime(1001);
    expect(c.snapshot().busy).toBe(true);
    expect(c.snapshot().cart).toBeUndefined();
    await c.add("746134150968", PREVIEW_CATALOG_SELECTION[0].variantId, 6995);
    expect(h.calls.filter((x) => x === "add")).toHaveLength(2);
    h.release();
    await writing;
    expect(c.snapshot().cart?.lines[0].quantity).toBe(2);
    c.dispose();
  });
  it("keeps commerce configuration separate from account APIs and rejects partial or production setup", () => {
    const env = {
      ...profile.build.preview.ios.env,
      MOBILE_APP_VARIANT: "preview",
      MOBILE_NATIVE_SCAN_CART: "true",
      MOBILE_PREVIEW_COMMERCE_API_ORIGIN: "https://native.example",
    };
    const config = createAppConfig(env);
    expect(config.extra?.mobile.commerceApiOrigin).toBe(
      "https://native.example",
    );
    expect(config.extra?.mobile.apiOrigin).toBeUndefined();
    expect(config.extra?.mobile.servicesConnected).toBe(false);
    expect(() =>
      createAppConfig({
        ...env,
        MOBILE_PREVIEW_COMMERCE_API_ORIGIN: undefined,
      }),
    ).toThrow(/separate approved preview/);
    expect(() =>
      createAppConfig({ ...env, MOBILE_APP_VARIANT: "production" }),
    ).toThrow(/separate approved preview/);
    expect(() =>
      createAppConfig({
        ...env,
        MOBILE_PREVIEW_API_ORIGIN: "https://customer.example",
      }),
    ).toThrow(/separate approved preview/);
  });
});
