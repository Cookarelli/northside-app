import { describe, expect, it } from "vitest";
import {
  CATALOG_CONTRACT_VERSION,
  CATALOG_SHOP,
  CATALOG_SHOPIFY_API_VERSION,
  catalogProductV1Schema,
  catalogResponseV1Schema,
  validateCatalogResponseV1,
  type CatalogFreshnessPolicy,
  type CatalogPageInfoV1,
  type CatalogProductV1,
  type CatalogValidationCode,
  type CatalogVariantV1,
} from "./index";

// Synthetic unit inputs only. No provider request, seed, environment or app fixture.
const observedAt = "2026-11-03T18:00:00.000Z";
const policy = { nowMs: Date.parse(observedAt) + 1000, maxAgeMs: 60_000 };
const pageInfo: CatalogPageInfoV1 = { hasNextPage: false, endCursor: null };
const source = {
  provider: "shopify_storefront",
  shop: CATALOG_SHOP,
  apiVersion: CATALOG_SHOPIFY_API_VERSION,
};
const freshness = { observedAt, expiresAt: "2026-11-03T18:01:00.000Z" };

function variant(overrides: Partial<CatalogVariantV1> = {}): CatalogVariantV1 {
  return {
    id: "gid://shopify/ProductVariant/101",
    productId: "gid://shopify/Product/1",
    title: "Test variant",
    identifiers: { state: "not_provided", sku: null, barcode: null },
    price: { amountCents: 12500, currencyCode: "USD" },
    availability: {
      state: "in_stock",
      availableForSale: true,
      currentlyNotInStock: false,
      quantityAvailable: 3,
    },
    ...overrides,
  };
}

function product(overrides: Partial<CatalogProductV1> = {}): CatalogProductV1 {
  return {
    id: "gid://shopify/Product/1",
    handle: "test-box",
    title: "Contract test box",
    description: "Test-only description.\nNot a published merchandise claim.",
    productType: "Baseball",
    publication: "published",
    availableForSale: true,
    featuredImage: {
      url: "https://cdn.shopify.com/s/files/1/0001/products/test.webp?v=1&width=700",
      altText: "Contract test artwork",
    },
    minVariantPrice: { amountCents: 12500, currencyCode: "USD" },
    variants: { nodes: [variant()], pageInfo: { ...pageInfo }, after: null },
    selectedVariantId: null,
    productPath: "/shop/test-box",
    onlineStoreUrl: null,
    ...overrides,
  };
}

function detail(value: unknown = product()) {
  return {
    contractVersion: CATALOG_CONTRACT_VERSION,
    kind: "product",
    status: "ready",
    source: { ...source },
    freshness: { ...freshness },
    product: value,
  };
}

function page() {
  return {
    contractVersion: CATALOG_CONTRACT_VERSION,
    kind: "catalog-page",
    status: "ready",
    source: { ...source },
    freshness: { ...freshness },
    products: [product()],
    pageInfo: { ...pageInfo },
    collections: {
      nodes: [{ handle: "baseball", title: "Baseball" }],
      pageInfo: { ...pageInfo },
    },
  };
}

function reject(
  input: unknown,
  code: CatalogValidationCode = "invalid_payload",
) {
  expect(validateCatalogResponseV1(input, policy)).toEqual({
    success: false,
    error: { code },
  });
}

