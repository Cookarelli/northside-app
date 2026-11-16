import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { act } from "@testing-library/react-native";
import { createElement } from "react";
import {
  renderRouter,
  screen,
  fireEvent,
  waitFor,
} from "expo-router/testing-library";
import { AppState, type AppStateStatus } from "react-native";
import RootLayout from "../src/app/_layout";
import TabLayout from "../src/app/(tabs)/_layout";
import Home from "../src/app/(tabs)/index";
import Shop from "../src/app/(tabs)/shop";
import Scan from "../src/app/(tabs)/scan";
import Wallet from "../src/app/(tabs)/wallet";
import Account from "../src/app/(tabs)/account";
import Product from "../src/app/product/[handle]";
import Privacy from "../src/app/privacy";
import { MvpProvider } from "../src/mvp/Provider";
import { MobileApi } from "../src/api/client";
import { MobileFailure } from "../src/api/client";
import { AuthController, type AuthPorts } from "../src/auth/controller";
import * as native from "../src/auth/native";
import * as controls from "../src/components/Controls";
import { MOBILE_CONTRACT_VERSION as contractVersion } from "@northside/customer-contracts/mobile";
import type {
  ShoppingAction,
  ShoppingCart,
} from "@northside/customer-contracts/shopping";
import type { MobileProduct } from "@northside/customer-contracts/mvp";
import * as barcodeCamera from "../src/shopping/BarcodeCamera";

let mockPermission = {
  granted: true,
  canAskAgain: true,
  status: "granted",
  expires: "never",
};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: null,
    platform: { ios: { buildNumber: "10" } },
    executionEnvironment: "standalone",
  },
}));
const mockLenses = jest.fn<
  () => Promise<{ deviceType: string; localizedName: string }[]>
