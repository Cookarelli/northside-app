import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { addScannedLine, type ScanCartInput } from "../lib/server/scan-cart";
import { cartInput } from "../lib/server/cart-input";
import { resolveScan, type CatalogProof } from "../lib/server/store";
import { validateBreakCart } from "../lib/server/break-commerce";
import { createCart, cartView, type Query } from "../lib/server/storefront";
import { TENANT, SHOP } from "../lib/server/providers";
import { approvedBasketballSales } from "../lib/approved-basketball-sales";
import { type Sql } from "../lib/server/db";
import { POST } from "../app/api/commerce/cart/route";
import type { Cart } from "../lib/commerce";

// Real registry projections/RLS plus synthetic Storefront. No env files,
// provider requests, inventory mutations, checkout or real payment evidence.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("External network prohibited");
};
const previousOrigin = process.env.NORTHSIDE_QR_ORIGIN;
process.env.NORTHSIDE_QR_ORIGIN = "https://scan-test.invalid";
process.env.APP_ORIGIN = "https://scan-test.invalid";
const db = await PGlite.create();
for (const name of [
  "202609120001_identity_and_records.sql",
  "202609120003_commerce.sql",
  "202609120007_breaks.sql",
  "202609120008_store.sql",
])
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
const productId = randomUUID(),
  variantId = randomUUID(),
  locationId = randomUUID();
const providerVariant = "gid://shopify/ProductVariant/990001";
const providerProduct = "gid://shopify/Product/990001";
const token = "A".repeat(24);
await db.query(
  "insert into ns.store_products(tenant_id,id,shopify_product_id,title,family,handle) values($1,$2,$3,'SYNTHETIC box','SYNTHETIC','synthetic-box')",
  [TENANT, productId, providerProduct],
);
await db.query(
  "insert into ns.store_variants(tenant_id,id,product_id,shopify_variant_id,sku,barcode,verified,evidence) values($1,$2,$3,$4,'SYNTHETIC-SKU','000012345678',true,'SYNTHETIC local test only')",
  [TENANT, variantId, productId, providerVariant],
);
await db.query(
  "insert into ns.store_locations(tenant_id,id,pool,label,approved_retail) values($1,$2,'retail','SYNTHETIC display',true)",
  [TENANT, locationId],
);
await db.query(
  "insert into ns.store_assignments(tenant_id,variant_id,location_id) values($1,$2,$3)",
  [TENANT, variantId, locationId],
);
await db.query(
  "insert into ns.store_qr(tenant_id,token,product_id,destination) values($1,$2,$3,'product')",
  [TENANT, token, productId],
);
test.after(async () => {
  globalThis.fetch = originalFetch;
  if (previousOrigin === undefined) delete process.env.NORTHSIDE_QR_ORIGIN;
  else process.env.NORTHSIDE_QR_ORIGIN = previousOrigin;
  await db.close();
});
async function tx<T>(
  role: "runtime" | "commerce",
  fn: (sql: Sql) => Promise<T>,
) {
  return db.transaction(async (t) => {
    await t.exec(`set local role northside_${role}`);
    return fn(t as unknown as Sql);
  });
}
function provider() {
  const money = { amount: "12.00", currencyCode: "USD" };
  const proof: CatalogProof = {
    id: providerProduct,
    title: "SYNTHETIC box",
    handle: "synthetic-box",
    variants: {
      pageInfo: { hasNextPage: false },
      nodes: [
        {
          id: providerVariant,
          title: "SYNTHETIC base",
          sku: "SYNTHETIC-SKU",
          barcode: "000012345678",
          price: money,
          availableForSale: true,
          currentlyNotInStock: false,
          quantityAvailable: 3,
        },
      ],
    },
  };
  const cart: Cart = {
    id: "gid://shopify/Cart/SYNTHETIC?key=PRIVATE",
    totalQuantity: 0,
    cost: {
      subtotalAmount: money,
      totalAmount: money,
      totalAmountEstimated: true,
    },
    discountCodes: [],
    lines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  };
  const calls: string[] = [];
  let stockAtAdd = 3;
  let priceAtAdd = money;
  const query: Query = async <T>(document: string, variables: object) => {
    calls.push(document);
    if (document.includes("query ScannedProduct"))
      return { node: structuredClone(proof) } as T;
    if (document.includes("query Availability"))
      return {
        node: {
          ...proof.variants.nodes[0],
          quantityAvailable: stockAtAdd,
          price: priceAtAdd,
        },
      } as T;
    if (document.includes("query Cart"))
      return { cart: structuredClone(cart) } as T;
    if (document.startsWith("mutation cartCreate"))
      return {
        cartCreate: {
          cart: structuredClone(cart),
          userErrors: [],
          warnings: [],
        },
      } as T;
    if (document.startsWith("mutation cartLinesAdd")) {
      const lines = (
        variables as { lines: { merchandiseId: string; quantity: number }[] }
      ).lines;
      assert.equal(lines[0].merchandiseId, providerVariant);
      cart.lines.nodes.push({
        id: `PRIVATE_LINE_${cart.lines.nodes.length}`,
        quantity: lines[0].quantity,
        merchandise: {
          ...proof.variants.nodes[0],
          product: { title: proof.title, handle: proof.handle },
        },
        cost: { totalAmount: money },
      });
      cart.totalQuantity += lines[0].quantity;
      return {
        cartLinesAdd: {
          cart: structuredClone(cart),
          userErrors: [],
          warnings: [],
        },
      } as T;
    }
    throw Error("Unexpected provider operation");
  };
  const input: ScanCartInput = {
    code: "000012345678",
    variantId: providerVariant,
    quantity: 1,
    reviewedPriceCents: 1200,
  };
  const resolve = (code: string) =>
    tx("runtime", (sql) => resolveScan(sql, code, "live", query));
  const add = (change: Partial<ScanCartInput> = {}) =>
    addScannedLine(query, cart.id, { ...input, ...change }, resolve, (lines) =>
      tx("commerce", (sql) => validateBreakCart(sql, lines, false)),
    );
  return {
    query,
    proof,
    cart,
    calls,
    input,
    resolve,
    add,
    price: (amount: string) => {
      priceAtAdd = { amount, currencyCode: "USD" };
    },
    stock: (n: number) => {
      stockAtAdd = n;
    },
    mutations: () =>
      calls.filter((s) => s.startsWith("mutation cartLinesAdd")).length,
  };
}

