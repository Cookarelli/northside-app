import test from "node:test";
import assert from "node:assert/strict";
import type { Query } from "../lib/server/storefront";
import {
  lookupActiveScan,
  lookupCartScan,
} from "../lib/server/mobile/active-scan";

const barcode = "887521144914",
  id = "gid://shopify/ProductVariant/12";
const product = {
  id: "gid://shopify/Product/5",
  title: "Value Box",
  status: "ACTIVE",
};
const claim = {
  id,
  title: "Default Title",
  price: "29.95",
  product,
  barcodes: {
    nodes: [{ value: barcode }, { value: "BOX-ABC" }],
    pageInfo: { hasNextPage: false },
  },
};
function page(nodes: (typeof claim)[], cursor: string | null = null) {
  return {
    shop: { currencyCode: "USD" },
    productVariants: {
      nodes,
      pageInfo: { hasNextPage: !!cursor, endCursor: cursor },
    },
  };
}
const visible = {
  id,
  title: "Default Title",
  sku: "SKU-ONLY",
  barcode,
  availableForSale: true,
  currentlyNotInStock: false,
  price: { amount: "29.95", currencyCode: "USD" },
  product: {
    id: product.id,
    title: product.title,
    handle: "value-box",
    description: "",
    productType: "Cards",
    publishedAt: "2026-01-01T00:00:00Z",
    availableForSale: true,
    featuredImage: null,
    priceRange: { minVariantPrice: { amount: "29.95", currencyCode: "USD" } },
  },
};
const returns =
  (value: unknown): Query =>
  async <T>() =>
    value as T;
test("looks up an active barcode even without a Storefront listing and excludes it from app cart", async () => {
  const admin: Query = async <T>(_doc: string, vars: object) => {
    assert.deepEqual(vars, {
      search:
        'product_status:active AND (barcode:"887521144914" OR barcode:"0887521144914")',
      after: null,
    });
    return page([claim]) as T;
  };
  const scan = await lookupActiveScan(
    barcode,
    "code128",
    returns({ node: null }),
    admin,
  );
  assert.equal(scan.kind, "active-item");
  assert.equal(scan.product.selectedVariantId, id);
  assert.deepEqual(Object.keys(scan.product).sort(), [
    "barcode",
    "id",
    "price",
    "selectedVariantId",
    "title",
    "variantTitle",
  ]);
  await assert.rejects(
    lookupCartScan(barcode, "code128", returns({ node: null }), admin),
    { code: "quantity_unavailable" },
  );
});
test("joined variant matches its Shopify alternate barcode, including when sold out", async () => {
  const result = await lookupActiveScan(
    "BOX-ABC",
    "code128",
    returns({ node: { ...visible, availableForSale: false } }),
    returns(page([claim])),
  );
  assert.equal(result.kind, "product-detail");
  assert.equal(result.product.variants.nodes[0].identifiers.barcode, "BOX-ABC");
  assert.equal(
    result.product.variants.nodes[0].availability.state,
    "unavailable",
  );
});
test("distinct active IDs across pages are ambiguous even if one matches a padded code", async () => {
  const other = {
    ...claim,
    id: "gid://shopify/ProductVariant/13",
    barcodes: { ...claim.barcodes, nodes: [{ value: "0" + barcode }] },
  };
  const admin: Query = async <T>(_doc: string, vars: object) =>
    ("after" in vars && vars.after
      ? page([other])
      : page([claim], "next")) as T;
  await assert.rejects(
    lookupActiveScan(barcode, "code128", returns(null), admin),
    { code: "ambiguous_scan" },
  );
});
test("ignores draft, archived, unlisted and inexact index hits", async () => {
  const inactive = ["DRAFT", "ARCHIVED", "UNLISTED"].map((status) => ({
    ...claim,
    product: { ...product, status },
  }));
  const other = {
    ...claim,
    barcodes: { ...claim.barcodes, nodes: [{ value: "box-abc" }] },
  };
  await assert.rejects(
    lookupActiveScan(
      "BOX-ABC",
      "code128",
      returns(null),
      returns(page([...inactive, other])),
    ),
    { code: "not_found" },
  );
});
test("rejects inconsistent provider results, invalid scans and incomplete pages", async () => {
  await assert.rejects(
    lookupActiveScan(
      barcode,
      "code128",
      returns({ node: { ...visible, id: "gid://shopify/ProductVariant/84" } }),
      returns(page([claim])),
    ),
    { code: "invalid_provider_data" },
  );
  await assert.rejects(
    lookupActiveScan(
      barcode,
      "code128",
      returns(null),
      returns(page([claim], "loop")),
    ),
    { code: "invalid_provider_data" },
  );
  await assert.rejects(
    lookupActiveScan("\u0000INVALID", "code128", returns(null), returns(null)),
    { code: "invalid_request" },
  );
});
test("future publication is lookup-only and long literal barcode searches use escaped input", async () => {
  const literal = "A".repeat(128) + '" (BOX):\\';
  const row = {
    ...claim,
    barcodes: {
      ...claim.barcodes,
      nodes: [{ value: barcode }, { value: literal }],
    },
  };
  const admin: Query = async <T>(_doc: string, vars: object) => {
    assert.equal(
      (vars as { search: string }).search,
      'product_status:active AND (barcode:"' +
        "A".repeat(128) +
        '\\" \\(BOX\\)\\:\\\\")',
    );
    return page([row]) as T;
  };
  const result = await lookupActiveScan(
    literal,
    "code128",
    returns({
      node: {
        ...visible,
        product: {
          ...visible.product,
          publishedAt: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    }),
    admin,
  );
  assert.equal(result.kind, "active-item");
});
test("the scanner HTTP response preserves an ambiguous active barcode", async () => {
  const { mobileError } = await import("../lib/server/mobile/http");
  const other = { ...claim, id: "gid://shopify/ProductVariant/31" };
  const response = await lookupActiveScan(
    barcode,
    "code128",
    returns(null),
    returns(page([claim, other])),
  ).catch(mobileError);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "ambiguous_scan");
});