>(async () => []);
const cameraCaps = {
  visibleRegion: { x: 0, y: 0.2, width: 1, height: 0.6 },
  minZoomFactor: 1,
  maxZoomFactor: 16,
  maxAvailableZoomFactor: 16,
  currentZoomFactor: 1,
  actualFormatWidth: 1920,
  actualFormatHeight: 1080,
  deviceType: "AVCaptureDeviceTypeBuiltInWideAngleCamera",
  hasTorch: true,
  isTorchAvailable: true,
  continuousAutoFocusSupported: true,
  continuousAutoExposureSupported: true,
};
const mockPrepareCamera = jest.fn<() => Promise<typeof cameraCaps>>(
  async () => cameraCaps,
);
jest.mock("../src/shopping/camera-capabilities", () => ({
  ...jest.requireActual<typeof import("../src/shopping/camera-capabilities")>(
    "../src/shopping/camera-capabilities",
  ),
  prepareBarcodeCamera: () => mockPrepareCamera(),
}));
const mockRequest = jest.fn<() => Promise<typeof mockPermission>>(
  async () => mockPermission,
);
const mockGetPermission = jest.fn<() => Promise<typeof mockPermission>>(
  async () => mockPermission,
);
jest.mock("expo-camera", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useCameraPermissions: () => [
      mockPermission,
      mockRequest,
      mockGetPermission,
    ],
    CameraView: React.forwardRef(function MockCameraView(props: object, ref) {
      React.useImperativeHandle(ref, () => ({
        getAvailableLensesAsync: mockLenses,
      }));
      return React.createElement(RN.View, props);
    }),
  };
});
const customerId = "11111111-1111-4111-8111-111111111111";
const opaque = "A".repeat(43);
function product(): MobileProduct["product"] {
  return {
    id: "gid://shopify/Product/1",
    handle: "synthetic-item",
    title: "Synthetic Approved Card",
    description: "Synthetic test product only.",
    productType: "Sports Cards",
    publication: "published",
    availableForSale: true,
    featuredImage: null,
    minVariantPrice: { amountCents: 1234, currencyCode: "USD" },
    variants: {
      after: null,
      nodes: [
        {
          id: "gid://shopify/ProductVariant/11",
          productId: "gid://shopify/Product/1",
          title: "Base",
          identifiers: {
            state: "observed",
            sku: "SYNTHETIC",
            barcode: "036000291452",
          },
          price: { amountCents: 1234, currencyCode: "USD" },
          availability: {
            state: "unknown",
            availableForSale: true,
            currentlyNotInStock: false,
            quantityAvailable: null,
          },
        },
        {
          id: "gid://shopify/ProductVariant/12",
          productId: "gid://shopify/Product/1",
          title: "Parallel",
          identifiers: { state: "observed", sku: "TEST-2", barcode: null },
          price: { amountCents: 2000, currencyCode: "USD" },
          availability: {
            state: "unavailable",
            availableForSale: false,
            currentlyNotInStock: false,
            quantityAvailable: null,
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    selectedVariantId: null,
    productPath: "/shop/synthetic-item",
    onlineStoreUrl: null,
  };
}
function harness() {
  let offline = false,
    unknown: boolean | string = false,
    onlyRemainingVariant = false,
    currentCustomer = customerId,
    appState = "",
    walletUnavailable = false;
  const absolute = new Date(Date.now() + 3600000).toISOString();
  const scans: string[] = [];
  const shoppingActions: ShoppingAction[] = [];
  let shoppingCart: ShoppingCart = {
    version: 1,
    sample: true,
    phase: "shopping",
    lines: [],
    subtotalCents: 0,
    currency: "USD",
    paymentStatus: "unpaid",
    handoff: null,
  };
  let scanTransform = (value: ReturnType<typeof product>) => value;
  let shoppingOffline = false;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const response = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { "content-type": "application/json" },
    });
  const request = jest.fn<typeof fetch>(async (url, init) => {
    if (offline) throw Error("PRIVATE RAW NETWORK DETAIL");
    const u = new URL(String(url)),
      path = u.pathname,
      body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, string>)
        : undefined;
    if (path.endsWith("/shopping")) {
      if (shoppingOffline) throw Error("PRIVATE shopping transport detail");
      const action = JSON.parse(String(init?.body)) as ShoppingAction;
      shoppingActions.push(action);
      if (action.action === "add") {
        const quantity = (shoppingCart.lines[0]?.quantity ?? 0) + 1;
        shoppingCart = {
          ...shoppingCart,
          version: shoppingCart.version + 1,
          lines: [
            {
              variantId: action.variantId,
              productId: product().id,
              title: product().title,
              variantTitle: "Base",
              image: null,
              priceCents: 1234,
              quantity,
            },
          ],
          subtotalCents: quantity * 1234,
        };
      }
      if (action.action === "set")
        shoppingCart = {
          ...shoppingCart,
          version: shoppingCart.version + 1,
          lines: action.quantity
            ? [{ ...shoppingCart.lines[0], quantity: action.quantity }]
            : [],
          subtotalCents: action.quantity * 1234,
        };
      if (action.action === "ready")
        shoppingCart = {
          ...shoppingCart,
          version: shoppingCart.version + 1,
          phase: "ready_for_staff",
          handoff: {
            reference: "R".repeat(43),
            expiresAt: Date.now() + 600000,
          },
        };
      if (action.action === "cancel")
        shoppingCart = {
          ...shoppingCart,
          version: shoppingCart.version + 1,
          phase: "shopping",
          handoff: null,
        };
      return response({
        contractVersion,
        kind: "shopping",
        cart: shoppingCart,
        ...(action.action === "start" ? { sessionToken: "S".repeat(43) } : {}),
        ...(shoppingCart.handoff ? { qr: "data:image/png;base64,YQ==" } : {}),
      });
    }
    if (path.endsWith("/info"))
      return response({
        contractVersion,
        kind: "customer-info",
        store: {
          name: "Northside Collectibles",
          website: "https://www.northsidecollectibles.com/",
          address: "Synthetic test address",
          hours: ["Synthetic test hours"],
          phone: null,
        },
        links: {
          privacy: "https://stage.example.test/privacy",
          deletion: "https://stage.example.test/delete",
          support: "https://stage.example.test/support",
        },
        events: {
          status: "ready",
          items: [
            {
              id: customerId,
              title: "Synthetic verified event",
              description: "Only a test fixture",
              startsAt: iso(86400000),
              location: null,
            },
          ],
        },
        scanLookupConfigured: true,
      });
    if (path.endsWith("/releases"))
      return response({
        contractVersion,
        kind: "catalog",
        products: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        categories: [],
        observedAt: iso(0),
        expiresAt: iso(60000),
      });
    if (path.endsWith("/catalog"))
      return response({
        contractVersion,
        kind: "catalog",
        products:
          u.searchParams.get("q") === "unknown"
            ? []
            : [
                {
                  ...product(),
                  title: u.searchParams.has("after")
                    ? "Synthetic page two"
                    : u.searchParams.get("feed") === "singles-new-arrivals"
                      ? "Synthetic verified singles arrival"
                      : "Synthetic Approved Card",
                },
              ],
        pageInfo: {
          hasNextPage: !u.searchParams.has("after"),
          endCursor: u.searchParams.has("after") ? null : "cursor-two",
        },
        categories: ["Sports Cards"],
        observedAt: iso(0),
        expiresAt: iso(60000),
      });
    if (path.includes("/catalog/"))
      return response({
        contractVersion,
        kind: "product-detail",
        product: onlyRemainingVariant
          ? {
              ...product(),
              variants: {
                ...product().variants,
                nodes: [product().variants.nodes[1]],
              },
            }
          : product(),
        observedAt: iso(0),
        expiresAt: iso(60000),
      });
    if (path.endsWith("/scan")) {
      scans.push(body?.code ?? "");
      if (unknown === true || unknown === body?.code)
        return response(
          {
            contractVersion,
            kind: "error",
            error: { code: "not_found" },
            requestId: customerId,
          },
          404,
        );
      return response({
        contractVersion,
        kind: "product-detail",
        product: scanTransform({
          ...product(),
          selectedVariantId: "gid://shopify/ProductVariant/11",
        }),
        observedAt: iso(0),
        expiresAt: iso(60000),
      });
    }
    if (path.endsWith("/intents")) {
      appState = body?.appState ?? "";
      return response({
        contractVersion,
        kind: "auth-intent",
        intentId: opaque,
        startUrl:
          "https://stage.example.test/api/mobile/v1/auth/start?intent=" +
          opaque,
        expiresAt: iso(300000),
      });
    }
    if (path.endsWith("/renew") || path.endsWith("/exchange"))
      return response({
        contractVersion,
        kind: "session",
        accessToken: opaque,
        renewalToken: "B".repeat(43),
        accessExpiresAt: iso(600000),
        absoluteExpiresAt: absolute,
        customerId: currentCustomer,
        providerRenewal: "refresh_available",
      });
    if (path.endsWith("/logout"))
      return response({
        contractVersion,
        kind: "logout",
        revoked: true,
        providerLogout: "not_performed",
      });
    if (path.endsWith("/me"))
      return response({
        contractVersion,
        kind: "account",
        customer: {
          id: currentCustomer,
          firstName:
            currentCustomer === customerId
              ? "Synthetic Collector"
              : "Second Collector",
          lastName: null,
          email: null,
        },
        sessionExpiresAt: absolute,
      });
    if (path.endsWith("/orders"))
      return response({
        contractVersion,
        kind: "orders",
        orders: [
          {
            id: "gid://shopify/Order/123",
            name: "#SYNTHETIC123",
            processedAt: iso(-86400000),
            financialStatus: "PAID",
            total: { amountCents: 1234, currencyCode: "USD" },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    if (path.endsWith("/wallet") && walletUnavailable)
      return response({
        contractVersion,
        kind: "wallet",
        status: "unavailable",
        reason: "not_launched",
      });
    if (path.endsWith("/wallet"))
      return response({
        contractVersion,
        kind: "wallet",
        status: "ready",
        balance: 500,
        held: 50,
        available: 450,
        tier: "Verified Test Tier",
        rewards: [
          {
            id: customerId,
            title: "Synthetic read-only reward",
            pointsCost: 100,
          },
        ],
        observedAt: iso(0),
      });
    if (path.endsWith("/breaks"))
      return response({
        contractVersion,
        kind: "customer-breaks",
        items: [
          {
            id: customerId,
            title: "Synthetic owned break",
            status: "scheduled",
            source: "shopify",
            quantity: 1,
          },
        ],
      });
    if (path.endsWith("/deletion-request"))
      return response({
        contractVersion,
        kind: "deletion-request",
        request: body
          ? { id: customerId, status: "requested", createdAt: iso(0) }
          : null,
      });
    return response({ contractVersion, kind: "services", items: [] });
  });
  const api = new MobileApi(
    "https://stage.example.test",
    request,
    1000,
    async () => {},
  );
  const values = new Map<string, string>([["renewal", opaque]]);
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
      return opaque;
    },
    async challenge() {
      return opaque;
    },
    browser: {
      async open() {
        return {
          type: "success",
          url:
            "test://auth/return?ticket=" +
            opaque +
            "&intent=" +
            opaque +
            "&state=" +
            appState,
        };
      },
      dismiss() {},
    },
    now: () => Date.now(),
  };
  const controller = new AuthController(
    api,
    { variant: "development", returnUri: "test://auth/return" },
    ports,
  );
  return {
    api,
    controller,
    request,
    scans,
    shoppingActions,
    shoppingCart: () => shoppingCart,
    transformScan: (transform: typeof scanTransform) => {
      scanTransform = transform;
    },
    shoppingOffline: (value: boolean) => {
      shoppingOffline = value;
    },
    setOffline: (v: boolean) => {
      offline = v;
    },
    setUnknown: (code?: string) => {
      unknown = code ?? true;
    },
    removeScannedVariant: () => {
      onlyRemainingVariant = true;
    },
    setCustomer: () => {
      currentCustomer = "22222222-2222-4222-8222-222222222222";
    },
    unlaunched: () => {
      walletUnavailable = true;
    },
  };
}
async function renderApp(
  h: ReturnType<typeof harness>,
  url: string,
  authenticated = false,
) {
  if (authenticated) {
    jest.spyOn(native, "createNativeAuth").mockReturnValue(h.controller);
  }
  const Root = () => (
    <MvpProvider api={h.api}>
      <RootLayout />
    </MvpProvider>
  );
  await renderRouter(
    {
      _layout: Root,
      "(tabs)/_layout": TabLayout,
      "(tabs)/index": Home,
      "(tabs)/shop": Shop,
      "(tabs)/scan": Scan,
      "(tabs)/wallet": Wallet,
      "(tabs)/account": Account,
      "product/[handle]": Product,
      privacy: Privacy,
    },
    { initialUrl: url },
  );
}
beforeEach(() => {
  mockLenses.mockImplementation(async () => []);
  mockPrepareCamera.mockImplementation(async () => cameraCaps);
  mockPermission = {
    granted: true,
    canAskAgain: true,
    status: "granted",
    expires: "never",
  };
  mockRequest.mockImplementation(async () => mockPermission);
  mockGetPermission.mockImplementation(async () => mockPermission);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("customer barcode scanner", () => {
  it("opens the customer scanner without a QA control or report", async () => {
    await renderApp(harness(), "/scan");
    expect(await screen.findByTestId("product-camera")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Internal QA diagnostics" }),
    ).toBeNull();
    expect(screen.queryByTestId("scan-diagnostic-report")).toBeNull();
  });
  it.each(["camera", "manual"])(
    "resolves a valid padded GTIN from %s and sends only the verified canonical barcode on explicit Add",
    async (source) => {
      const h = harness();
      await renderApp(h, "/scan");
      if (source === "manual") {
        await fireEvent.changeText(await manualInput(), "0036000291452");
        await fireEvent.press(
          screen.getByRole("button", { name: "Look up code" }),
        );
      } else {
        await waitFor(() =>
          expect(screen.getByTestId("product-camera")).toBeVisible(),
        );
        const camera = screen.getByTestId("product-camera");
        await fireEvent(camera, "cameraReady");
        await fireEvent(camera, "barcodeScanned", {
          data: "0036000291452",
          type: "code128",
        });
      }
      await waitFor(() =>
        expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
      );
      expect(h.shoppingActions).toHaveLength(0);
      await fireEvent.press(
        screen.getByRole("button", { name: "Add to items" }),
      );
      await waitFor(() => expect(h.shoppingActions).toHaveLength(2));
      expect(h.shoppingActions[1]).toMatchObject({
        action: "add",
        code: "036000291452",
        format: "code128",
        variantId: "gid://shopify/ProductVariant/11",
      });
    },
  );
  it.each(["housing first", "product first"])(
    "chooses the retail UPC when both Code 128 labels are in view (%s)",
    async (order) => {
      const housing = "8000000421";
      const productCode = "036000291452";
      const h = harness();
      await renderApp(h, "/scan");
      const camera = await screen.findByTestId("product-camera");
      await fireEvent(camera, "cameraReady");
      const codes =
        order === "housing first"
          ? [housing, productCode]
          : [productCode, housing];
      await act(async () => {
        for (const data of codes)
          camera.props.onBarcodeScanned({ data, type: "code128" });
      });
      expect(await screen.findByText("REVIEW YOUR ITEM")).toBeVisible();
      expect(h.scans).toEqual([productCode]);
      expect(h.shoppingActions).toEqual([]);
    },
  );
  it("falls back to the custom active barcode when the preferred retail code misses", async () => {
    const h = harness();
    const custom = "BOX-SMALL";
    h.setUnknown("036000291452");
    h.transformScan((p) => ({
      ...p,
      variants: {
        ...p.variants,
        nodes: p.variants.nodes.map((v, i) =>
          i
            ? v
            : {
                ...v,
                identifiers: {
                  ...v.identifiers,
                  state: "observed" as const,
                  barcode: custom,
                },
              },
        ),
      },
    }));
    await renderApp(h, "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await act(async () => {
      for (const data of [custom, "036000291452"])
        camera.props.onBarcodeScanned({ data, type: "code128" });
    });
    expect(await screen.findByText("REVIEW YOUR ITEM")).toBeVisible();
    expect(h.scans).toEqual(["036000291452", custom]);
  });
  it("preserves a verified result if the finished camera reports a late mount error", async () => {
    const actualCamera = barcodeCamera.BarcodeCamera;
    let lateError: Parameters<typeof actualCamera>[0]["onError"] | undefined;
    jest.spyOn(barcodeCamera, "BarcodeCamera").mockImplementation((props) => {
      lateError = props.onError;
      return createElement(actualCamera, props);
    });
    await renderApp(harness(), "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await fireEvent(camera, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    expect(await screen.findByText("REVIEW YOUR ITEM")).toBeVisible();
    expect(lateError).toBeDefined();
    await act(async () => lateError!("camera_unavailable"));
    expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible();
  });
  it("keeps a product callback received while an unregistered code is being checked", async () => {
    const h = harness();
    const original = h.api.scan.bind(h.api);
    let finishMiss!: () => void;
    jest.spyOn(h.api, "scan").mockImplementationOnce(
      (...args) =>
        new Promise((resolve, reject) => {
          finishMiss = () => original(...args).then(resolve, reject);
        }),
    );
    h.setUnknown("NEW-HOUSING");
    await renderApp(h, "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await act(async () => {
      camera.props.onBarcodeScanned({ data: "NEW-HOUSING", type: "code128" });
    });
    await waitFor(() => expect(finishMiss).toBeDefined());
    await act(async () => {
      for (const data of ["036000291452", "NEW-HOUSING"])
        camera.props.onBarcodeScanned({ data, type: "code128" });
    });
    expect(camera).toBeVisible();
    await act(async () => finishMiss());
    expect(await screen.findByText("REVIEW YOUR ITEM")).toBeVisible();
    expect(h.scans).toEqual(["NEW-HOUSING", "036000291452"]);
    expect(h.shoppingActions).toEqual([]);
  });
  it("skips repeated camera misses and still resolves a similar ten-digit product code", async () => {
    const h = harness();
    const productCode = "8000000422";
    h.setUnknown("NEW-HOUSING");
    h.transformScan((p) => ({
      ...p,
      variants: {
        ...p.variants,
        nodes: p.variants.nodes.map((v, i) =>
          i
            ? v
            : {
                ...v,
                identifiers: {
                  ...v.identifiers,
                  state: "observed" as const,
                  barcode: productCode,
                },
              },
        ),
      },
    }));
    await renderApp(h, "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await fireEvent(camera, "barcodeScanned", {
      data: "NEW-HOUSING",
      type: "code128",
    });
    expect(await screen.findByText(/Still scanning/)).toBeVisible();
    await fireEvent(camera, "barcodeScanned", {
      data: "NEW-HOUSING",
      type: "code128",
    });
    expect(camera).toBeVisible();
    expect(screen.queryByText(/No active product matches/)).toBeNull();
    await fireEvent(camera, "barcodeScanned", {
      data: productCode,
      type: "code128",
    });
    expect(await screen.findByText("REVIEW YOUR ITEM")).toBeVisible();
    expect(h.scans).toEqual(["NEW-HOUSING", productCode]);
  });
  it("tries a UPC-E read even if the same digits as Code 128 just missed", async () => {
    const h = harness();
    const scan = h.api.scan.bind(h.api);
    jest.spyOn(h.api, "scan").mockImplementationOnce(async (...args) => {
      h.setUnknown();
      try {
        return await scan(...args);
      } finally {
        h.setUnknown("OTHER");
      }
    });
    h.transformScan((p) => ({
      ...p,
      variants: {
        ...p.variants,
        nodes: p.variants.nodes.map((v, i) =>
          i
            ? v
            : {
                ...v,
                identifiers: {
                  ...v.identifiers,
                  state: "observed" as const,
                  barcode: "042100005264",
                },
              },
        ),
      },
    }));
    await renderApp(h, "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await act(async () => {
      camera.props.onBarcodeScanned({ data: "04252614", type: "code128" });
    });
    expect(await screen.findByText(/Still scanning/)).toBeVisible();
    await act(async () => {
      camera.props.onBarcodeScanned({ data: "04252614", type: "upc_e" });
    });
    expect(await screen.findByText("REVIEW YOUR ITEM")).toBeVisible();
    expect(h.scans).toEqual(["04252614", "04252614"]);
  });
  it("looks up an explicitly entered housing ID and shows the catalog response", async () => {
    const housing = "8000000421";
    const h = harness();
    h.setUnknown();
    await renderApp(h, "/scan");
    await fireEvent.changeText(await manualInput(), housing);
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    expect(await screen.findByText(/No active product matches/)).toBeVisible();
    expect(h.scans).toEqual([housing]);
  });
  it.each([
    ["not_found", /No active product matches/],
    ["ambiguous_scan", /matches more than one variant/],
    ["offline", /Connection unavailable/],
    ["server_error", /lookup service returned an error/],
    ["scan_access_denied", /could not access the store lookup/],
    ["product_unavailable", /currently unavailable in the app/],
  ] as const)(
    "distinguishes %s after a detected barcode",
    async (failure, message) => {
      const h = harness();
      jest.spyOn(h.api, "scan").mockRejectedValue(new MobileFailure(failure));
      await renderApp(h, "/scan");
      await fireEvent.changeText(await manualInput(), "8003148023");
      await fireEvent.press(
        screen.getByRole("button", { name: "Look up code" }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Retry barcode lookup" }),
        ).toBeVisible(),
      );
      expect(screen.getByText(message)).toBeVisible();
      expect(h.shoppingActions).toEqual([]);
    },
  );
  it("shows an active counter-only item without offering an app cart add", async () => {
    const h = harness();
    jest.spyOn(h.api, "scan").mockResolvedValue({
      contractVersion,
      kind: "active-item",
      product: {
        id: "gid://shopify/Product/1",
        title: "Counter Value Box",
        selectedVariantId: "gid://shopify/ProductVariant/11",
        variantTitle: "Default Title",
        barcode: "887521144914",
        price: { amountCents: 2995, currencyCode: "USD" },
      },
      observedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await renderApp(h, "/scan");
    await fireEvent.changeText(await manualInput(), "887521144914");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText("Counter Value Box")).toBeVisible(),
    );
    expect(screen.queryByRole("button", { name: "Add to items" })).toBeNull();
    expect(h.shoppingActions).toEqual([]);
  });
  it("separates an unavailable verified product from a lookup failure", async () => {
    const h = harness();
    h.transformScan((p) => ({
      ...p,
      availableForSale: false,
      variants: {
        ...p.variants,
        nodes: p.variants.nodes.map((v) => ({
          ...v,
          availability: {
            ...v.availability,
            availableForSale: false,
            state: "unavailable" as const,
          },
        })),
      },
    }));
    await renderApp(h, "/scan");
    await lookupSample();
    expect(screen.getByRole("button", { name: "Add to items" })).toBeDisabled();
    expect(
      screen.getByText("Product found · Unavailable in the app"),
    ).toBeVisible();
  });
});

async function manualInput() {
  const open = screen.queryByRole("button", { name: "Enter code manually" });
  if (open) await fireEvent.press(open);
  return screen.getByLabelText("Product barcode");
}

async function lookupSample() {
  await fireEvent.changeText(await manualInput(), "036000291452");
  await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
  await waitFor(() =>
    expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
  );
}

describe("native scan to unpaid counter shopping UI (simulated backend)", () => {
  it("opens retail barcodes immediately without a mode selector", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    expect(screen.queryByRole("tab", { name: "Shelf QR" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Box barcode" })).toBeNull();
    expect(
      screen.getByTestId("product-camera").props.barcodeScannerSettings
        .barcodeTypes,
    ).toEqual(["upc_a", "upc_e", "ean13", "ean8", "code128"]);
    const camera = screen.getByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await fireEvent(camera, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    expect(h.scans).toEqual(["036000291452"]);
    expect(h.shoppingActions).toEqual([]);
  });
  it("returns to camera automatically after backgrounding an active scanner", async () => {
    const listeners: ((value: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, listener) => {
        listeners.push(listener);
        return { remove() {} };
      });
    await renderApp(harness(), "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    await act(async () => listeners.forEach((fn) => fn("background")));
    expect(screen.queryByTestId("product-camera")).toBeNull();
    await act(async () => listeners.forEach((fn) => fn("active")));
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
  });
  it("recovers a camera permission grant after the system dialog backgrounds the app", async () => {
    const listeners: ((value: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, listener) => {
        listeners.push(listener);
        return { remove() {} };
      });
    mockPermission = {
      ...mockPermission,
      granted: false,
      status: "undetermined",
    };
    let grant!: (value: typeof mockPermission) => void;
    mockRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    await renderApp(harness(), "/scan");
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    await act(async () => listeners.forEach((fn) => fn("inactive")));
    mockPermission = { ...mockPermission, granted: true, status: "granted" };
    await act(async () => {
      listeners.forEach((fn) => fn("active"));
      grant(mockPermission);
    });
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
  it("automatically starts an initially inactive focused scanner when the app becomes active", async () => {
    const listeners: ((value: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, listener) => {
        listeners.push(listener);
        return { remove() {} };
      });
    (AppState as { currentState: AppStateStatus }).currentState = "inactive";
    await renderApp(harness(), "/scan");
    expect(screen.queryByTestId("product-camera")).toBeNull();
    await act(async () => listeners.forEach((fn) => fn("active")));
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
  });
  it.each(["pause", "manual", "cart"])(
    "does not override explicit %s when returning to the foreground",
    async (intent) => {
      const listeners: ((value: AppStateStatus) => void)[] = [];
      jest
        .spyOn(AppState, "addEventListener")
        .mockImplementation((_event, listener) => {
          listeners.push(listener);
          return { remove() {} };
        });
      await renderApp(harness(), "/scan");
      await waitFor(() =>
        expect(screen.getByTestId("product-camera")).toBeVisible(),
      );
      await fireEvent.press(
        screen.getByRole(intent === "cart" ? "tab" : "button", {
          name:
            intent === "pause"
              ? "Pause camera"
              : intent === "manual"
                ? "Enter code manually"
                : "Cart",
        }),
      );
      await act(async () => listeners.forEach((fn) => fn("background")));
      await act(async () => listeners.forEach((fn) => fn("active")));
      expect(screen.queryByTestId("product-camera")).toBeNull();
      if (intent === "manual") {
        await fireEvent.press(
          screen.getByRole("button", { name: "Hide manual entry" }),
        );
        await waitFor(() =>
          expect(screen.getByTestId("product-camera")).toBeVisible(),
        );
      }
    },
  );
  it("shows initialization until ready and lets a timed-out camera retry", async () => {
    await renderApp(harness(), "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    expect(screen.getByText("Opening camera…")).toBeVisible();
    jest.useFakeTimers();
    try {
      // Restart under the fake clock so the readiness timer is deterministic.
      await fireEvent.press(
        screen.getByRole("button", { name: "Pause camera" }),
      );
      await fireEvent.press(
        screen.getByRole("button", { name: "Resume camera" }),
      );
      await act(async () => {
        jest.advanceTimersByTime(10001);
      });
      expect(screen.queryByTestId("product-camera")).toBeNull();
      await fireEvent.press(
        screen.getByRole("button", { name: "Retry camera" }),
      );
      const camera = screen.getByTestId("product-camera");
      await fireEvent(camera, "cameraReady");
      await waitFor(() =>
        expect(
          screen.getByText(/Ready · Aim at the product barcode/),
        ).toBeVisible(),
      );
      await act(async () => {
        jest.advanceTimersByTime(10001);
      });
      expect(
        screen.getByText(/Ready · Aim at the product barcode/),
      ).toBeVisible();
      expect(screen.getByTestId("product-camera")).toBeVisible();
    } finally {
      jest.useRealTimers();
    }
  });
  it("uses continuous focus, capture preset, calibrated zoom and an optional torch", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Zoom 2×" })).toBeDisabled();
    await fireEvent(screen.getByTestId("product-camera"), "cameraReady");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Zoom 2×" }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByTestId("product-camera").props).toMatchObject({
      autofocus: "off",
      pictureSize: "1920x1080",
      zoom: 0,
      enableTorch: false,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Zoom 1.5×" }));
    expect(screen.getByTestId("product-camera").props.zoom).toBeCloseTo(
      Math.log(1.5) / Math.log(16),
    );
    expect(
      screen.getByRole("button", { name: "Zoom 1.5×", selected: true }),
    ).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "Zoom 2×" }));
    expect(screen.getByTestId("product-camera").props.zoom).toBeCloseTo(0.25);
    await fireEvent.press(
      screen.getByRole("button", { name: "Turn torch on" }),
    );
    expect(screen.getByTestId("product-camera").props.enableTorch).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Pause camera" }));
    expect(screen.queryByTestId("product-camera")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Resume camera" }),
    );
    await fireEvent(screen.getByTestId("product-camera"), "cameraReady");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Turn torch on" }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByTestId("product-camera").props.enableTorch).toBe(false);
    expect(screen.getByTestId("product-camera").props.zoom).toBe(0);
    expect(h.shoppingActions).toEqual([]);
  });
  it("selects only an available main rear lens and fences the old camera callback", async () => {
    mockLenses.mockResolvedValue([
      {
        deviceType: "AVCaptureDeviceTypeBuiltInWideAngleCamera",
        localizedName: "Back Camera",
      },
    ]);
    const h = harness();
    await renderApp(h, "/scan");
    const old = await screen.findByTestId("product-camera");
    await fireEvent(old, "cameraReady");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera").props.selectedLens).toBe(
        cameraCaps.deviceType,
      ),
    );
    await fireEvent(old, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    expect(h.scans).toEqual([]);
    await fireEvent(screen.getByTestId("product-camera"), "cameraReady");
    await fireEvent(screen.getByTestId("product-camera"), "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    expect(h.scans).toEqual(["036000291452"]);
    expect(h.shoppingActions).toEqual([]);
  });
  it("does not mislabel unsupported zoom or torch and uses default lens fallback", async () => {
    mockPrepareCamera.mockResolvedValue({
      ...cameraCaps,
      maxAvailableZoomFactor: 1.6,
      hasTorch: false,
      isTorchAvailable: false,
    });
    await renderApp(harness(), "/scan");
    await fireEvent(await screen.findByTestId("product-camera"), "cameraReady");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Zoom 1.5×" }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Zoom 2×" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Turn torch on" }),
    ).toBeDisabled();
    expect(
      screen.getByTestId("product-camera").props.selectedLens,
    ).toBeUndefined();
  });
  it("stops setup failure safely and offers camera retry/manual entry", async () => {
    mockPrepareCamera.mockRejectedValue(
      Error("SYNTHETIC native bridge unavailable"),
    );
    const h = harness();
    await renderApp(h, "/scan");
    await fireEvent(await screen.findByTestId("product-camera"), "cameraReady");
    await waitFor(() =>
      expect(
        screen.getByText(/Camera controls could not initialize/),
      ).toBeVisible(),
    );
    expect(screen.queryByTestId("product-camera")).toBeNull();
    mockPrepareCamera.mockResolvedValue(cameraCaps);
    await fireEvent.press(screen.getByRole("button", { name: "Retry camera" }));
    await fireEvent(screen.getByTestId("product-camera"), "cameraReady");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Zoom 2×" }),
      ).not.toBeDisabled(),
    );
    expect(h.shoppingActions).toEqual([]);
  });
  it("pauses frame acceptance until the newest layout preparation finishes", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    const resolve: ((value: typeof cameraCaps) => void)[] = [];
    mockPrepareCamera.mockImplementation(
      () =>
        new Promise((done) => {
          resolve.push(done);
        }),
    );
    await fireEvent(camera, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 240 } },
    });
    await fireEvent(camera, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    expect(h.scans).toEqual([]);
    await fireEvent(camera, "responsiveOrientationChanged", {
      orientation: "landscapeLeft",
    });
    expect(resolve).toHaveLength(2);
    await act(async () => resolve[0](cameraCaps));
    await fireEvent(camera, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    expect(h.scans).toEqual([]);
    await act(async () => resolve[1](cameraCaps));
    await fireEvent(camera, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    await waitFor(() => expect(h.scans).toEqual(["036000291452"]));
    expect(h.shoppingActions).toEqual([]);
  });
  it("ignores delayed preparation after leaving the Scan tab", async () => {
    let resolve!: (value: typeof cameraCaps) => void;
    mockPrepareCamera.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const h = harness();
    await renderApp(h, "/scan");
    const camera = await screen.findByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await fireEvent.press(screen.getByLabelText(/^Home, tab,/));
    await act(async () => resolve(cameraCaps));
    await fireEvent(camera, "barcodeScanned", {
      data: "036000291452",
      type: "upc_a",
    });
    expect(screen.queryByTestId("product-camera")).toBeNull();
    expect(h.scans).toEqual([]);
    expect(h.shoppingActions).toEqual([]);
  });
  it("requests undetermined camera permission once and opens immediately after grant", async () => {
    mockPermission = {
      ...mockPermission,
      granted: false,
      status: "undetermined",
    };
    mockRequest.mockImplementation(async () => {
      mockPermission = { ...mockPermission, granted: true, status: "granted" };
      return mockPermission;
    });
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
  it("shows a verified product photo, then a safe placeholder if it fails to load", async () => {
    const h = harness();
    h.transformScan((p) => ({
      ...p,
      featuredImage: {
        url: "https://cdn.shopify.com/s/files/1/0000/test.png",
        altText: "Synthetic approved product photo",
      },
    }));
    await renderApp(h, "/scan");
    await lookupSample();
    await fireEvent(
      screen.getByLabelText("Synthetic approved product photo"),
      "error",
      { nativeEvent: { error: "SYNTHETIC image failure" } },
    );
    expect(screen.getByText("Product image unavailable")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add to items" }),
    ).not.toBeDisabled();
  });
  it("automatically opens granted camera, fences repeated A/B/A frames and preserves exact format/leading zeroes", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    expect(mockRequest).not.toHaveBeenCalled();
    const camera = screen.getByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await act(async () => {
      camera.props.onBarcodeScanned({ data: "0036000291452", type: "ean13" });
      camera.props.onBarcodeScanned({ data: "OTHER", type: "code128" });
      camera.props.onBarcodeScanned({ data: "0036000291452", type: "ean13" });
    });
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    expect(h.scans).toEqual(["0036000291452"]);
    expect(h.shoppingActions).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Add to items" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review items (1)" }),
      ).toBeVisible(),
    );
    expect(h.shoppingActions[1]).toMatchObject({
      action: "add",
      code: "036000291452",
      format: "code128",
      variantId: "gid://shopify/ProductVariant/11",
      reviewedPriceCents: 1234,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Add one more" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review items (2)" }),
      ).toBeVisible(),
    );
    expect(h.shoppingCart().paymentStatus).toBe("unpaid");
  });
  it("reviews quantities, removes items and prepares/cancels the existing unpaid handoff", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await lookupSample();
    await fireEvent.press(screen.getByRole("button", { name: "Add to items" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Review items (1)" }),
    );
    const increase = () =>
      screen.getByRole("button", { name: /Increase quantity of/ });
    await fireEvent.press(increase());
    await waitFor(() => expect(screen.getByText("Quantity 2")).toBeVisible());
    await fireEvent.press(
      screen.getByRole("button", { name: /Decrease quantity of/ }),
    );
    await waitFor(() => expect(screen.getByText("Quantity 1")).toBeVisible());
    await fireEvent.press(
      screen.getByRole("button", { name: "Ready to Purchase" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Take your items to the counter")).toBeVisible(),
    );
    expect(screen.getByText("UNPAID · COUNTER HANDOFF")).toBeVisible();
    expect(screen.getByLabelText("Unpaid counter handoff QR")).toBeVisible();
    expect(increase()).toBeDisabled();
    expect(h.shoppingCart().paymentStatus).toBe("unpaid");
    expect(screen.queryByText(/Payment successful|Order confirmed/)).toBeNull();
    expect(screen.getByLabelText(/^Shop, tab,/)).toBeVisible();
    await fireEvent.press(
      screen.getByRole("button", { name: "Cancel handoff and keep shopping" }),
    );
    await waitFor(() => expect(increase()).not.toBeDisabled());
    await fireEvent.press(
      screen.getByRole("button", { name: /Remove Synthetic Approved Card/ }),
    );
    await waitFor(() => expect(h.shoppingCart().lines).toHaveLength(0));
    expect(
      screen.getByRole("button", { name: "Ready to Purchase" }),
    ).toBeDisabled();
    await fireEvent.press(
      screen.getByRole("button", { name: "Back to scanner" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
  });
  it("selects only the unique barcode variant even when the backend omits its selection", async () => {
    const h = harness();
    h.transformScan((p) => ({ ...p, selectedVariantId: null }));
    await renderApp(h, "/scan");
    await lookupSample();
    expect(screen.queryByRole("radio", { name: "Parallel" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add to items" }),
    ).not.toBeDisabled();
    expect(h.shoppingActions).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Add to items" }));
    await waitFor(() =>
      expect(h.shoppingCart().lines[0].variantId).toBe(
        "gid://shopify/ProductVariant/11",
      ),
    );
  });
  it.each(["product unavailable", "mapped variant missing"])(
    "never adds when %s",
    async (mode) => {
      const h = harness();
      h.transformScan((p) =>
        mode === "product unavailable"
          ? {
              ...p,
              availableForSale: false,
              variants: {
                ...p.variants,
                nodes: p.variants.nodes.map((v) => ({
                  ...v,
                  availability: {
                    ...v.availability,
                    availableForSale: false,
                    state: "unavailable",
                  },
                })),
              },
            }
          : { ...p, selectedVariantId: "gid://shopify/ProductVariant/999" },
      );
      await renderApp(h, "/scan");
      await fireEvent.changeText(await manualInput(), "036000291452");
      await fireEvent.press(
        screen.getByRole("button", { name: "Look up code" }),
      );
      if (mode === "product unavailable")
        await waitFor(() =>
          expect(screen.getByText("Currently unavailable")).toBeVisible(),
        );
      else
        await waitFor(() =>
          expect(
            screen.getByText(/could not be verified safely/),
          ).toBeVisible(),
        );
      const add = screen.queryByRole("button", { name: "Add to items" });
      if (add) expect(add).toBeDisabled();
      expect(h.shoppingActions).toEqual([]);
    },
  );
  it("network failure hides stale cart and requires explicit refresh without duplicate Add", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await lookupSample();
    await fireEvent.press(screen.getByRole("button", { name: "Add to items" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add one more" }),
      ).toBeVisible(),
    );
    h.shoppingOffline(true);
    await fireEvent.press(screen.getByRole("button", { name: "Add one more" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review items · refresh needed" }),
      ).toBeVisible(),
    );
    expect(screen.queryByText(/PRIVATE shopping/)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Review items · refresh needed" }),
    );
    expect(screen.queryByText("Quantity 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ready to Purchase" }),
    ).toBeDisabled();
    h.shoppingOffline(false);
    await fireEvent.press(
      screen.getByRole("button", { name: "Refresh shopping list" }),
    );
    await waitFor(() => expect(screen.getByText("Quantity 1")).toBeVisible());
    expect(h.shoppingActions.filter((a) => a.action === "add")).toHaveLength(1);
  });
});

describe("customer mobile MVP with simulated services", () => {
  it("ignores a captured Add handler after leaving the scanner", async () => {
    const h = harness();
    let stalePress: (() => void) | undefined;
    const realButton = controls.Button;
    jest.spyOn(controls, "Button").mockImplementation((props) => {
      if (props.label === "Add to items") stalePress = props.onPress;
      return realButton(props);
    });
    const shoppingRequest = jest
      .spyOn(h.api, "shopping")
      .mockImplementation(async () => {
        throw new Error(
          "Unexpected shopping request from stale scanner handler",
        );
      });
    await renderApp(h, "/scan", true);
    await waitFor(() =>
      expect(h.controller.snapshot().status).toBe("authenticated"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    await fireEvent.changeText(await manualInput(), "036000291452");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    const button = screen.getByRole("button", { name: "Add to items" });
    expect(button).not.toBeDisabled();
    // Retain the native callback to model an event queued before blur.
    expect(stalePress).toEqual(expect.any(Function));
    if (!stalePress) throw new Error("Add callback not found");
    const captured = stalePress;
    await fireEvent.press(screen.getByLabelText(/^Shop, tab,/));
    await waitFor(() =>
      expect(screen.getByText("Find your next favorite.")).toBeVisible(),
    );
    await act(async () => {
      captured();
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    });
    expect(shoppingRequest).not.toHaveBeenCalled();
    expect(
      h.request.mock.calls.filter(([url]) => String(url).endsWith("/shopping")),
    ).toHaveLength(0);
  });

  it("automatically opens the camera after cold-start auth settles during a permission check", async () => {
    const h = harness();
    let releaseInitialize!: () => void;
    const initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    const initialize = h.controller.initialize.bind(h.controller);
    jest.spyOn(h.controller, "initialize").mockImplementation(async (url) => {
      await initializeGate;
      await initialize(url);
    });
    let releasePermission: ((value: typeof mockPermission) => void) | undefined;
    mockGetPermission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePermission = resolve;
        }),
    );
    const granted = { ...mockPermission, granted: true, status: "granted" };
    try {
      await renderApp(h, "/scan", true);
      await waitFor(() => expect(mockGetPermission).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId("product-camera")).toBeNull();
      await act(async () => {
        releaseInitialize();
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(h.controller.snapshot().status).toBe("authenticated"),
      );
      mockPermission = granted;
      await act(async () => {
        releasePermission?.(granted);
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(screen.getByTestId("product-camera")).toBeVisible(),
      );
      expect(mockGetPermission.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockRequest).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "Resume camera" }),
      ).toBeNull();
    } finally {
      releaseInitialize();
      releasePermission?.(granted);
    }
  });

  it("does not substitute another sole variant when the scanned identity disappears", async () => {
    const h = harness();
    h.removeScannedVariant();
    await renderApp(
      h,
      "/product/synthetic-item?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F11",
    );
    await waitFor(() =>
      expect(
        screen.getByText(/The requested variant is not on this current page/),
      ).toBeVisible(),
    );
    const remaining = screen.getByRole("radio", { name: /Parallel/ });
    expect(
      screen.getByRole("radio", { name: /Parallel/, checked: false }),
    ).toBeVisible();
    expect(screen.queryByText("SKU: TEST-2")).toBeNull();
    await fireEvent.press(remaining);
    expect(screen.getByText("SKU: TEST-2")).toBeVisible();
  });
  it("can still select a sole variant automatically for an ordinary product visit", async () => {
    const h = harness();
    h.removeScannedVariant();
    await renderApp(h, "/product/synthetic-item");
    await waitFor(() => expect(screen.getByText("SKU: TEST-2")).toBeVisible());
    expect(
      screen.getByRole("radio", { name: /Parallel/, checked: true }),
    ).toBeVisible();
  });
  it("Home renders approved merchandise, verified events and the confirmed Northside address", async () => {
    const h = harness();
    await renderApp(h, "/");
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    expect(screen.getByText("Synthetic verified event")).toBeVisible();
    expect(
      screen.getByText("6800 Forest Hills Road, Unit 3, Loves Park, IL."),
    ).toBeVisible();
    expect(screen.queryByText(/Checkout now/)).toBeNull();
  });
  it("Shop filters/searches/paginates and opens real native product variant detail", async () => {
    const h = harness();
    await renderApp(h, "/shop");
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    await fireEvent.press(screen.getByRole("radio", { name: "Sports Cards" }));
    await waitFor(() =>
      expect(
        h.request.mock.calls.some(([u]) =>
          String(u).includes("category=Sports+Cards"),
        ),
      ).toBe(true),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Next products" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Synthetic page two")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Previous products" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("link", { name: /Synthetic Approved Card/ }),
    );
    await waitFor(() =>
      expect(screen.getByText("Choose a variant")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Parallel · $20.00" }),
    );
    expect(
      screen.getByText("This variant is currently unavailable."),
    ).toBeVisible();
    expect(screen.getByText("Product image unavailable")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Add to cart|Checkout/ }),
    ).toBeNull();
  });
  it("unknown search has an honest empty-page continuation", async () => {
    const h = harness();
    await renderApp(h, "/shop");
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search products"),
      "unknown",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Search catalog" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/No matches on this page/)).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Next products" })).toBeVisible();
  });
  it("offline catalog removes prices and keeps raw errors out of UI", async () => {
    const h = harness();
    h.setOffline(true);
    await renderApp(h, "/shop");
    await waitFor(() =>
      expect(screen.getByText("Connection unavailable")).toBeVisible(),
    );
    expect(screen.queryByText("Synthetic Approved Card")).toBeNull();
    expect(screen.queryByText(/PRIVATE RAW/)).toBeNull();
  });
  it("denied camera permission retains settings recovery and manual lookup without reprompting", async () => {
    const h = harness();
    mockPermission = {
      ...mockPermission,
      granted: false,
      canAskAgain: false,
      status: "denied",
    };
    await renderApp(h, "/scan");
    expect(mockRequest).not.toHaveBeenCalled();
    expect(screen.queryByTestId("product-camera")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open camera settings" }),
    ).toBeVisible();
    expect(await manualInput()).toBeVisible();
  });
  it("camera scans once and unmounts after a result; manual unknown codes stay safe", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    const camera = screen.getByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await act(async () => {
      camera.props.onBarcodeScanned({ data: "036000291452", type: "upc_a" });
      camera.props.onBarcodeScanned({ data: "036000291452", type: "upc_a" });
    });
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    expect(h.scans).toHaveLength(1);
    expect(screen.queryByTestId("product-camera")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Scan next item" }),
    );
    h.setUnknown();
    await fireEvent.changeText(await manualInput(), "unregistered");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText(/No active product matches/)).toBeVisible(),
    );
  });
  it("ignores QR and unsupported formats and fences callbacks from an old camera epoch", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    const oldCamera = screen.getByTestId("product-camera");
    await fireEvent(oldCamera, "cameraReady");
    await act(async () => {
      oldCamera.props.onBarcodeScanned({
        data: "https://9i3hnb-jw.myshopify.com/m",
        type: "qr",
      });
      oldCamera.props.onBarcodeScanned({
        data: "036000291452",
        type: "code39",
      });
    });
    expect(h.scans).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Pause camera" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Resume camera" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    const camera = screen.getByTestId("product-camera");
    await fireEvent(camera, "cameraReady");
    await act(async () => {
      oldCamera.props.onBarcodeScanned({ data: "OLD-CAMERA", type: "code128" });
      camera.props.onBarcodeScanned({ data: "036000291452", type: "ean13" });
    });
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    expect(h.scans).toEqual(["036000291452"]);
    expect(h.shoppingActions).toEqual([]);
  });
  it.each([
    ["upc_a", "036000291452", "036000291452"],
    ["upc_e", "04252614", "042100005264"],
    ["ean13", "0036000291452", "036000291452"],
    ["ean8", "96385074", "96385074"],
    ["code128", "BOX-001", "BOX-001"],
  ])(
    "decodes %s and confirms the actual Shopify variant barcode",
    async (type, code, stored) => {
      const h = harness();
      h.transformScan((p) => ({
        ...p,
        variants: {
          ...p.variants,
          nodes: p.variants.nodes.map((v, i) =>
            i
              ? v
              : {
                  ...v,
                  identifiers: {
                    state: "observed" as const,
                    sku: v.identifiers.sku,
                    barcode: stored,
                  },
                },
          ),
        },
      }));
      await renderApp(h, "/scan");
      await waitFor(() =>
        expect(screen.getByTestId("product-camera")).toBeVisible(),
      );
      const camera = screen.getByTestId("product-camera");
      await fireEvent(camera, "cameraReady");
      await fireEvent(camera, "barcodeScanned", { data: code, type });
      await waitFor(() =>
        expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
      );
      expect(h.scans).toEqual([code]);
      expect(screen.getByText("Barcode: " + stored)).toBeVisible();
      expect(h.shoppingActions).toEqual([]);
    },
  );
  it("refuses a SKU-only backend match and duplicate returned barcodes", async () => {
    const h = harness();
    h.transformScan((p) => ({
      ...p,
      variants: {
        ...p.variants,
        nodes: p.variants.nodes.map((v, i) =>
          i
            ? v
            : {
                ...v,
                identifiers: {
                  state: "observed" as const,
                  sku: "036000291452",
                  barcode: "OTHER-BARCODE",
                },
              },
        ),
      },
    }));
    await renderApp(h, "/scan");
    await fireEvent.changeText(await manualInput(), "036000291452");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText(/could not be verified safely/)).toBeVisible(),
    );
    expect(screen.queryByText("REVIEW YOUR ITEM")).toBeNull();
    expect(h.shoppingActions).toEqual([]);
    h.transformScan((p) => ({
      ...p,
      variants: {
        ...p.variants,
        nodes: p.variants.nodes.map((v) => ({
          ...v,
          identifiers: {
            state: "observed" as const,
            sku: v.identifiers.sku,
            barcode: "036000291452",
          },
        })),
      },
    }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry barcode lookup" }),
    );
    await waitFor(() => expect(h.scans).toHaveLength(2));
    expect(screen.queryByText("REVIEW YOUR ITEM")).toBeNull();
  });
  it("retries a temporary lookup failure without adding or opening a cart", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    h.setOffline(true);
    await fireEvent.changeText(await manualInput(), "036000291452");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText(/Connection unavailable/)).toBeVisible(),
    );
    h.setOffline(false);
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry barcode lookup" }),
    );
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    expect(h.shoppingActions).toEqual([]);
  });
  it("rejects manual QR URLs before a lookup request", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await fireEvent.changeText(
      await manualInput(),
      "https://9i3hnb-jw.myshopify.com/m",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a product barcode, up to 255 characters.",
    );
    expect(h.scans).toEqual([]);
    expect(h.shoppingActions).toEqual([]);
  });
  it("switching tabs stops the camera and ignores a late permission grant", async () => {
    const h = harness();
    mockPermission = {
      ...mockPermission,
      granted: false,
      status: "undetermined",
    };
    let finish!: (v: typeof mockPermission) => void;
    mockRequest.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await renderApp(h, "/scan");
    await fireEvent.press(screen.getByLabelText(/^Shop, tab,/));
    await act(async () =>
      finish({ ...mockPermission, granted: true, status: "granted" }),
    );
    expect(screen.queryByTestId("product-camera")).toBeNull();
    await waitFor(() =>
      expect(screen.getByText("Find your next favorite.")).toBeVisible(),
    );
  });
  it("camera hardware error leaves manual fallback without exposing native error text", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
    await fireEvent(screen.getByTestId("product-camera"), "mountError", {
      message: "PRIVATE HARDWARE",
    });
    expect(screen.queryByTestId("product-camera")).toBeNull();
    expect(screen.getByText(/camera couldn.t open/)).toBeVisible();
    expect(screen.queryByText(/PRIVATE HARDWARE/)).toBeNull();
  });
  it("authenticated Wallet displays verified points/rewards without redemption", async () => {
    const h = harness();
    await renderApp(h, "/wallet", true);
    await waitFor(() =>
      expect(screen.getByText("450 available points")).toBeVisible(),
    );
    expect(screen.getByText("Verified Test Tier")).toBeVisible();
    expect(screen.getByText("Synthetic read-only reward")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Redeem|Enroll|Transfer/ }),
    ).toBeNull();
    await fireEvent.press(screen.getByLabelText(/^Account, tab,/));
    expect(screen.getByText(/#SYNTHETIC123/)).toBeVisible();
    expect(screen.getByText(/Synthetic owned break/)).toBeVisible();
  });
  it("privacy requires explicit confirmation and distinguishes request recorded from deletion completed", async () => {
    const h = harness();
    await renderApp(h, "/account", true);
    await waitFor(() =>
      expect(screen.getByText("Hello, Synthetic Collector")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("link", { name: "Privacy & account deletion" }),
    );
    const submit = screen.getByRole("button", {
      name: "Request account deletion",
    });
    expect(submit).toBeDisabled();
    await fireEvent.changeText(
      screen.getByLabelText("Account deletion confirmation"),
      "DELETE MY ACCOUNT",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Request account deletion" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Your deletion request was recorded/),
      ).toBeVisible(),
    );
    expect(h.controller.snapshot().status).toBe("signed_out");
    expect(h.controller.snapshot().account).toBeUndefined();
  });
});