test("barcode retains leading zeroes, resolves only approved registry fields, and explicitly adds to a redacted Storefront cart", async () => {
  const p = provider();
  await createCart(p.query);
  const scan = await p.resolve(p.input.code);
  assert.equal(scan.selected_variant, providerVariant);
  assert.equal(p.mutations(), 0, "scanning alone never adds");
  const result = cartView(await p.add());
  assert.equal(result.totalQuantity, 1);
  assert.equal(result.lines.nodes[0].merchandise.id, providerVariant);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.equal(p.mutations(), 1);
  assert.ok(
    !p.calls.some((c) => /checkout|inventoryAdjust|orderCreate/.test(c)),
  );
});

test("product QR needs an explicit verified variant; barcode cannot select a different variant", async () => {
  const p = provider();
  const qr = `https://scan-test.invalid/q/${token}`;
  assert.equal((await p.resolve(qr)).selected_variant, null);
  await assert.rejects(
    p.add({ code: qr, variantId: "gid://shopify/ProductVariant/999" }),
    /missing_or_unverified_variant/,
  );
  await assert.rejects(
    p.add({ variantId: "gid://shopify/ProductVariant/999" }),
    /scanned_variant_mismatch/,
  );
  assert.equal(p.mutations(), 0);
  assert.equal((await p.add({ code: qr })).totalQuantity, 1);
});

test("foreign URLs, unknown barcodes and revoked printed labels cannot produce cart mutations", async () => {
  const p = provider();
  await assert.rejects(
    p.add({ code: "https://evil.invalid/products/synthetic-box" }),
    /foreign_or_unsupported_code/,
  );
  await assert.rejects(
    p.add({ code: "UNKNOWN" }),
    /code_not_registered_or_disabled/,
  );
  await db.query("update ns.store_qr set active=false where token=$1", [token]);
  try {
    await assert.rejects(
      p.add({ code: `https://scan-test.invalid/q/${token}` }),
      /code_not_registered_or_disabled/,
    );
  } finally {
    await db.query("update ns.store_qr set active=true where token=$1", [
      token,
    ]);
  }
  assert.equal(p.mutations(), 0);
});

test("fresh registry and catalog checks reject stale barcode/SKU, missing publication, changed price, and withdrawn retail approval", async () => {
  for (const field of ["barcode", "sku"] as const) {
    const p = provider();
    p.proof.variants.nodes[0][field] = "CHANGED";
    await assert.rejects(
      p.add(),
      /catalog_mapping_changed_staff_review_required/,
    );
    assert.equal(p.mutations(), 0);
  }
  const missing = provider();
  missing.proof.variants.nodes = [];
  await assert.rejects(missing.add(), /variant_no_longer_published/);
  const price = provider();
  price.proof.variants.nodes[0].price = {
    amount: "13.00",
    currencyCode: "USD",
  };
  await assert.rejects(price.add(), /scan_price_changed_review_required/);
  await db.query(
    "update ns.store_locations set approved_retail=false where id=$1",
    [locationId],
  );
  try {
    await assert.rejects(provider().add(), /approved_retail_location_required/);
  } finally {
    await db.query(
      "update ns.store_locations set approved_retail=true where id=$1",
      [locationId],
    );
  }
});

