import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import Constants from "expo-constants";
import {
  PublicCatalogApi,
  PUBLIC_CATALOG_ENDPOINT,
  PUBLIC_CATALOG_QUERY,
  PREVIEW_CATALOG_SELECTION,
} from "../src/api/public-catalog";
import { MobileApi, MOBILE_RESPONSE_LIMIT } from "../src/api/client";
import { MvpProvider, useMvp } from "../src/mvp/Provider";
import { createAppConfig } from "../config/app";
import profile from "../eas.json";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: null },
}));

function product(index = 0) {
  const p = PREVIEW_CATALOG_SELECTION[index];
  return {
    id: p.id,
    handle: p.handle,
    title: `Live Shopify title ${index}`,
    description: "Provider description",
    productType: "Basketball",
    publishedAt: "2026-11-10T16:30:55Z",
    availableForSale: true,
    featuredImage: {
      url: "https://cdn.shopify.com/s/files/1/1039/6739/2113/files/live.jpg?v=1",
      altText: null,
    },
    priceRange: { minVariantPrice: { amount: "17.29", currencyCode: "USD" } },
    variants: {
      nodes: [
        {
          id: p.variantId,
          title: "Default Title",
          sku: "LIVE-SKU",
          barcode: p.barcode,
          availableForSale: true,
          currentlyNotInStock: false,
          price: { amount: "17.29", currencyCode: "USD" },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: "provider-cursor" },
    },
  };
}
function response(nodes: unknown[], version = "2026-07", extra: object = {}) {
  return new Response(JSON.stringify({ data: { nodes }, ...extra }), {
    headers: {
      "content-type": "application/json",
      "x-shopify-api-version": version,
    },
  });
}
const originalConfig = Constants.expoConfig;
afterEach(() => {
  Constants.expoConfig = originalConfig;
});

describe("public Shopify preview catalog", () => {
  it("requests and resolves only the verified helmet identity without using its SKU as an alias", async () => {
    const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
    const h = PREVIEW_CATALOG_SELECTION[7];
    const request = jest.fn<typeof fetch>(async () => response(nodes));
    const api = new PublicCatalogApi(request);
    const result = await api.scan("793397728021", undefined, "upc_a");
    expect(result.product.id).toBe("gid://shopify/Product/16135959970161");
    expect(result.product.selectedVariantId).toBe(
      "gid://shopify/ProductVariant/68224353927537",
    );
    expect(
      JSON.parse(String(request.mock.calls[0][1]?.body)).variables.ids,
    ).toContain(h.id);
    for (const [code, format] of [
      [h.barcode, "ean13"],
      ["0" + h.barcode, "ean13"],
      ["0" + h.barcode, "code128"],
      [h.barcode, undefined],
    ] as const)
      expect(
        (await api.scan(code, undefined, format)).product.selectedVariantId,
      ).toBe(h.variantId);
    nodes[7].variants.nodes[0].sku = h.barcode;
    nodes[7].variants.nodes[0].barcode = "DIFFERENT-HELMET";
    await expect(api.scan(h.barcode, undefined, "code128")).rejects.toThrow(
      "not_found",
    );
    await expect(
      api.scan("DIFFERENT-HELMET", undefined, "code128"),
    ).rejects.toThrow("invalid_response");
  });
  it("keeps helmet publication, exact variant and duplicate-barcode guards", async () => {
    const h = PREVIEW_CATALOG_SELECTION[7];
    const hidden: unknown[] = PREVIEW_CATALOG_SELECTION.map((_, i) =>
      product(i),
    );
    hidden[7] = null;
    await expect(
      new PublicCatalogApi(async () => response(hidden)).scan(
        h.barcode,
        undefined,
        "code128",
      ),
    ).rejects.toThrow("product_unavailable");
    const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
    nodes[0].variants.nodes[0].barcode = h.barcode;
    await expect(
      new PublicCatalogApi(async () => response(nodes)).scan(
        h.barcode,
        undefined,
        "code128",
      ),
    ).rejects.toThrow("ambiguous_scan");
    nodes[0] = product(0);
    nodes[7].variants.nodes[0].id = "gid://shopify/ProductVariant/999";
    await expect(
      new PublicCatalogApi(async () => response(nodes)).scan(
        h.barcode,
        undefined,
        "code128",
      ),
    ).rejects.toThrow("invalid_response");
  });
  it.each([429, 500, 503, 401, 403, 404])(
    "reports HTTP %s distinctly from an unknown product without leaking provider data",
    async (status) => {
      const trace = jest.fn();
      const expected =
        status === 429
          ? "rate_limited"
          : status >= 500
            ? "server_error"
            : [401, 403].includes(status)
              ? "scan_access_denied"
              : "scan_endpoint_unavailable";
      await expect(
        new PublicCatalogApi(
          async () =>
            new Response('{"error":"PRIVATE"}', {
              status,
              headers: { "content-type": "application/json" },
            }),
        ).scan("746134150968", undefined, "code128", trace),
      ).rejects.toThrow(expected);
      expect(trace).toHaveBeenLastCalledWith(
        expect.objectContaining({ httpStatus: status, stage: "catalog-read" }),
      );
      expect(JSON.stringify(trace.mock.calls)).not.toContain("PRIVATE");
    },
  );
  it("resolves all six checksum-valid Code128/manual GTIN equivalents through the real adapter", async () => {
    const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
    const api = new PublicCatalogApi(async () => response(nodes));
    for (const p of PREVIEW_CATALOG_SELECTION.slice(0, 6))
      for (const format of ["code128", undefined]) {
        expect(
          (await api.scan("0" + p.barcode, undefined, format)).product
            .selectedVariantId,
        ).toBe(p.variantId);
      }
  });
  it("observes exact matches, zero matches, ambiguity and identity failures without changing outcomes", async () => {
    const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
    const api = new PublicCatalogApi(async () => response(nodes));
    const trace = jest.fn();
    const found = await api.scan(
      nodes[0].variants.nodes[0].barcode,
      undefined,
      "ean13",
      trace,
    );
    expect(found.product.selectedVariantId).toBe(
      PREVIEW_CATALOG_SELECTION[0].variantId,
    );
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "barcode-match",
        matchingVariants: 1,
        catalogProducts: 8,
      }),
    );
    expect(trace).toHaveBeenLastCalledWith({
      path: "public-shopify-variant-barcode",
      stage: "complete",
      matchingVariants: 1,
    });
    trace.mockClear();
    await expect(
      api.scan("8003148023", undefined, "code128", trace),
    ).rejects.toThrow("not_found");
    expect(trace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "barcode-match",
        matchingVariants: 0,
        reason: "no_matching_visible_variant",
      }),
    );
    nodes[1].variants.nodes[0].barcode = nodes[0].variants.nodes[0].barcode;
    await expect(
      api.scan(nodes[0].variants.nodes[0].barcode, undefined, "ean13", trace),
    ).rejects.toThrow("ambiguous_scan");
    expect(trace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        matchingVariants: 2,
        reason: "multiple_variant_barcodes",
      }),
    );
    nodes[1].variants.nodes[0].barcode = "CHANGED-SECOND";
    await expect(
      api.scan("CHANGED-SECOND", undefined, "code128", trace),
    ).rejects.toThrow("invalid_response");
    expect(trace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "identity-verification",
        reason: "catalog_identity_changed",
      }),
    );
    expect(
      (
        await api.scan(
          nodes[0].variants.nodes[0].barcode,
          undefined,
          "ean13",
          () => {
            throw Error("PRIVATE");
          },
        )
      ).product.selectedVariantId,
    ).toBe(PREVIEW_CATALOG_SELECTION[0].variantId);
  });
  it("reports missing public nodes and network failures without inventing publication reasons", async () => {
    const nodes: unknown[] = PREVIEW_CATALOG_SELECTION.map((_, i) =>
      product(i),
    );
    nodes[0] = null;
    const trace = jest.fn();
    await expect(
      new PublicCatalogApi(async () => response(nodes)).scan(
        PREVIEW_CATALOG_SELECTION[0].barcode,
        undefined,
        "ean13",
        trace,
      ),
    ).rejects.toThrow("product_unavailable");
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        unreturnedProducts: 1,
        catalogProducts: 7,
        matchingVariants: 0,
      }),
    );
    trace.mockClear();
    await expect(
      new PublicCatalogApi(async () => {
        throw Error("PRIVATE transport detail");
      }).scan("8003148023", undefined, "code128", trace),
    ).rejects.toThrow("offline");
    expect(trace).toHaveBeenCalledTimes(1);
    expect(trace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "public-shopify-variant-barcode",
        stage: "catalog-read",
        httpStatus: null,
      }),
    );
    expect(JSON.stringify(trace.mock.calls)).not.toContain("PRIVATE");
  });
  it("keeps Prizm scannable when unrelated Golf barcode drifts and quarantines Golf", async () => {
    const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
    nodes[6].variants.nodes[0].barcode = "CHANGED-GOLF";
    nodes[6].variants.nodes[0].sku = "92840090001065";
    const fallback = { scan: jest.fn<MobileApi["scan"]>() };
    const api = new PublicCatalogApi(
      async (_url, init) => {
        const ids = JSON.parse(String(init?.body)).variables.ids as string[];
        return response(ids.map((id) => nodes.find((p) => p.id === id)));
      },
      undefined,
      fallback,
    );
    expect(
      (await api.scan("746134151026", undefined, "code128")).product
        .selectedVariantId,
    ).toBe(PREVIEW_CATALOG_SELECTION[5].variantId);
    expect((await api.catalog()).products.map((p) => p.id)).not.toContain(
      nodes[6].id,
    );
    await expect(api.product(nodes[6].handle)).rejects.toThrow(
      "invalid_response",
    );
    for (const code of [
      "CHANGED-GOLF",
      `https://9i3hnb-jw.myshopify.com/products/${nodes[6].handle}`,
    ])
      await expect(api.scan(code)).rejects.toThrow("invalid_response");
    expect(fallback.scan).not.toHaveBeenCalled();
  });
  it.each(["barcode", "sku"] as const)(
    "retains ambiguous %s claims from a quarantined record",
    async (field) => {
      const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
      nodes[6].variants.nodes[0].barcode = "CHANGED-GOLF";
      nodes[6].variants.nodes[0][field] = "746134151026";
      const api = new PublicCatalogApi(async () => response(nodes));
      if (field === "barcode")
        await expect(api.scan("746134151026")).rejects.toThrow(
          "ambiguous_scan",
        );
      else
        expect((await api.scan("746134151026")).product.selectedVariantId).toBe(
          PREVIEW_CATALOG_SELECTION[5].variantId,
        );
    },
  );
  it("scans corrected Golf UPC and legacy QR without title identity", async () => {
    const nodes = PREVIEW_CATALOG_SELECTION.map((_, i) => product(i));
    nodes[6].title = "2026 Upper Deck Golf Hobby Box";
    nodes[6].variants.nodes[0].sku = "92840090001065";
    const api = new PublicCatalogApi(async () => response(nodes));
    for (const code of [
      "053334437622",
      `https://9i3hnb-jw.myshopify.com/products/${nodes[6].handle}`,
    ]) {
      const result = await api.scan(code);
      expect(result.product.selectedVariantId).toBe(
        PREVIEW_CATALOG_SELECTION[6].variantId,
      );
      expect(result.product.variants.nodes[0].identifiers.barcode).toBe(
        "053334437622",
      );
    }
    await expect(
      api.scan("92840090001065", undefined, "code128"),
    ).rejects.toThrow("not_found");
    await expect(api.scan("53334437622")).rejects.toThrow("not_found");
    await expect(api.scan("8003147387")).rejects.toThrow("not_found");
  });
  it("uses only the eight approved identities and tokenless pinned public reads", async () => {
    const request = jest.fn<typeof fetch>(async () =>
      response(PREVIEW_CATALOG_SELECTION.map((_, i) => product(i))),
    );
    const result = await new PublicCatalogApi(request).catalog();
    expect(result.products).toHaveLength(8);
    expect(result.products[0]).toMatchObject({
      title: "Live Shopify title 0",
      minVariantPrice: { amountCents: 1729 },
      featuredImage: { url: expect.stringContaining("cdn.shopify.com") },
    });
    expect(result.products[0].variants.nodes[0]).toMatchObject({
      id: PREVIEW_CATALOG_SELECTION[0].variantId,
      identifiers: {
        sku: "LIVE-SKU",
        barcode: PREVIEW_CATALOG_SELECTION[0].barcode,
      },
      availability: { state: "unknown", quantityAvailable: null },
    });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(PUBLIC_CATALOG_ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(Object.keys(init!.headers!)).toHaveLength(2);
    expect(JSON.parse(String(init?.body))).toEqual({
      query: PUBLIC_CATALOG_QUERY,
      variables: { ids: PREVIEW_CATALOG_SELECTION.map((p) => p.id) },
    });
    expect(PUBLIC_CATALOG_QUERY).not.toMatch(/quantityAvailable|tags|mutation/);
    expect(Date.parse(result.expiresAt) - Date.parse(result.observedAt)).toBe(
      60000,
    );
  });
  it("refreshes prices and distinguishes sold-out records from unpublished records", async () => {
    let current = product();
    const request = jest.fn<typeof fetch>(async () => response([current]));
    const api = new PublicCatalogApi(request),
      handle = current.handle;
    expect(
      (await api.product(handle)).product.minVariantPrice.amountCents,
    ).toBe(1729);
    current = {
      ...current,
      availableForSale: false,
      variants: {
        ...current.variants,
        nodes: [
          {
            ...current.variants.nodes[0],
            availableForSale: false,
            price: { amount: "19.95", currencyCode: "USD" },
          },
        ],
      },
    };
    const detail = await api.product(handle);
    expect(detail.product.availableForSale).toBe(false);
    expect(detail.product.variants.nodes[0].availability.state).toBe(
      "unavailable",
    );
    expect(detail.product.variants.nodes[0].price.amountCents).toBe(1995);
    request.mockImplementation(async () => response([null]));
    await expect(api.product(handle)).rejects.toThrow("not_found");
  });
  it("filters only the current approved scope and does not substitute missing products", async () => {
    const api = new PublicCatalogApi(async () =>
      response(
        PREVIEW_CATALOG_SELECTION.map((_, index) =>
          index === 0 ? product() : null,
        ),
      ),
    );
    expect(
      (await api.catalog({ q: "LIVE-SKU", category: "Basketball" })).products,
    ).toHaveLength(1);
    expect((await api.catalog({ q: "Donruss Optic" })).products).toHaveLength(
      0,
    );
  });
  it("rejects unrelated lookups and leaves all privileged and unverified feeds disconnected", async () => {
    const request = jest.fn<typeof fetch>();
    const api = new PublicCatalogApi(request);
    await expect(api.product("unapproved-handle")).rejects.toThrow("not_found");
    await expect(
      api.product(PREVIEW_CATALOG_SELECTION[0].handle, "arbitrary-cursor"),
    ).rejects.toThrow("not_found");
    await expect(api.catalog({ after: "arbitrary-cursor" })).rejects.toThrow(
      "invalid_request",
    );
    await expect(api.catalog({ feed: "singles-new-arrivals" })).rejects.toThrow(
      "not_configured",
    );
    await expect(api.info()).rejects.toThrow("not_configured");
    await expect(api.releases()).rejects.toThrow("not_configured");
    expect(api).not.toBeInstanceOf(MobileApi);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    "id",
    "handle",
    "barcode",
    "variant",
    "unpublished",
    "future",
    "currency",
    "price",
    "image",
    "extra-variant",
  ])("fails closed on %s without fallback", async (field) => {
    const p = product();
    if (field === "id") p.id = "gid://shopify/Product/999";
    if (field === "handle") p.handle = "wrong-handle";
    if (field === "barcode") p.variants.nodes[0].barcode = "746134157738";
    if (field === "variant")
      p.variants.nodes[0].id = "gid://shopify/ProductVariant/999";
    if (field === "unpublished") p.publishedAt = "";
    if (field === "future")
      p.publishedAt = new Date(Date.now() + 3600000).toISOString();
    if (field === "currency") p.variants.nodes[0].price.currencyCode = "CAD";
    if (field === "price") p.variants.nodes[0].price.amount = "1e2";
    if (field === "image")
      p.featuredImage.url = "https://untrusted.example/image.jpg";
    if (field === "extra-variant")
      p.variants.nodes.push({ ...p.variants.nodes[0] });
    await expect(
      new PublicCatalogApi(async () => response([p])).product(
        PREVIEW_CATALOG_SELECTION[0].handle,
      ),
    ).rejects.toThrow("invalid_response");
  });
  it("rejects schema version drift, GraphQL errors, malformed or oversized responses", async () => {
    const handle = PREVIEW_CATALOG_SELECTION[0].handle;
    for (const r of [
      response([product()], "2026-10"),
      response([]),
      new Response("not-json", {
        headers: {
          "content-type": "application/json",
          "x-shopify-api-version": "2026-07",
        },
      }),
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "x-shopify-api-version": "2026-07",
          "content-length": String(MOBILE_RESPONSE_LIMIT + 1),
        },
      }),
    ]) {
      await expect(
        new PublicCatalogApi(async () => r).product(handle),
      ).rejects.toThrow("invalid_response");
    }
    await expect(
      new PublicCatalogApi(async () =>
        response([product()], "2026-07", {
          errors: [{ message: "PRIVATE RAW ERROR" }],
        }),
      ).product(handle),
    ).rejects.toThrow("service_unavailable");
  });
  it("redacts offline errors and handles cancellation and timeouts", async () => {
    const handle = PREVIEW_CATALOG_SELECTION[0].handle;
    await expect(
      new PublicCatalogApi(async () => {
        throw Error("PRIVATE RAW NETWORK ERROR");
      }).product(handle),
    ).rejects.toThrow(/^offline$/);
    const controller = new AbortController();
    controller.abort();
    await expect(
      new PublicCatalogApi().catalog({}, controller.signal),
    ).rejects.toThrow("cancelled");
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Error("abort")), {
          once: true,
        });
      });
    await expect(
      new PublicCatalogApi(hanging, 5).product(handle),
    ).rejects.toThrow("timeout");
  });
});

