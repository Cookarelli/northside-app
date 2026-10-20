import { describe, expect, it, vi } from "vitest";
import {
  createPosBridge,
  type PosApi,
  type HandoffBackend,
  parseHandoff,
} from "../apps/shopify-extension/src/bridge";
const reference = "abcdefghijklmnopabcdefghijklmnop";
const origin = "https://northside.example";
const url = `${origin}/in-store/staff?handoff=${reference}`;
function setup() {
  const api: PosApi = {
    session: { getSessionToken: vi.fn(async () => "session-jwt") },
    cart: {
      current: { value: { lineItems: [], properties: {} } },
      addLineItem: vi.fn(async () => "line-uuid"),
      addCartProperties: vi.fn(async () => {}),
    },
    scanner: {
      showCameraScanner: vi.fn(),
      hideCameraScanner: vi.fn(),
      scannerData: { current: { subscribe: vi.fn(() => () => {}) } },
    },
  };
  const backend: HandoffBackend = {
    claim: vi.fn(async () => ({
      reference,
      version: 3,
      paymentReference: "server-reference",
      lines: [{ variantId: 123, quantity: 2 }],
    })),
    imported: vi.fn(async () => {}),
  };
  return { api, backend, bridge: createPosBridge(api, backend, origin) };
}
describe("POS bridge prototype (mock APIs only)", () => {
  it("checks the exact QR origin/path and refuses foreign or collection URLs", () => {
    expect(parseHandoff(url, origin)).toBe(reference);
    expect(() =>
      parseHandoff(url.replace(origin, "https://evil.example"), origin),
    ).toThrow("Northside");
    expect(() =>
      parseHandoff(`${origin}/in-store/staff?collection=other`, origin),
    ).toThrow("Invalid");
  });
  it("claims once, adds numeric variants and correlation properties without pretending to pay", async () => {
    const { api, backend, bridge } = setup();
    await bridge.import(url);
    expect(api.cart.addLineItem).toHaveBeenCalledWith(123, 2);
    expect(api.cart.addCartProperties).toHaveBeenCalledWith({
      _northside_reference: "server-reference",
      _northside_basket_version: "3",
    });
    expect(backend.imported).toHaveBeenCalledOnce();
    await expect(bridge.import(url)).rejects.toThrow("already attempted");
  });
  it("preserves staff carts and blocks replay after uncertain partial import", async () => {
    const a = setup();
    a.api.cart.current.value.lineItems.push({ existing: true });
    await expect(a.bridge.import(url)).rejects.toThrow("empty");
    expect(a.backend.claim).not.toHaveBeenCalled();
    const b = setup();
    vi.mocked(b.api.cart.addLineItem).mockRejectedValue(
      new Error("network interrupted"),
    );
    await expect(b.bridge.import(url)).rejects.toThrow("interrupted");
    await expect(b.bridge.import(url)).rejects.toThrow("already attempted");
    expect(b.backend.imported).not.toHaveBeenCalled();
  });
});
