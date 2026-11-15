import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Text } from "react-native";
import { createHash } from "node:crypto";
import type { AuthSnapshot } from "../src/auth/controller";
import { MobileApi } from "../src/api/client";
import { ShoppingProvider, useShopping } from "../src/shopping/Provider";
import type {
  ShoppingAction,
  ShoppingResponse,
} from "@northside/customer-contracts/shopping";

const ORIGIN = "https://native-stage.example.test";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const mockStored = new Map<string, string>();
const mockGet = jest.fn<(key: string) => Promise<string | null>>(
  async (key) => mockStored.get(key) ?? null,
);
const mockSet = jest.fn<(key: string, value: string) => Promise<void>>(
  async (key, value) => {
    mockStored.set(key, value);
  },
);
const mockRemove = jest.fn<(key: string) => Promise<void>>(async (key) => {
  mockStored.delete(key);
});
let mockState: AuthSnapshot = { status: "booting", busy: false };
let mockPrincipal = "booting";
let mockOrigin = ORIGIN;
let mockRc = true;
const mockShopping =
  jest.fn<
    (
      api: MobileApi,
      action: ShoppingAction,
      handle?: string,
      signal?: AbortSignal,
    ) => Promise<ShoppingResponse>
  >();
const mockAuth = {
  shoppingIdentity: () => mockPrincipal,
  shoppingOn: mockShopping,
};
let mockApi: MobileApi;
jest.mock("../src/auth/Provider", () => ({
  useCustomerAuth: () => ({ state: mockState, controller: mockAuth }),
}));
jest.mock("../src/mvp/Provider", () => ({
  useMvp: () => ({ api: mockApi, active: true }),
}));
jest.mock("../src/private-preview/context", () => ({
  usePrivatePreview: () => null,
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        extra: {
          mobile: {
            variant: "preview",
            releaseCandidate: mockRc,
            apiOrigin: mockOrigin,
          },
        },
      };
    },
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) => {
    const crypto =
      jest.requireActual<typeof import("node:crypto")>("node:crypto");
    return crypto.createHash("sha256").update(value).digest("hex");
  },
}));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: async () => true,
  getItemAsync: (key: string) => mockGet(key),
  setItemAsync: (key: string, value: string) => mockSet(key, value),
  deleteItemAsync: (key: string) => mockRemove(key),
}));

function account(id: string): AuthSnapshot {
  return {
    status: "authenticated",
    busy: false,
    account: {
      contractVersion: "northside.mobile.v1",
      kind: "account",
      customer: { id, firstName: "SAMPLE", lastName: null, email: null },
      sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  };
}
function keyFor(principal: string, origin = ORIGIN) {
  return (
    "northside.cart." +
    createHash("sha256")
      .update(JSON.stringify(["preview", origin, principal]))
      .digest("hex")
  );
}
function response(title: string): ShoppingResponse {
  return {
    contractVersion: "northside.mobile.v1",
    kind: "shopping",
    cart: {
      version: 1,
      source: "shopify_cart",
      sample: false,
      phase: "shopping",
      lines: [
        {
          variantId: "gid://shopify/ProductVariant/1",
          productId: "gid://shopify/Product/1",
          title,
          variantTitle: "Default",
          image: null,
          sku: null,
          quantity: 1,
          priceCents: 100,
          lineTotalCents: 100,
          availability: "available",
        },
      ],
      subtotalCents: 100,
      currency: "USD",
      paymentStatus: "unpaid",
      handoff: null,
      cost: {
        subtotalCents: 100,
        totalCents: 100,
        estimated: true,
        checkoutEnabled: false,
      },
      observedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
}
function Probe() {
  const { state } = useShopping();
  return <Text>{state.cart?.lines[0]?.title ?? state.error ?? state.status}</Text>;
}
const App = () => (
  <ShoppingProvider>
    <Probe />
  </ShoppingProvider>
);
beforeEach(() => {
  mockStored.clear();
  mockGet.mockClear();
  mockSet.mockClear();
  mockRemove.mockClear();
  mockShopping.mockReset();
  mockState = { status: "booting", busy: false };
  mockPrincipal = "booting";
  mockOrigin = ORIGIN;
  mockRc = true;
  mockApi = new MobileApi(mockOrigin);
  mockShopping.mockImplementation(async (_api, _action, handle) =>
    response(
      handle === "B".repeat(43)
        ? "Customer B cart"
        : handle === "A".repeat(43)
          ? "Customer A cart"
          : "Guest cart",
    ),
  );
});
afterEach(cleanup);

describe("connected internal RC cart restoration", () => {
  it("waits for authentication boot before reading a saved device handle", async () => {
    mockStored.set(await keyFor("signed_out"), "G".repeat(43));
    const view = await render(<App />);
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockShopping).not.toHaveBeenCalled();
    mockState = { status: "signed_out", busy: false };
    mockPrincipal = "signed_out";
    await view.rerender(<App />);
    await waitFor(() => expect(screen.getByText("Guest cart")).toBeTruthy());
    expect(mockShopping).toHaveBeenCalledWith(
      mockApi,
      { action: "read" },
      "G".repeat(43),
      expect.any(AbortSignal),
    );
  });
  it("restores the same customer after a new auth generation without persisting cart contents or credentials", async () => {
    const key = await keyFor(`customer:${A}`);
    mockStored.set(key, "A".repeat(43));
    mockState = account(A);
    mockPrincipal = A + ":old-generation";
    const view = await render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Customer A cart")).toBeTruthy(),
    );
    await view.unmount();
    mockPrincipal = A + ":new-generation";
    await render(<App />);
    await waitFor(() => expect(mockShopping).toHaveBeenCalledTimes(2));
    expect(mockGet.mock.calls.every(([value]) => value === key)).toBe(true);
    expect([...mockStored.values()]).toEqual(["A".repeat(43)]);
    expect(JSON.stringify([...mockStored])).not.toContain("Customer A cart");
    expect(key).not.toContain(A);
  });
  it("switches customer storage namespaces and never restores another customer's handle", async () => {
    mockStored.set(await keyFor(`customer:${A}`), "A".repeat(43));
    mockStored.set(await keyFor(`customer:${B}`), "B".repeat(43));
    mockState = account(A);
    mockPrincipal = A + ":one";
    const view = await render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Customer A cart")).toBeTruthy(),
    );
    mockState = account(B);
    mockPrincipal = B + ":two";
    await view.rerender(<App />);
    await waitFor(() =>
      expect(screen.getByText("Customer B cart")).toBeTruthy(),
    );
    expect(screen.queryByText("Customer A cart")).toBeNull();
    expect(mockShopping.mock.calls.at(-1)?.[2]).toBe("B".repeat(43));
  });
  it("keeps origins separate and leaves non-RC standard clients without automatic restoration", async () => {
    mockStored.set(await keyFor(`customer:${A}`), "A".repeat(43));
    mockState = account(A);
    mockPrincipal = A + ":one";
    mockOrigin = "https://another-stage.example.test";
    mockApi = new MobileApi(mockOrigin);
    const view = await render(<App />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockShopping).not.toHaveBeenCalled();
    expect(mockGet.mock.calls[0][0]).toBe(
      await keyFor(`customer:${A}`, mockOrigin),
    );
    await view.unmount();
    mockGet.mockClear();
    mockRc = false;
    await render(<App />);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockShopping).not.toHaveBeenCalled();
  });
});