describe("MVP lifecycle and private-account regression cases", () => {
  it("initial background launch makes no device requests until foregrounded", async () => {
    (AppState as { currentState: AppStateStatus }).currentState = "background";
    const listeners: ((value: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, listener) => {
        listeners.push(listener);
        return { remove() {} };
      });
    const h = harness();
    await renderApp(h, "/scan");
    expect(mockGetPermission).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
    await act(async () => {
      (AppState as { currentState: AppStateStatus }).currentState = "active";
      listeners.forEach((fn) => fn("active"));
    });
    expect(mockGetPermission).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("product-camera")).toBeVisible(),
    );
  });
  it("scanned product prices expire and require a fresh lookup", async () => {
    const h = harness();
    await renderApp(h, "/scan");
    jest.useFakeTimers();
    try {
      await fireEvent.changeText(await manualInput(), "036000291452");
      await fireEvent.press(
        screen.getByRole("button", { name: "Look up code" }),
      );
      await waitFor(() =>
        expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
      );
      await act(async () => {
        jest.advanceTimersByTime(60001);
      });
      expect(screen.queryByText("REVIEW YOUR ITEM")).toBeNull();
      expect(screen.getByText(/product information expired/)).toBeVisible();
    } finally {
      jest.useRealTimers();
    }
  });
  it("backgrounding clears a review result without silently resuming or adding", async () => {
    const listeners: ((value: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, listener) => {
        listeners.push(listener);
        return { remove() {} };
      });
    const h = harness();
    await renderApp(h, "/scan");
    await fireEvent.changeText(await manualInput(), "036000291452");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText("REVIEW YOUR ITEM")).toBeVisible(),
    );
    await act(async () => listeners.forEach((fn) => fn("background")));
    await act(async () => listeners.forEach((fn) => fn("active")));
    expect(screen.queryByText("REVIEW YOUR ITEM")).toBeNull();
    expect(screen.queryByTestId("product-camera")).toBeNull();
  });
  it("deletion confirmation typed for A cannot authorize B after account switching", async () => {
    const h = harness();
    await renderApp(h, "/account", true);
    await waitFor(() =>
      expect(screen.getByText("Hello, Synthetic Collector")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("link", { name: "Privacy & account deletion" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Account deletion confirmation"),
      "DELETE MY ACCOUNT",
    );
    expect(
      screen.getByRole("button", { name: "Request account deletion" }),
    ).not.toBeDisabled();
    await act(async () => {
      await h.controller.logout();
      h.setCustomer();
      await h.controller.login();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Request account deletion" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByLabelText("Account deletion confirmation"),
    ).toHaveDisplayValue("");
    expect(
      h.request.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/deletion-request") && init?.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("unlaunched wallet never displays a fabricated balance", async () => {
    const h = harness();
    h.unlaunched();
    await renderApp(h, "/wallet", true);
    await waitFor(() =>
      expect(
        screen.getByText(/Northside loyalty has not launched/),
      ).toBeVisible(),
    );
    expect(screen.queryByText(/available points/)).toBeNull();
  });
});

describe("customer MVP error boundaries", () => {
  it("expired scan responses are never presented as current matches", async () => {
    const h = harness(),
      original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) =>
      String(url).endsWith("/scan")
        ? new Response(
            JSON.stringify({
              contractVersion,
              kind: "product-detail",
              product: product(),
              observedAt: new Date(Date.now() - 60000).toISOString(),
              expiresAt: new Date(Date.now() - 1000).toISOString(),
            }),
            { headers: { "content-type": "application/json" } },
          )
        : original(url, init),
    );
    await renderApp(h, "/scan");
    await fireEvent.changeText(await manualInput(), "036000291452");
    await fireEvent.press(screen.getByRole("button", { name: "Look up code" }));
    await waitFor(() =>
      expect(screen.getByText(/product information expired/)).toBeVisible(),
    );
    expect(screen.queryByText("REVIEW YOUR ITEM")).toBeNull();
  });
  it("an expired private wallet session clears the entire account boundary", async () => {
    const h = harness(),
      original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) =>
      String(url).endsWith("/wallet")
        ? new Response(
            JSON.stringify({
              contractVersion,
              kind: "error",
              error: { code: "session_expired" },
              requestId: customerId,
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          )
        : original(url, init),
    );
    await renderApp(h, "/account", true);
    await waitFor(() =>
      expect(h.controller.snapshot().status).toBe("signed_out"),
    );
    expect(screen.queryByText("Hello, Synthetic Collector")).toBeNull();
    expect(h.controller.snapshot().orders).toBeUndefined();
  });
  it("failed product images show an accessible placeholder without fake artwork", async () => {
    const h = harness(),
      original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) =>
      String(url).includes("/catalog/synthetic-item")
        ? new Response(
            JSON.stringify({
              contractVersion,
              kind: "product-detail",
              product: {
                ...product(),
                featuredImage: {
                  url: "https://cdn.shopify.com/s/files/1/1234/5678/products/synthetic.jpg",
                  altText: "Synthetic image",
                },
              },
              observedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            }),
            { headers: { "content-type": "application/json" } },
          )
        : original(url, init),
    );
    await renderApp(h, "/product/synthetic-item");
    await waitFor(() =>
      expect(screen.getByLabelText("Synthetic image")).toBeVisible(),
    );
    await fireEvent(screen.getByLabelText("Synthetic image"), "error", {
      nativeEvent: { error: "synthetic image unavailable" },
    });
    expect(screen.getByText("Product image unavailable")).toBeVisible();
    await fireEvent.press(
      screen.getByRole("button", { name: "Refresh product" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Synthetic image")).toBeVisible(),
    );
    expect(screen.queryByText("Product image unavailable")).toBeNull();
  });
});

describe("singles New Arrivals selection with simulated published data", () => {
  it("does not call a bounded empty Home preview a confirmed empty collection", async () => {
    const h = harness(),
      original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) => {
      const u = new URL(String(url));
      if (
        u.searchParams.get("feed") === "singles-new-arrivals" &&
        !u.searchParams.has("after")
      )
        return new Response(
          JSON.stringify({
            contractVersion,
            kind: "catalog",
            products: [],
            pageInfo: {
              hasNextPage: true,
              endCursor: "cursor-after-bounded-search",
            },
            categories: [],
            observedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }),
          { headers: { "content-type": "application/json" } },
        );
      return original(url, init);
    });
    await renderApp(h, "/");
    await waitFor(() =>
      expect(
        screen.getByText(
          "No verified singles found in this part of the arrival selection. Continue browsing for more.",
        ),
      ).toBeVisible(),
    );
    expect(
      screen.queryByText(
        "No verified singles arrivals are available in the published collection.",
      ),
    ).toBeNull();
    await fireEvent.press(
      screen.getByRole("link", { name: "Browse singles arrivals" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Next products" }),
      ).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Next products" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Synthetic page two")).toBeVisible(),
    );
    const last = h.request.mock.calls
      .filter(([url]) => new URL(String(url)).pathname.endsWith("/catalog"))
      .at(-1)!;
    expect(new URL(String(last[0])).searchParams.get("after")).toBe(
      "cursor-after-bounded-search",
    );
  });
  it("resets the product cursor and category when changing feeds", async () => {
    const h = harness();
    await renderApp(h, "/shop");
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Next products" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Synthetic page two")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Singles · New Arrivals" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Synthetic verified singles arrival"),
      ).toBeVisible(),
    );
    const calls = h.request.mock.calls.filter(([url]) =>
      new URL(String(url)).pathname.endsWith("/catalog"),
    );
    const selected = new URL(String(calls.at(-1)![0]));
    expect(selected.searchParams.get("feed")).toBe("singles-new-arrivals");
    expect(selected.searchParams.has("after")).toBe(false);
    expect(selected.searchParams.has("category")).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Previous products" }),
    ).toBeNull();
    await fireEvent.press(
      screen.getByRole("radio", { name: "All merchandise" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
  });

  it("never lets a late response from another feed replace the current selection", async () => {
    const h = harness(),
      original = h.request.getMockImplementation()!;
    let release: ((value: Response) => void) | undefined;
    h.request.mockImplementation(async (url, init) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/catalog") && !u.searchParams.has("feed"))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return original(url, init);
    });
    await renderApp(h, "/shop");
    await waitFor(() => expect(release).toEqual(expect.any(Function)));
    await fireEvent.press(
      screen.getByRole("radio", { name: "Singles · New Arrivals" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Synthetic verified singles arrival"),
      ).toBeVisible(),
    );
    await act(async () => {
      release?.(
        new Response(
          JSON.stringify({
            contractVersion,
            kind: "catalog",
            products: [{ ...product(), title: "STALE SYNTHETIC OTHER FEED" }],
            pageInfo: { hasNextPage: false, endCursor: null },
            categories: [],
            observedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    });
    expect(screen.queryByText("STALE SYNTHETIC OTHER FEED")).toBeNull();
    expect(
      screen.getByText("Synthetic verified singles arrival"),
    ).toBeVisible();
  });

  it("does not fall back to the general catalog when singles configuration is missing", async () => {
    const h = harness(),
      original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, init) =>
      new URL(String(url)).searchParams.has("feed")
        ? new Response(
            JSON.stringify({
              contractVersion,
              kind: "error",
              error: { code: "not_configured" },
              requestId: customerId,
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          )
        : original(url, init),
    );
    await renderApp(h, "/shop");
    await waitFor(() =>
      expect(screen.getByText("Synthetic Approved Card")).toBeVisible(),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Singles · New Arrivals" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Singles arrivals unavailable")).toBeVisible(),
    );
    expect(screen.queryByText("Synthetic Approved Card")).toBeNull();
  });
});

describe("inactive startup and contract-size transport boundaries", () => {
  it.each(["inactive", null, undefined] as const)(
    "does not restore private credentials or fetch public data from initial %s until active",
    async (initial) => {
      const previous = AppState.currentState,
        listeners: ((value: AppStateStatus) => void)[] = [];
      const mutable = AppState as {
        currentState: typeof AppState.currentState;
      };
      mutable.currentState = initial;
      jest
        .spyOn(AppState, "addEventListener")
        .mockImplementation((_event, listener) => {
          listeners.push(listener);
          return { remove() {} };
        });
      try {
        const h = harness();
        await renderApp(h, "/account", true);
        await act(async () => {
          await Promise.resolve();
        });
        expect(h.request).not.toHaveBeenCalled();
        mutable.currentState = "active";
        await act(async () => listeners.forEach((fn) => fn("active")));
        await waitFor(() =>
          expect(screen.getByText("Hello, Synthetic Collector")).toBeVisible(),
        );
      } finally {
        mutable.currentState = previous;
      }
    },
  );
  it("accepts a large valid private-service projection without weakening schema validation", async () => {
    const items = Array.from({ length: 300 }, (_, index) => ({
      id: "00000000-0000-4000-8000-" + index.toString(16).padStart(12, "0"),
      kind: "grading",
      title: "é".repeat(2000),
      status: "received",
    }));
    const request: typeof fetch = async () =>
      new Response(
        JSON.stringify({ contractVersion, kind: "services", items }),
        { headers: { "content-type": "application/json" } },
      );
    const result = await new MobileApi(
      "https://stage.example.test",
      request,
    ).services(opaque, "cards");
    expect(result.items).toHaveLength(300);
  });
  it("rejects an advertised oversized response before reading its body", async () => {
    const response = new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": "99999999",
      },
    });
    const read = jest.spyOn(response, "text");
    await expect(
      new MobileApi(
        "https://stage.example.test",
        async () => response,
      ).services(opaque, "cards"),
    ).rejects.toThrow("invalid_response");
    expect(read).not.toHaveBeenCalled();
  });
});
