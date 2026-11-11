import { describe, expect, it } from "vitest";
import { MOBILE_CONTRACT_VERSION } from "./mobile";
import {
  shoppingActionSchema,
  shoppingCartSchema,
  shoppingResponseSchema,
  shoppingErrorSchema,
} from "./shopping";

const line = {
  productId: "gid://shopify/Product/8001",
  variantId: "gid://shopify/ProductVariant/8001",
  title: "SYNTHETIC product",
  variantTitle: "Base",
  image: null,
  quantity: 2,
  priceCents: 1200,
};
const cart = {
  version: 2,
  sample: false,
  phase: "shopping",
  lines: [line],
  subtotalCents: 2400,
  currency: "USD",
  paymentStatus: "unpaid",
  handoff: null,
};
const response = {
  contractVersion: MOBILE_CONTRACT_VERSION,
  kind: "shopping",
  cart,
};
describe("portable unpaid shopping contract", () => {
  it("accepts known actions and compares reviewed cents without accepting price authority", () => {
    for (const action of [
      { action: "start" },
      { action: "read" },
      {
        action: "add",
        version: 2,
        code: "0012345678905",
        format: "ean13",
        variantId: line.variantId,
        reviewedPriceCents: 1200,
      },
      { action: "set", version: 2, variantId: line.variantId, quantity: 0 },
      { action: "ready", version: 2 },
      { action: "cancel", version: 2 },
    ])
      expect(shoppingActionSchema.parse(action)).toEqual(action);
  });
  it("rejects forged identity, inventory, payment, mode and staff operations", () => {
    for (const field of [
      "owner",
      "customerId",
      "tenant",
      "paid",
      "price",
      "mode",
      "checkoutUrl",
      "staff",
      "inventory",
    ])
      expect(
        shoppingActionSchema.safeParse({ action: "start", [field]: "FORGED" })
          .success,
      ).toBe(false);
    for (const action of ["inspect", "pay", "checkout", "mark-paid"])
      expect(shoppingActionSchema.safeParse({ action }).success).toBe(false);
  });
  it("bounds quantities, cents, versions, format, barcode text and variant identity", () => {
    const action = {
      action: "set",
      version: 2,
      variantId: line.variantId,
      quantity: 99,
    };
    expect(shoppingActionSchema.parse(action)).toEqual(action);
    for (const quantity of [-1, 100, 1.5, "1", null])
      expect(
        shoppingActionSchema.safeParse({ ...action, quantity }).success,
      ).toBe(false);
    for (const variantId of [
      "gid://shopify/Product/1",
      "gid://shopify/ProductVariant/0",
      "x",
    ])
      expect(
        shoppingActionSchema.safeParse({ ...action, variantId }).success,
      ).toBe(false);
    for (const code of ["", "\n", "a".repeat(2049)])
      expect(
        shoppingActionSchema.safeParse({
          action: "add",
          version: 1,
          variantId: line.variantId,
          reviewedPriceCents: 1,
          code,
        }).success,
      ).toBe(false);
  });
  it("accepts missing images and exact cents without quantity/location metadata", () => {
    expect(shoppingResponseSchema.parse(response)).toEqual(response);
    for (const field of [
      "sku",
      "barcode",
      "quantityAvailable",
      "locations",
      "cost",
      "customerId",
      "code",
    ])
      expect(
        shoppingCartSchema.safeParse({
          ...cart,
          lines: [{ ...line, [field]: "PRIVATE" }],
        }).success,
      ).toBe(false);
    expect(
      shoppingCartSchema.safeParse({ ...cart, paymentStatus: "paid" }).success,
    ).toBe(false);
    expect(
      shoppingCartSchema.safeParse({ ...cart, currency: "CAD" }).success,
    ).toBe(false);
  });
  it("rejects malformed records, unsafe subtotal overflow and duplicate variants", () => {
    for (const invalid of [
      { ...cart, subtotalCents: 1 },
      { ...cart, lines: [line, line], subtotalCents: 4800 },
      {
        ...cart,
        lines: Array.from({ length: 51 }, (_, index) => ({
          ...line,
          variantId: `gid://shopify/ProductVariant/${index + 1}`,
        })),
        subtotalCents: 122400,
      },
      {
        ...cart,
        lines: [{ ...line, quantity: 99, priceCents: Number.MAX_SAFE_INTEGER }],
        subtotalCents: Number.MAX_SAFE_INTEGER,
      },
      {
        ...cart,
        lines: [
          {
            ...line,
            image: {
              url: "https://foreign.invalid/private.jpg",
              altText: null,
            },
          },
        ],
      },
    ])
      expect(shoppingCartSchema.safeParse(invalid).success).toBe(false);
  });
  it("handoff has a matching phase, nonempty list, opaque reference and bounded QR", () => {
    const handoff = { reference: "A".repeat(43), expiresAt: 1800000000000 };
    expect(
      shoppingResponseSchema.safeParse({
        ...response,
        cart: { ...cart, phase: "ready_for_staff", handoff },
        qr: "data:image/png;base64,aGVsbG8=",
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...response, qr: "data:image/png;base64,aGVsbG8=" },
      { ...response, cart: { ...cart, handoff } },
      {
        ...response,
        cart: { ...cart, phase: "ready_for_staff", handoff: null },
      },
      {
        ...response,
        cart: {
          ...cart,
          phase: "ready_for_staff",
          handoff,
          lines: [],
          subtotalCents: 0,
        },
      },
      { ...response, sessionToken: "bad" },
      { ...response, qr: "https://foreign.invalid/code.png" },
      { ...response, qr: "data:image/png;base64," + "A".repeat(100000) },
    ])
      expect(shoppingResponseSchema.safeParse(invalid).success).toBe(false);
  });
  it("errors expose only an allowlisted symbolic code and correlation ID", () => {
    const failure = {
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "error",
      error: { code: "cart_changed_reload" },
      requestId: "8324f421-7132-4ae0-8f0c-152a17f1d00e",
    };
    expect(shoppingErrorSchema.parse(failure)).toEqual(failure);
    expect(
      shoppingErrorSchema.safeParse({
        ...failure,
        error: { code: "raw provider secret" },
      }).success,
    ).toBe(false);
    expect(
      shoppingErrorSchema.safeParse({ ...failure, stack: "PRIVATE" }).success,
    ).toBe(false);
  });
});
