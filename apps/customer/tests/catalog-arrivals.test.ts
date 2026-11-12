import test from "node:test";
import assert from "node:assert/strict";
import {
  readCatalog,
  MOBILE_CATALOG_QUERY,
  MOBILE_SINGLES_QUERY,
  MOBILE_PRODUCT_QUERY,
} from "../lib/server/mobile/catalog";
import { mobileHandler } from "../lib/server/mobile/http";
import { catalogInputSchema } from "../../../packages/customer-contracts/src/mvp";
import type { Query } from "../lib/server/storefront";

const approved = "synthetic-approved";
const env = {
  NORTHSIDE_MOBILE_NEW_ARRIVALS_COLLECTION: "synthetic-arrivals",
  NORTHSIDE_MOBILE_SINGLES_COLLECTION: "synthetic-singles",
};
function item(id = 1) {
  return {
    id: `gid://shopify/Product/${id}`,
    handle: `synthetic-single-${id}`,
    title: `SYNTHETIC single ${id}`,
    description: "Isolated merchandising contract test; no real product.",
    productType: "Synthetic singles",
    tags: ["ns:merchandising:new-arrival-verified"],
    publishedAt: "2026-01-01T00:00:00Z",
    availableForSale: true,
    featuredImage: null,
    priceRange: { minVariantPrice: { amount: "1.00", currencyCode: "USD" } },
    variants: {
      nodes: [
        {
          id: `gid://shopify/ProductVariant/${id}`,
          title: "Base",
          sku: `SYNTHETIC-${id}`,
          barcode: null,
          availableForSale: true,
          currentlyNotInStock: false,
          price: { amount: "1.00", currencyCode: "USD" },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    collections: {
      nodes: [
        { handle: approved },
        { handle: env.NORTHSIDE_MOBILE_SINGLES_COLLECTION },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
}
function page(
  products = [item()],
  next: string | null = null,
  handle = env.NORTHSIDE_MOBILE_NEW_ARRIVALS_COLLECTION,
) {
  return {
    collection: {
      handle,
      products: {
        nodes: products,
        filters: [],
        pageInfo: { hasNextPage: next !== null, endCursor: next },
      },
    },
  };
}
const source =
  (value: unknown): Query =>
  async <T>() =>
    value as T;
const feed = { feed: "singles-new-arrivals" as const };
const read = (value: unknown, input = feed) =>
  readCatalog(input, source(value), approved, undefined, env);

test("singles arrivals retain Storefront collection order and require all merchandising proofs", async () => {
  const noSingles = {
    ...item(3),
    collections: {
      nodes: [{ handle: approved }],
      pageInfo: { hasNextPage: true },
    },
  };
  const noApproval = {
    ...item(4),
    collections: {
      nodes: [{ handle: env.NORTHSIDE_MOBILE_SINGLES_COLLECTION }],
      pageInfo: { hasNextPage: true },
    },
  };
  const query: Query = async <T>(document: string, variables: object) => {
    assert.equal(document, MOBILE_SINGLES_QUERY);
    assert(document.startsWith("query"));
    assert(!/mutation|inventoryLevels|quantityAvailable|admin/i.test(document));
    assert.deepEqual(variables, {
      handle: env.NORTHSIDE_MOBILE_NEW_ARRIVALS_COLLECTION,
      after: undefined,
      filters: [],
    });
    return page([
      item(2),
      noSingles,
      noApproval,
      { ...item(5), tags: [] },
      item(1),
    ]) as T;
  };
  const result = await readCatalog(feed, query, approved, undefined, env);
  assert.deepEqual(
    result.products.map((p) => p.id),
    ["gid://shopify/Product/2", "gid://shopify/Product/1"],
  );
  assert.deepEqual(result.categories, ["Synthetic singles"]);
  assert(!("feed" in result)); // The existing strict response contract stays compatible.
});

test("missing or malformed feed configuration makes zero provider requests", async () => {
  let calls = 0;
  const query: Query = async <T>() => {
    calls++;
    return page() as T;
  };
  for (const config of [
    {},
    { ...env, NORTHSIDE_MOBILE_SINGLES_COLLECTION: "" },
    {
      ...env,
      NORTHSIDE_MOBILE_NEW_ARRIVALS_COLLECTION: "https://invalid.test",
    },
    { ...env, NORTHSIDE_MOBILE_SINGLES_COLLECTION: "single\n" },
  ])
    await assert.rejects(
      readCatalog(feed, query, approved, undefined, config),
      { code: "not_configured" },
    );
  assert.equal(calls, 0);
});

test("ordinary catalog does not depend on singles configuration or a new approval rule", async () => {
  const result = await readCatalog(
    {},
    source(page([{ ...item(), tags: [] }], null, approved)),
    approved,
    undefined,
    {},
  );
  assert.equal(result.products.length, 1);
  assert(!/\btags\b/.test(MOBILE_CATALOG_QUERY));
  assert(!/\btags\b/.test(MOBILE_PRODUCT_QUERY));
  assert(/\btags\b/.test(MOBILE_SINGLES_QUERY));
});

test("missing tag-read permission fails only the opt-in feed without a general-catalog fallback", async () => {
  let calls = 0;
  const denied: Query = async () => {
    calls++;
    throw new Error("SYNTHETIC tag permission denied");
  };
  await assert.rejects(readCatalog(feed, denied, approved, undefined, env));
  assert.equal(calls, 1);
  const legacyQuery: Query = async <T>(document: string) => {
    assert(!/\btags\b/.test(document));
    return page([item()], null, "synthetic-releases") as T;
  };
  assert.equal(
    (await readCatalog({}, legacyQuery, "synthetic-releases", approved))
      .products.length,
    1,
  );
});

test("unpublished, future, missing and wrong collection responses fail closed", async () => {
  for (const publishedAt of ["", "not-a-date", "2999-01-01T00:00:00Z"])
    await assert.rejects(read(page([{ ...item(), publishedAt }])));
  await assert.rejects(read({ collection: null }), { code: "not_configured" });
  await assert.rejects(read(page([item()], null, "wrong-source")), {
    code: "not_configured",
  });
});

test("missing membership or tag never turns a Draft-like selection into singles arrivals", async () => {
  for (const product of [
    { ...item(), tags: [] },
    { ...item(), collections: undefined },
    { ...item(), collections: { nodes: [], pageInfo: { hasNextPage: true } } },
  ]) {
    const result = await read(page([product] as ReturnType<typeof item>[]));
    assert.equal(result.products.length, 0);
  }
});

test("availability and images stay honest while staff stock and raw tags remain private", async () => {
  const product = item();
  product.variants.nodes[0].currentlyNotInStock = true;
  const result = await read(
    page([
      {
        ...product,
        staffNote: "PRIVATE_SENTINEL",
        internalPool: "breaker",
        quantityAvailable: 77,
      } as ReturnType<typeof item>,
    ]),
  );
  assert.equal(result.products[0].featuredImage, null);
  assert.equal(
    result.products[0].variants.nodes[0].availability.state,
    "unavailable",
  );
  assert.equal(
    result.products[0].variants.nodes[0].availability.quantityAvailable,
    null,
  );
  assert(
    !/PRIVATE_SENTINEL|breaker|new-arrival-verified/.test(
      JSON.stringify(result),
    ),
  );
  assert(!JSON.stringify(result).includes('"quantityAvailable":77'));
  const unavailable = item();
  unavailable.availableForSale = false;
  unavailable.variants.nodes[0].availableForSale = false;
  assert.equal(
    (await read(page([unavailable]))).products[0].availableForSale,
    false,
  );
});

test("malformed image, price, currency and variant records are not exposed", async () => {
  for (const product of [
    {
      ...item(),
      featuredImage: {
        url: "https://private.test/image?token=SYNTHETIC",
        altText: null,
      },
    },
    {
      ...item(),
      priceRange: { minVariantPrice: { amount: "NaN", currencyCode: "USD" } },
    },
    {
      ...item(),
      priceRange: { minVariantPrice: { amount: "1.00", currencyCode: "EUR" } },
    },
    {
      ...item(),
      variants: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  ])
    await assert.rejects(read(page([product] as ReturnType<typeof item>[])));
});

test("nonempty pages cannot repeat the input cursor or cycle during filtered search", async () => {
  await assert.rejects(
    readCatalog(
      { after: "same" },
      source(page([item()], "same", approved)),
      approved,
    ),
    { code: "invalid_provider_data" },
  );
  let calls = 0;
  const cycle: Query = async <T>() => {
    calls++;
    return page([item()], "same", approved) as T;
  };
  await assert.rejects(readCatalog({ q: "no match" }, cycle, approved), {
    code: "invalid_provider_data",
  });
  assert.equal(calls, 2);
  await assert.rejects(
    readCatalog(
      {},
      source({
        collection: {
          ...page().collection,
          handle: approved,
          products: {
            ...page().collection.products,
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      }),
      approved,
    ),
    { code: "invalid_provider_data" },
  );
});

test("singles search and category filter stay inside the configured source across pages", async () => {
  let calls = 0;
  const query: Query = async <T>(_document: string, variables: object) => {
    const v = variables as { handle: string; after?: string; filters: unknown };
    assert.equal(v.handle, env.NORTHSIDE_MOBILE_NEW_ARRIVALS_COLLECTION);
    assert.deepEqual(v.filters, [{ productType: "Synthetic singles" }]);
    calls++;
    assert.equal(v.after, calls === 1 ? undefined : "next");
    return page(
      [{ ...item(), title: calls === 1 ? "Other" : "Find me" }],
      calls === 1 ? "next" : null,
    ) as T;
  };
  const result = await readCatalog(
    { ...feed, q: "Find", category: "Synthetic singles" },
    query,
    approved,
    undefined,
    env,
  );
  assert.equal(calls, 2);
  assert.equal(result.products[0].title, "Find me");
});

test("strict request validation rejects unknown feeds, client-chosen collections and duplicate parameters", async () => {
  for (const value of [
    { feed: "drafts" },
    { feed: ["singles-new-arrivals"] },
    { collection: "any" },
    { after: "bad\n" },
  ]) {
    assert.equal(catalogInputSchema.safeParse(value).success, false);
    await assert.rejects(
      readCatalog(value as never, source(page()), approved),
      { code: "invalid_request" },
    );
  }
  for (const query of [
    "feed=drafts",
    "feed=singles-new-arrivals&feed=singles-new-arrivals",
    "collection=any",
  ]) {
    const response = await mobileHandler(
      new Request(
        "https://backend.example.test/api/mobile/v1/catalog?" + query,
      ),
    );
    assert.equal(response.status, 400);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await response.json()).error.code, "invalid_request");
  }
});