describe("portable catalog v1 response boundary", () => {
  it("accepts an explicit published product without mutating the input", () => {
    const input = detail();
    const before = JSON.stringify(input);
    const result = validateCatalogResponseV1(input, policy);
    expect(result).toEqual({ success: true, data: input });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.success && result.data).not.toBe(input);
    expect(catalogResponseV1Schema.parse(JSON.parse(before))).toEqual(input);
  });

  it("accepts product and collection pages with independent cursors", () => {
    const input = page();
    input.pageInfo = { hasNextPage: true, endCursor: "products-next" };
    input.collections.pageInfo = {
      hasNextPage: true,
      endCursor: "collections-next",
    };
    expect(validateCatalogResponseV1(input, policy).success).toBe(true);
  });

  it("keeps a successful empty filtered page distinct from provider failure", () => {
    const input = { ...page(), status: "empty", products: [] };
    expect(validateCatalogResponseV1(input, policy)).toEqual({
      success: true,
      data: input,
    });
    reject({ ...input, freshness: undefined });
    reject({ ...input, products: [product()] });
    reject({ ...input, pageInfo: { hasNextPage: true, endCursor: "next" } });
  });

  it.each(["product", "catalog-page"])(
    "allows data-free unavailable and stale %s envelopes",
    (kind) => {
      for (const state of [
        { status: "unavailable", code: "not_published" },
        { status: "unavailable", code: "unsupported_currency" },
        { status: "unavailable", code: "provider_unavailable" },
        { status: "stale", code: "refresh_required" },
      ]) {
        const input = {
          contractVersion: CATALOG_CONTRACT_VERSION,
          kind,
          ...state,
        };
        expect(validateCatalogResponseV1(input, policy).success).toBe(true);
        reject({ ...input, product: product() });
        reject({ ...input, products: [product()] });
        reject({ ...input, message: "raw provider secret" });
      }
    },
  );

  it.each([
    "draft",
    "DRAFT",
    "unpublished",
    "archived",
    "unknown",
    null,
    false,
  ])("rejects non-public publication evidence %s", (publication) =>
    reject(detail({ ...product(), publication })),
  );

  it("rejects missing publication and raw Admin status even beside a public claim", () => {
    const input = product();
    const { publication: omitted, ...missing } = input;
    expect(omitted).toBe("published");
    reject(detail(missing));
    reject(detail({ ...input, status: "DRAFT" }));
    reject(detail({ ...input, publication: true }));
  });

  it.each([
    { provider: "shopify_admin" },
    { provider: "fixture" },
    { shop: "other.myshopify.com" },
    { apiVersion: "2026-10" },
  ])("rejects a different or unsupported source %j", (change) =>
    reject({ ...detail(), source: { ...source, ...change } }),
  );

  it.each([2, "northside.catalog.v2", null])(
    "rejects unsupported wire version %s",
    (contractVersion) =>
      reject({ ...detail(), contractVersion }, "unsupported_contract_version"),
  );

  it.each([null, true, [], {}, "product", 123])(
    "rejects a missing or malformed response %j",
    (input) => reject(input),
  );

  it.each([
    { title: "" },
    { title: "   " },
    { title: "bad\u0000title" },
    { description: undefined },
    { description: "bad\u0000description" },
    { description: "x".repeat(20_001) },
    { handle: "../staff" },
    { id: "gid://shopify/Customer/1" },
    { id: "gid://shopify/Product/0" },
    { featuredImage: undefined },
    { minVariantPrice: null },
  ])("rejects missing, unsafe or unsupported product fields %j", (change) =>
    reject(detail({ ...product(), ...change })),
  );

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "12500",
  ])("rejects unsafe or coerced cents %s", (amountCents) =>
    reject(
      detail({
        ...product(),
        minVariantPrice: { amountCents, currencyCode: "USD" },
      }),
    ),
  );

  it("accepts genuine zero cents but rejects unsupported variant currency", () => {
    const zero = product({
      minVariantPrice: { amountCents: 0, currencyCode: "USD" },
    });
    zero.variants.nodes[0].price = { amountCents: 0, currencyCode: "USD" };
    expect(validateCatalogResponseV1(detail(zero), policy).success).toBe(true);
    const input = product();
    reject(
      detail({
        ...input,
        variants: {
          ...input.variants,
          nodes: [
            {
              ...variant(),
              price: { amountCents: 12500, currencyCode: "CAD" },
            },
          ],
        },
      }),
    );
  });

  it("preserves observed identifiers including barcode leading zeroes", () => {
    const input = product();
    input.variants.nodes[0].identifiers = {
      state: "observed",
      sku: "BOX-001",
      barcode: "000123456789",
    };
    const parsed = catalogProductV1Schema.parse(input);
    expect(parsed.variants.nodes[0].identifiers.barcode).toBe("000123456789");
    input.variants.nodes[0].identifiers = {
      state: "observed",
      sku: null,
      barcode: null,
    };
    expect(validateCatalogResponseV1(detail(input), policy).success).toBe(true);
    reject(
      detail({
        ...input,
        variants: {
          ...input.variants,
          nodes: [
            {
              ...variant(),
              identifiers: {
                state: "not_provided",
                sku: "invented",
                barcode: null,
              },
            },
          ],
        },
      }),
    );
    reject(
      detail({
        ...input,
        variants: {
          ...input.variants,
          nodes: [
            {
              ...variant(),
              identifiers: { state: "observed", sku: "BOX", barcode: 123 },
            },
          ],
        },
      }),
    );
  });

  it.each([
    {
      state: "unknown",
      availableForSale: true,
      currentlyNotInStock: false,
      quantityAvailable: null,
    },
    {
      state: "unavailable",
      availableForSale: true,
      currentlyNotInStock: false,
      quantityAvailable: 0,
    },
    {
      state: "unavailable",
      availableForSale: true,
      currentlyNotInStock: true,
      quantityAvailable: 3,
    },
    {
      state: "unavailable",
      availableForSale: false,
      currentlyNotInStock: false,
      quantityAvailable: null,
    },
  ])("accepts honest unavailable or unknown inventory %j", (availability) => {
    const input = product();
    reject(
      detail({
        ...input,
        variants: {
          ...input.variants,
          nodes: [
            {
              ...variant(),
              availability: { ...availability, state: "in_stock" },
            },
          ],
        },
      }),
    );
    expect(
      validateCatalogResponseV1(
        detail({
          ...input,
          variants: {
            ...input.variants,
            nodes: [{ ...variant(), availability }],
          },
        }),
        policy,
      ).success,
    ).toBe(true);
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, 2_147_483_648, "3", undefined])(
    "rejects malformed quantity %s",
    (quantityAvailable) => {
      const input = product();
      reject(
        detail({
          ...input,
          variants: {
            ...input.variants,
            nodes: [
              {
                ...variant(),
                availability: { ...variant().availability, quantityAvailable },
              },
            ],
          },
        }),
      );
    },
  );

  it("rejects foreign parent, duplicate variant and unavailable-page selection", () => {
    const input = product();
    reject(
      detail(
        product({
          variants: {
            nodes: [variant({ productId: "gid://shopify/Product/2" })],
            pageInfo,
            after: null,
          },
        }),
      ),
    );
    reject(
      detail(
        product({
          variants: { nodes: [variant(), variant()], pageInfo, after: null },
        }),
      ),
    );
    reject(
      detail(
        product({ selectedVariantId: "gid://shopify/ProductVariant/999" }),
      ),
    );
    reject(
      detail({
        ...input,
        variants: {
          nodes: [{ ...variant(), id: input.id }],
          pageInfo,
          after: null,
        },
      }),
    );
  });

  it("accepts a returned selected variant and does not treat SKU as unique identity", () => {
    const first = variant({
      identifiers: { state: "observed", sku: "DUPLICATE", barcode: null },
    });
    const second = { ...first, id: "gid://shopify/ProductVariant/102" };
    expect(
      validateCatalogResponseV1(
        detail(
          product({
            variants: { nodes: [first, second], pageInfo, after: null },
            selectedVariantId: second.id,
          }),
        ),
        policy,
      ).success,
    ).toBe(true);
  });

  it("keeps partial variant pages without inventing product-wide minimum or stock", () => {
    const input = product({
      minVariantPrice: { amountCents: 100, currencyCode: "USD" },
      variants: {
        nodes: [
          variant({
            availability: {
              state: "unavailable",
              availableForSale: false,
              currentlyNotInStock: false,
              quantityAvailable: 0,
            },
          }),
        ],
        pageInfo: { hasNextPage: true, endCursor: "variants-next" },
        after: null,
      },
    });
    expect(validateCatalogResponseV1(detail(input), policy).success).toBe(true);
  });

  it("rejects a false product aggregate with a sellable returned variant", () => {
    reject(detail(product({ availableForSale: false })));
    const input = product({ availableForSale: false });
    input.variants.nodes[0].availability = {
      state: "unavailable",
      availableForSale: false,
      currentlyNotInStock: false,
      quantityAvailable: 0,
    };
    expect(validateCatalogResponseV1(detail(input), policy).success).toBe(true);
  });

  it("supports an exhausted continuation without treating an initial missing variant as valid", () => {
    const input = product({
      variants: {
        nodes: [],
        pageInfo: { ...pageInfo },
        after: "previous-variant-cursor",
      },
    });
    expect(validateCatalogResponseV1(detail(input), policy).success).toBe(true);
    reject(detail(product({ ...input, selectedVariantId: variant().id })));
    reject(detail(product({ variants: { ...input.variants, after: null } })));
    reject(
      detail(
        product({
          variants: {
            ...input.variants,
            pageInfo: { hasNextPage: true, endCursor: "next" },
          },
        }),
      ),
    );
    reject(
      detail(
        product({
          variants: {
            ...input.variants,
            pageInfo: { hasNextPage: false, endCursor: "last" },
          },
        }),
      ),
    );
  });

  it("rejects oversized pages independently of identity uniqueness", () => {
    const products = Array.from({ length: 13 }, (_, index) => {
      const id = `gid://shopify/Product/${index + 1}`;
      const handle = `test-${index + 1}`;
      return product({
        id,
        handle,
        productPath: `/shop/${handle}`,
        variants: {
          nodes: [
            variant({
              id: `gid://shopify/ProductVariant/${index + 100}`,
              productId: id,
            }),
          ],
          pageInfo,
          after: null,
        },
      });
    });
    expect(
      validateCatalogResponseV1(
        { ...page(), products: products.slice(0, 12) },
        policy,
      ).success,
    ).toBe(true);
    reject({ ...page(), products });
    const input = product();
    input.variants.nodes = Array.from({ length: 101 }, (_, index) =>
      variant({ id: `gid://shopify/ProductVariant/${index + 1}` }),
    );
    reject(detail(input));
  });

  it("accepts a deliberate missing image without a sample replacement", () => {
    expect(
      validateCatalogResponseV1(
        detail(product({ featuredImage: null })),
        policy,
      ).success,
    ).toBe(true);
  });

  it.each([
    "http://cdn.shopify.com/s/files/test.jpg",
    "https://cdn.shopify.com.evil.example/s/files/test.jpg",
    "https://name:secret@cdn.shopify.com/s/files/test.jpg",
    "https://cdn.shopify.com/s/files/test.jpg?token=private",
    "https://cdn.shopify.com/s/files/test.jpg#private",
    "https://cdn.shopify.com/s/files/test.jpg?width=100&width=200",
    "https://cdn.shopify.com/admin/private.jpg",
    "https://127.0.0.1/private.jpg",
    "data:image/svg+xml,private",
    "/shopping-sample.svg",
  ])("rejects an unsafe or unapproved image %s", (url) =>
    reject(detail({ ...product(), featuredImage: { url, altText: null } })),
  );

  it("accepts only matching customer/product destinations, with null when not supplied", () => {
    const own = `https://${CATALOG_SHOP}/products/test-box`;
    expect(
      validateCatalogResponseV1(
        detail(product({ onlineStoreUrl: own })),
        policy,
      ).success,
    ).toBe(true);
    for (const onlineStoreUrl of [
      own + "?key=private",
      own + "#section",
      own.replace("test-box", "another-box"),
      "https://other.myshopify.com/products/test-box",
      "javascript:alert(1)",
    ])
      reject(detail({ ...product(), onlineStoreUrl }));
    reject(detail(product({ productPath: "/staff/test-box" })));
    reject(detail(product({ productPath: "/shop/test-box?token=secret" })));
  });

  it("rejects impossible pagination, duplicate products and a ready page with no products", () => {
    reject({ ...page(), products: [] });
    reject({ ...page(), products: [product(), product()] });
    reject({ ...page(), pageInfo: { hasNextPage: true, endCursor: null } });
    reject({
      ...page(),
      collections: {
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      },
    });
    reject({
      ...page(),
      products: Array.from({ length: 13 }, () => product()),
    });
    reject(detail(product({ variants: { nodes: [], pageInfo, after: null } })));
    expect(
      validateCatalogResponseV1(
        { ...page(), pageInfo: { hasNextPage: false, endCursor: "last" } },
        policy,
      ).success,
    ).toBe(true);
  });

  it("rejects cross-product reuse of a variant even with a rewritten parent", () => {
    const second = product({
      id: "gid://shopify/Product/2",
      handle: "second",
      productPath: "/shop/second",
    });
    second.variants.nodes[0].productId = second.id;
    reject({ ...page(), products: [product(), second] });
  });

  it("rejects unknown private fields at every catalog boundary", () => {
    const marker = "PRIVATE_VALUE_MUST_NOT_ESCAPE";
    const input = product();
    const variants = input.variants;
    const payloads = [
      { ...detail(), adminAccessToken: marker },
      { ...detail(), source: { ...source, privateToken: marker } },
      detail({ ...input, customerEmail: marker }),
      detail({ ...input, staffNotes: marker }),
      detail({
        ...input,
        variants: {
          ...variants,
          nodes: [{ ...variant(), storageLocation: marker }],
        },
      }),
      detail({
        ...input,
        variants: {
          ...variants,
          nodes: [
            { ...variant(), price: { ...variant().price, cartId: marker } },
          ],
        },
      }),
      detail({
        ...input,
        variants: {
          ...variants,
          nodes: [
            {
              ...variant(),
              availability: {
                ...variant().availability,
                breakerStorage: marker,
              },
            },
          ],
        },
      }),
    ];
    for (const payload of payloads) {
      reject(payload);
      expect(
        JSON.stringify(validateCatalogResponseV1(payload, policy)),
      ).not.toContain(marker);
    }
  });

  it.each([
    "2026-02-30T18:00:00.000Z",
    "2026-11-03T18:00:00Z",
    "2026-11-03T12:00:00.000-06:00",
    "not-a-date",
  ])("rejects malformed/noncanonical observation %s", (value) =>
    reject({ ...detail(), freshness: { ...freshness, observedAt: value } }),
  );

  it("rejects inverted/equal expiry and snapshots from the future", () => {
    reject({ ...detail(), freshness: { observedAt, expiresAt: observedAt } });
    reject({
      ...detail(),
      freshness: { observedAt, expiresAt: "2026-11-03T17:00:00.000Z" },
    });
    expect(
      validateCatalogResponseV1(detail(), {
        ...policy,
        nowMs: Date.parse(observedAt) - 1,
      }),
    ).toEqual({ success: false, error: { code: "future_snapshot" } });
  });

  it("rejects expiry and caller max-age boundaries without returning stale data", () => {
    for (const nowMs of [
      Date.parse(freshness.expiresAt),
      Date.parse(freshness.expiresAt) + 1,
    ]) {
      expect(validateCatalogResponseV1(detail(), { ...policy, nowMs })).toEqual(
        { success: false, error: { code: "stale_snapshot" } },
      );
    }
    expect(
      validateCatalogResponseV1(detail(), { ...policy, maxAgeMs: 1000 }),
    ).toEqual({ success: false, error: { code: "stale_snapshot" } });
    expect(
      validateCatalogResponseV1(detail(), { ...policy, maxAgeMs: 1001 })
        .success,
    ).toBe(true);
    const empty = { ...page(), status: "empty", products: [] };
    expect(
      validateCatalogResponseV1(empty, {
        ...policy,
        nowMs: Date.parse(freshness.expiresAt),
      }).success,
    ).toBe(false);
  });

  it.each([
    { nowMs: Number.NaN, maxAgeMs: 1000 },
    { nowMs: -1, maxAgeMs: 1000 },
    { nowMs: 8_640_000_000_000_001, maxAgeMs: 1000 },
    { nowMs: policy.nowMs, maxAgeMs: 0 },
    { nowMs: policy.nowMs, maxAgeMs: 0.5 },
    { nowMs: policy.nowMs, maxAgeMs: Number.POSITIVE_INFINITY },
  ])("rejects an invalid freshness policy %j", (value) =>
    expect(validateCatalogResponseV1(detail(), value)).toEqual({
      success: false,
      error: { code: "invalid_freshness_policy" },
    }),
  );

  it("fails closed for a missing policy at an untyped runtime boundary", () => {
    expect(
      validateCatalogResponseV1(
        detail(),
        null as unknown as CatalogFreshnessPolicy,
      ),
    ).toEqual({ success: false, error: { code: "invalid_freshness_policy" } });
  });
});
