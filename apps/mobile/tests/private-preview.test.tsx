import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createCipheriv, pbkdf2Sync, webcrypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, Platform, Text, type AppStateStatus } from "react-native";
import { catalogProductV1Schema } from "@northside/customer-contracts";
import {
  PrivateCatalogApi,
  parsePrivateCatalog,
} from "../src/private-preview/catalog";
import {
  decryptPrivateCatalog,
  PRIVATE_FORMAT,
  PRIVATE_ITERATIONS,
} from "../src/private-preview/crypto";
import { PrivatePreviewGate } from "../src/private-preview/Gate";
import { createAppConfig } from "../config/app";

Object.assign(globalThis, { TextEncoder, TextDecoder });
const code = "S".repeat(43);
function selection() {
  const id = "gid://shopify/Product/123",
    handle = "preview-" + "a".repeat(24);
  return {
    version: "northside.private-catalog.v1",
    shop: "9i3hnb-jw.myshopify.com",
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    products: [
      {
        id,
        handle,
        title: "Synthetic private card",
        description: "",
        productType: "Synthetic cards",
        publication: "draft",
        availableForSale: false,
        featuredImage: null,
        minVariantPrice: { amountCents: 1995, currencyCode: "USD" },
        variants: {
          after: null,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/ProductVariant/456",
              productId: id,
              title: "Regular",
              identifiers: { state: "not_provided", sku: null, barcode: null },
              price: { amountCents: 1995, currencyCode: "USD" },
              availability: {
                state: "unavailable",
                availableForSale: false,
                currentlyNotInStock: false,
                quantityAvailable: null,
              },
            },
          ],
        },
        selectedVariantId: null,
        productPath: "/shop/" + handle,
        onlineStoreUrl: null,
      },
    ],
  };
}
function seal(value: unknown) {
  const salt = Buffer.alloc(16, 1),
    iv = Buffer.alloc(12, 2),
    key = pbkdf2Sync(code, salt, PRIVATE_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(PRIVATE_FORMAT));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    version: PRIVATE_FORMAT,
    iterations: PRIVATE_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
describe("private Draft selection boundary", () => {
  it("decrypts the exact encrypted DTO and preserves Draft status", async () => {
    const original = selection(),
      envelope = seal(original);
    expect(JSON.stringify(envelope)).not.toContain("Synthetic private card");
    expect(
      await decryptPrivateCatalog(
        envelope,
        code,
        webcrypto as unknown as Crypto,
      ),
    ).toEqual(original);
    expect(catalogProductV1Schema.safeParse(original.products[0]).success).toBe(
      false,
    );
  });
  it("rejects an incorrect access code", async () => {
    await expect(
      decryptPrivateCatalog(
        seal(selection()),
        "X".repeat(43),
        webcrypto as unknown as Crypto,
      ),
    ).rejects.toThrow();
  });
  it("rejects tampered ciphertext", async () => {
    const envelope = seal(selection());
    envelope.ciphertext =
      (envelope.ciphertext[0] === "A" ? "B" : "A") +
      envelope.ciphertext.slice(1);
    await expect(
      decryptPrivateCatalog(envelope, code, webcrypto as unknown as Crypto),
    ).rejects.toThrow();
  });
  it("rejects altered KDF parameters without doing attacker-selected work", async () => {
    await expect(
      decryptPrivateCatalog(
        { ...seal(selection()), iterations: 999999999 },
        code,
        webcrypto as unknown as Crypto,
      ),
    ).rejects.toThrow();
  });
  it.each(["totalInventory", "cost", "staffNotes", "checkoutUrl"])(
    "rejects exposed %s",
    (key) => {
      const s = selection();
      Object.assign(s.products[0], { [key]: "private" });
      expect(() => parsePrivateCatalog(s)).toThrow();
    },
  );
  it("rejects mismatched variants, inventory quantities and claimed live sale availability", () => {
    const s = selection();
    s.products[0].variants.nodes[0].productId = "gid://shopify/Product/999";
    expect(() => parsePrivateCatalog(s)).toThrow();
    const t = selection();
    Object.assign(t.products[0].variants.nodes[0].availability, {
      quantityAvailable: 99,
    });
    expect(() => parsePrivateCatalog(t)).toThrow();
    const u = selection();
    u.products[0].availableForSale = true;
    expect(() => parsePrivateCatalog(u)).toThrow();
  });
  it("rejects real handles, foreign photos, expired selections and duplicate IDs", () => {
    const s = selection();
    s.products[0].handle = "real-product-name";
    expect(() => parsePrivateCatalog(s)).toThrow();
    const p = selection();
    Object.assign(p.products[0], {
      featuredImage: { url: "https://evil.example/private.png", altText: null },
    });
    expect(() => parsePrivateCatalog(p)).toThrow();
    const t = selection();
    t.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(() => parsePrivateCatalog(t)).toThrow();
    const u = selection();
    u.products.push(u.products[0]);
    expect(() => parsePrivateCatalog(u)).toThrow();
  });
  it("searches only the selected snapshot, rejects outside products and disposes the data", async () => {
    const api = new PrivateCatalogApi(parsePrivateCatalog(selection()));
    expect(
      (await api.catalog({ q: "private", category: "Synthetic cards" }))
        .products,
    ).toHaveLength(1);
    expect((await api.catalog({ q: "missing" })).products).toHaveLength(0);
    await expect(api.product("unknown")).rejects.toThrow("not_found");
    await expect(api.scan("123")).rejects.toThrow("not_configured");
    await expect(api.catalog({ feed: "singles-new-arrivals" })).rejects.toThrow(
      "not_configured",
    );
    api.dispose();
    await expect(api.catalog()).rejects.toThrow("session_expired");
    expect("checkout" in api).toBe(false);
  });
  it.each([
    { MOBILE_APP_VARIANT: "production" },
    { EAS_BUILD: "true" },
    { MOBILE_PREVIEW_API_ORIGIN: "https://stage.example.test" },
    { MOBILE_IOS_INTERFACE_PREVIEW: "true" },
  ])("cannot widen a public/native build guard %j", (extra) => {
    expect(() =>
      createAppConfig({
        MOBILE_APP_VARIANT: "preview",
        MOBILE_PRIVATE_CATALOG_PREVIEW: "true",
        ...extra,
      }),
    ).toThrow(/disconnected browser preview/);
  });
});
describe("whole-app private gate", () => {
  it("does not mount customer routes or load data before the access code", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    const load = jest.fn(async () => parsePrivateCatalog(selection()));
    await render(
      <PrivatePreviewGate enabled load={load}>
        <Text>Protected catalog</Text>
      </PrivatePreviewGate>,
    );
    expect(screen.queryByText("Protected catalog")).toBeNull();
    expect(load).not.toHaveBeenCalled();
    await fireEvent.changeText(
      screen.getByLabelText("Private preview access code"),
      code,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open collection" }),
    );
    expect(screen.getByText("Protected catalog")).toBeVisible();
  });
  it("clears a rejected code without exposing routes", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await render(
      <PrivatePreviewGate
        enabled
        load={async () => {
          throw new Error("wrong");
        }}
      >
        <Text>Protected catalog</Text>
      </PrivatePreviewGate>,
    );
    await fireEvent.changeText(
      screen.getByLabelText("Private preview access code"),
      code,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open collection" }),
    );
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Protected catalog")).toBeNull();
    expect(
      screen.getByLabelText("Private preview access code"),
    ).toHaveDisplayValue("");
  });
  it("discards a delayed decrypt result after cancellation", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    let finish!: (s: ReturnType<typeof parsePrivateCatalog>) => void;
    const deferred = new Promise<ReturnType<typeof parsePrivateCatalog>>(
      (r) => {
        finish = r;
      },
    );
    await render(
      <PrivatePreviewGate enabled load={() => deferred}>
        <Text>Protected catalog</Text>
      </PrivatePreviewGate>,
    );
    await fireEvent.changeText(
      screen.getByLabelText("Private preview access code"),
      code,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open collection" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      finish(parsePrivateCatalog(selection()));
      await deferred;
    });
    expect(screen.queryByText("Protected catalog")).toBeNull();
  });
  it("removes protected routes on background and after the absolute viewing timeout", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    jest.useFakeTimers();
    let appChange!: (s: AppStateStatus) => void;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_, cb) => {
      appChange = cb;
      return { remove() {} };
    });
    await render(
      <PrivatePreviewGate
        enabled
        load={async () => parsePrivateCatalog(selection())}
      >
        <Text>Protected catalog</Text>
      </PrivatePreviewGate>,
    );
    async function open() {
      await fireEvent.changeText(
        screen.getByLabelText("Private preview access code"),
        code,
      );
      await fireEvent.press(
        screen.getByRole("button", { name: "Open collection" }),
      );
    }
    await open();
    expect(screen.getByText("Protected catalog")).toBeVisible();
    await act(async () => {
      appChange("background");
    });
    expect(screen.queryByText("Protected catalog")).toBeNull();
    await open();
    await act(async () => {
      jest.advanceTimersByTime(1800000);
    });
    expect(screen.queryByText("Protected catalog")).toBeNull();
  });
});
