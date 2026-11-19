import test from "node:test";
import assert from "node:assert/strict";
import type { Query } from "../lib/server/storefront";
import {
  lookupActiveScan,
  lookupCartScan,
} from "../lib/server/mobile/active-scan";
import { mobileHandler } from "../lib/server/mobile/http";

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

test("production barcode HTTP uses live Shopify with the staging cart flag off", async (t) => {
  const shop = "9i3hnb-jw.myshopify.com";
  const settings = {
    NODE_ENV: "production",
    APP_ORIGIN: "https://api.example.test",
    NORTHSIDE_MOBILE_ENVIRONMENT: "production",
    NORTHSIDE_MOBILE_SCAN_CART_APPROVED: "false",
    NORTHSIDE_MOBILE_APPROVED_COLLECTION: "",
    NORTHSIDE_FIXTURES: "0",
    SHOPIFY_SHOP: shop,
    SHOPIFY_API_VERSION: "2026-07",
    SHOPIFY_ADMIN_AUTH_MODE: "installed_oauth",
    SHOPIFY_ADMIN_ACCESS_TOKEN: "synthetic-admin-token",
    SHOPIFY_ADMIN_TOKEN_EXPIRES_AT: new Date(
      Date.now() + 3_600_000,
    ).toISOString(),
    SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "synthetic-storefront-token",
  };
  const before = Object.keys(settings).map(
    (key) => [key, process.env[key]] as const,
  );
  t.after(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, settings);

  const unknown = "012345678905";
  let claims = [claim];
  let node: typeof visible | null = visible;
  let providerUnavailable = false;
  const log = t.mock.method(console, "error", (message: string) => {
    assert.equal(typeof message, "string");
  });
  const provider = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | Request | URL, init?: RequestInit) => {
      const { query, variables } = JSON.parse(String(init?.body));
      if (url === `https://${shop}/admin/api/2026-10/graphql.json`) {
        assert.match(query, /^query ActiveScanVariants/);
        if (providerUnavailable) return new Response(null, { status: 503 });
        const requested = variables.search.includes(`barcode:"${unknown}"`)
          ? []
          : claims;
        return Response.json({ data: page(requested) });
      }
      assert.equal(url, `https://${shop}/api/2026-07/graphql.json`);
      assert.match(query, /^query NativeScannedVariant/);
      assert.deepEqual(variables, { id });
      return Response.json({ data: { node } });
    },
  );
  const post = (path: string, body: object) =>
    mobileHandler(
      new Request(`${settings.APP_ORIGIN}/api/mobile/v1/${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const scan = (code = barcode, format = "upc_a") =>
    post("scan", { code, format });
  async function expectError(response: Response, status: number, code: string) {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.kind, "error");
    assert.deepEqual(body.error, { code });
    return body.requestId as string;
  }

  const published = await scan();
  assert.equal(published.status, 200);
  const detail = await published.json();
  assert.equal(detail.kind, "product-detail");
  assert.equal(detail.product.selectedVariantId, id);
  assert.equal(detail.product.variants.nodes.length, 1);
  assert.deepEqual(detail.product.variants.nodes[0].price, {
    amountCents: 2995,
    currencyCode: "USD",
  });
  const equivalent = await scan(`0${barcode}`, "ean13");
  assert.equal(equivalent.status, 200);
  assert.equal((await equivalent.json()).product.selectedVariantId, id);

  node = null;
  const scanOnly = await scan();
  assert.equal(scanOnly.status, 200);
  assert.equal((await scanOnly.json()).kind, "active-item");
  await expectError(await scan(unknown), 404, "not_found");
  claims = [claim, { ...claim, id: "gid://shopify/ProductVariant/31" }];
  await expectError(await scan(), 400, "ambiguous_scan");
  assert.equal(log.mock.callCount(), 0);
  providerUnavailable = true;
  const failedRequest = await expectError(
    await scan(),
    503,
    "service_unavailable",
  );
  const [message] = log.mock.calls[0].arguments;
  const diagnostic = JSON.parse(message);
  assert.equal(diagnostic.event, "mobile_barcode_scan_failed");
  assert.equal(diagnostic.requestId, failedRequest);
  assert.equal(diagnostic.step, "admin_barcode_query");
  assert.equal(diagnostic.upstreamStatus, 503);
  assert.equal(diagnostic.reason, "shopify_unavailable");
  assert.doesNotMatch(
    message,
    /synthetic-admin-token|synthetic-storefront-token/,
  );
  assert.ok(!message.includes(barcode));

  const readCalls = provider.mock.callCount();
  for (const key of [
    "SHOPIFY_STOREFRONT_PRIVATE_TOKEN",
    "SHOPIFY_ADMIN_ACCESS_TOKEN",
  ] as const) {
    delete process.env[key];
    await expectError(await scan(), 503, "not_configured");
    process.env[key] = settings[key];
  }
  await expectError(
    await post("shopping", { action: "start" }),
    404,
    "not_found",
  );
  await expectError(
    await scan("https://api.example.test/q/123", "qr"),
    503,
    "not_configured",
  );
  await expectError(
    await post("scan", { code: "https://api.example.test/q/123" }),
    503,
    "not_configured",
  );
  process.env.NORTHSIDE_FIXTURES = "1";
  await expectError(await scan(), 503, "not_configured");
  assert.equal(provider.mock.callCount(), readCalls);
});