describe("live catalog preview configuration", () => {
  const env = {
    ...profile.build.preview.ios.env,
    MOBILE_NATIVE_SCAN_CART: undefined,
    MOBILE_PREVIEW_COMMERCE_API_ORIGIN: undefined,
    MOBILE_APP_VARIANT: "preview",
    EAS_BUILD: "true",
    EAS_BUILD_PLATFORM: "ios",
  };
  it("activates the catalog provider without an account API or private fixture", async () => {
    Constants.expoConfig = createAppConfig(env);
    const Probe = () => (
      <Text>
        {useMvp().api instanceof PublicCatalogApi
          ? "public-live-catalog"
          : "disconnected"}
      </Text>
    );
    await render(
      <MvpProvider>
        <Probe />
      </MvpProvider>,
    );
    expect(screen.getByText("public-live-catalog")).toBeTruthy();
    expect(Constants.expoConfig.extra?.mobile.apiOrigin).toBeUndefined();
    expect(Constants.expoConfig.extra?.mobile.servicesConnected).toBe(false);
    expect(
      Constants.expoConfig.extra?.mobile.privateCatalogPreview,
    ).toBeUndefined();
    expect(Constants.expoConfig.ios?.buildNumber).toBe("2");
    expect(profile.build.preview.distribution).toBe("internal");
    expect(profile.build.preview.ios.developmentClient).toBe(false);
  });
  it.each([
    "MOBILE_PREVIEW_IOS_BUNDLE_ID",
    "MOBILE_PREVIEW_APPLE_TEAM_ID",
    "MOBILE_PREVIEW_SCHEME",
    "MOBILE_EXPO_OWNER",
    "MOBILE_EAS_PROJECT_ID",
    "MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED",
  ])("pins verified %s", (key) => {
    expect(() => createAppConfig({ ...env, [key]: undefined })).toThrow(
      /verified Northside/,
    );
  });
  it.each([
    { MOBILE_APP_VARIANT: "production" },
    { EAS_BUILD_PLATFORM: "android" },
    { MOBILE_PREVIEW_API_ORIGIN: "https://stage.example.test" },
    { MOBILE_IOS_INTERFACE_PREVIEW: "true" },
    { MOBILE_PRIVATE_CATALOG_PREVIEW: "true" },
  ])(
    "does not broaden production, fixtures, backend or other platform boundaries: %j",
    (override) => {
      expect(() => createAppConfig({ ...env, ...override })).toThrow(
        /isolated preview/,
      );
    },
  );
});