test("unknown/backordered stock, aggregate split lines and stock changes before add fail without an extra mutation", async () => {
  for (const change of [
    { quantityAvailable: null },
    { quantityAvailable: 0 },
    { currentlyNotInStock: true },
  ]) {
    const p = provider();
    Object.assign(p.proof.variants.nodes[0], change);
    await assert.rejects(p.add(), /quantity_unavailable/);
    assert.equal(p.mutations(), 0);
  }
  const p = provider();
  await p.add();
  await p.add();
  await p.add();
  await assert.rejects(p.add(), /quantity_unavailable/);
  assert.equal(p.mutations(), 3);
  const changed = provider();
  changed.stock(0);
  await assert.rejects(changed.add(), /quantity_unavailable/);
  assert.equal(changed.mutations(), 0);
});

test("sample projections and basket-policy failures never reach a cart mutation", async () => {
  const p = provider(),
    scan = await p.resolve(p.input.code);
  await assert.rejects(
    addScannedLine(
      p.query,
      p.cart.id,
      p.input,
      async () => ({ ...scan, product: { ...scan.product, fixture: true } }),
      async () => {},
    ),
    /sample_cannot_enter_shopify_cart/,
  );
  await assert.rejects(
    addScannedLine(p.query, p.cart.id, p.input, p.resolve, async () => {
      throw Error("break_policy_rejected");
    }),
    /break_policy_rejected/,
  );
  assert.equal(p.mutations(), 0);
});

test("scan request contracts reject identity, cart IDs, raw prices and invalid quantities; review cents are not price-setting authority", () => {
  const input = { action: "scan-add", ...provider().input };
  assert.deepEqual(cartInput(input), input);
  for (const key of [
    "customerId",
    "customerAccessToken",
    "cartId",
    "price",
    "discount",
    "mode",
  ])
    assert.throws(
      () => cartInput({ ...input, [key]: "FORGED" }),
      /unexpected_cart_input/,
    );
  for (const code of ["", 123, "a\n", "a".repeat(2049)])
    assert.throws(
      () => cartInput({ ...input, code }),
      /invalid_scan_cart_input/,
    );
  for (const reviewedPriceCents of [-1, "1200", 1.5, Infinity])
    assert.throws(
      () => cartInput({ ...input, reviewedPriceCents }),
      /invalid_scan_cart_input/,
    );
  for (const quantity of [0, -1, 1.5, "1"])
    assert.throws(() => cartInput({ ...input, quantity }), /invalid_quantity/);
});

test("basketball exception rejects unrelated HTTP adds and keeps public scan-add closed before provider/database access", async () => {
  const previousShop = process.env.SHOPIFY_SHOP;
  const previousVersion = process.env.SHOPIFY_API_VERSION;
  process.env.SHOPIFY_SHOP = SHOP;
  process.env.SHOPIFY_API_VERSION = "2026-07";
  const request = (input: object) =>
    new Request("https://scan-test.invalid/api/commerce/cart", {
      method: "POST",
      headers: {
        origin: "https://scan-test.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
  try {
    const input = provider().input;
    for (const body of [
      { action: "scan-add", ...input },
      { action: "add", variantId: input.variantId, quantity: 1 },
    ]) {
      const response = await POST(request(body));
      assert.equal(response.status, 403);
      assert.equal(
        (await response.json()).error,
        "variant_not_approved_for_sale",
      );
    }
    const approvedScan = await POST(
      request({
        action: "scan-add",
        ...input,
        variantId: approvedBasketballSales[0].variantId,
      }),
    );
    assert.equal(approvedScan.status, 404);
    assert.equal((await approvedScan.json()).error, "not_found");
    const forged = request({ action: "scan-add", ...input });
    forged.headers.set("origin", "https://evil.invalid");
    assert.equal((await POST(forged)).status, 403);
  } finally {
    if (previousShop === undefined) delete process.env.SHOPIFY_SHOP;
    else process.env.SHOPIFY_SHOP = previousShop;
    if (previousVersion === undefined) delete process.env.SHOPIFY_API_VERSION;
    else process.env.SHOPIFY_API_VERSION = previousVersion;
  }
});

test("price change during the final availability lookup requires another review before mutation", async () => {
  const p = provider();
  p.price("13.00");
  await assert.rejects(p.add(), /scan_price_changed_review_required/);
  assert.equal(p.mutations(), 0);
});
