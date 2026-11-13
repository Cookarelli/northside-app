import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedNativeProducts,
  approvedNativeScan,
  nativeRetailQuantity,
} from "../lib/server/mobile/approved-native-catalog";
import { NORTHSIDE_NATIVE_SELECTION } from "../../../packages/customer-contracts/src/native-scan";
import type { Query } from "../lib/server/storefront";

function payload() {
  return {
    nodes: NORTHSIDE_NATIVE_SELECTION.map((p, i) => ({
      id: p.id,
      handle: p.handle,
      title:
        i === 6 ? "2026 Upper Deck Golf Hobby Box" : `SYNTHETIC product ${i}`,
      description: "",
      productType: "Cards",
      publishedAt: "2026-11-10T00:00:00Z",
      availableForSale: true,
      featuredImage: null,
      priceRange: {
        minVariantPrice: { amount: "219.95", currencyCode: "USD" },
      },
      variants: {
        nodes: [
          {
            id: p.variantId,
            title: "Default Title",
            sku: i === 6 ? "92840090001065" : `SKU-${i}`,
            barcode: p.barcode,
            availableForSale: true,
            currentlyNotInStock: false,
            price: { amount: "219.95", currencyCode: "USD" },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    })),
  };
}
function query(data: ReturnType<typeof payload>): Query {
  return async <T>() => structuredClone(data) as T;
}
test("verified helmet and six Panini identities resolve through the unchanged approved backend contract", async () => {
  const data = payload(),
    q = query(data),
    h = NORTHSIDE_NATIVE_SELECTION[7];
  assert.equal(h.id, "gid://shopify/Product/16135959970161");
  for (const p of [...NORTHSIDE_NATIVE_SELECTION.slice(0, 6), h])
    for (const [code, format] of [
      [p.barcode, "upc_a"],
      [p.barcode, "ean13"],
      ["0" + p.barcode, "ean13"],
      ["0" + p.barcode, "code128"],
      [p.barcode, undefined],
    ] as const) {
      const r = await approvedNativeScan(code, format, q);
      assert.equal(r.product.id, p.id);
      assert.equal(r.product.selectedVariantId, p.variantId);
    }
  data.nodes[7].variants.nodes[0].sku = h.barcode;
  data.nodes[7].variants.nodes[0].barcode = "OTHER-HELMET-BARCODE";
  await assert.rejects(approvedNativeScan(h.barcode, "code128", query(data)), {
    code: "not_found",
  });
  await assert.rejects(
    approvedNativeScan("OTHER-HELMET-BARCODE", "code128", query(data)),
    { code: "invalid_provider_data" },
  );
});
test("helmet approval does not weaken Retail Floor, SKU, tracked inventory or product identity checks", async () => {
  const h = NORTHSIDE_NATIVE_SELECTION[7];
  const state = () => ({
    productVariant: {
      id: h.variantId,
      product: { id: h.id, status: "ACTIVE" },
      inventoryItem: {
        tracked: true,
        sku: "793397728021",
        inventoryLevels: {
          nodes: [
            {
              location: {
                id: "gid://shopify/Location/121087263089",
                name: "Northside Retail Floor",
                isActive: true,
              },
              quantities: [{ name: "available", quantity: 99 }],
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    },
  });
  const q =
    (value: ReturnType<typeof state>): Query =>
    async <T>() =>
      structuredClone(value) as T;
  assert.equal(
    await nativeRetailQuantity(h.variantId, "793397728021", q(state())),
    99,
  );
  for (const change of [
    (s: ReturnType<typeof state>) => {
      s.productVariant.product.id = "gid://shopify/Product/999";
    },
    (s: ReturnType<typeof state>) => {
      s.productVariant.inventoryItem.tracked = false;
    },
    (s: ReturnType<typeof state>) => {
      s.productVariant.inventoryItem.sku = "WRONG";
    },
    (s: ReturnType<typeof state>) => {
      s.productVariant.inventoryItem.inventoryLevels.nodes[0].location.isActive = false;
    },
    (s: ReturnType<typeof state>) => {
      s.productVariant.inventoryItem.inventoryLevels.pageInfo.hasNextPage = true;
    },
  ]) {
    const s = state();
    change(s);
    await assert.rejects(
      nativeRetailQuantity(h.variantId, "793397728021", q(s)),
      { code: "invalid_provider_data" },
    );
  }
  const zero = state();
  zero.productVariant.inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity = 0;
  assert.equal(
    await nativeRetailQuantity(h.variantId, "793397728021", q(zero)),
    0,
  );
});
test("a separate Golf barcode change cannot take down valid Prizm scans", async () => {
  const data = payload();
  data.nodes[6].variants.nodes[0].barcode = "CHANGED-GOLF";
  const q = query(data);
  const result = await approvedNativeScan("746134151026", "code128", q);
  assert.equal(result.product.id, "gid://shopify/Product/16135959413105");
  assert.equal(
    result.product.selectedVariantId,
    "gid://shopify/ProductVariant/68224325419377",
  );
  assert.equal((await approvedNativeProducts(q)).length, 7);
  for (const code of [
    "CHANGED-GOLF",
    `https://9i3hnb-jw.myshopify.com/products/${data.nodes[6].handle}`,
  ])
    await assert.rejects(approvedNativeScan(code, undefined, q), {
      code: "invalid_provider_data",
    });
});
test("quarantined live barcode collisions reject ambiguity and SKUs are not aliases", async () => {
  for (const field of ["barcode", "sku"] as const) {
    const data = payload();
    data.nodes[6].variants.nodes[0].barcode = "CHANGED-GOLF";
    data.nodes[6].variants.nodes[0][field] = "746134151026";
    if (field === "barcode")
      await assert.rejects(
        approvedNativeScan("746134151026", undefined, query(data)),
        { code: "ambiguous_scan" },
      );
    else
      assert.equal(
        (await approvedNativeScan("746134151026", undefined, query(data)))
          .product.selectedVariantId,
        NORTHSIDE_NATIVE_SELECTION[5].variantId,
      );
  }
});
test("all approved UPCs and exact shelf QRs resolve stable variant IDs", async () => {
  const q = query(payload());
  for (const p of NORTHSIDE_NATIVE_SELECTION) {
    const result = await approvedNativeScan(p.barcode, "upc_a", q);
    assert.equal(result.product.id, p.id);
    assert.equal(result.product.selectedVariantId, p.variantId);
  }
  const golf = NORTHSIDE_NATIVE_SELECTION[6];
  for (const code of [
    `https://9i3hnb-jw.myshopify.com/products/${golf.handle}`,
    `https://9i3hnb-jw.myshopify.com/products/${NORTHSIDE_NATIVE_SELECTION[5].handle}`,
  ]) {
    const result = await approvedNativeScan(code, undefined, q);
    assert.equal(
      result.product.selectedVariantId,
      code.includes("prizm-mega")
        ? NORTHSIDE_NATIVE_SELECTION[5].variantId
        : golf.variantId,
    );
  }
  await assert.rejects(approvedNativeScan("92840090001065", "code128", q), {
    code: "not_found",
  });
  const normalized = await approvedNativeScan("0053334437622", "ean13", q);
  assert.equal(
    normalized.product.variants.nodes[0].identifiers.barcode,
    "053334437622",
  );
  for (const code of [
    "53334437622",
    "8003147387",
    "unapproved",
    `https://9i3hnb-jw.myshopify.com/products/${golf.handle}?variant=999`,
  ])
    await assert.rejects(approvedNativeScan(code, undefined, q), {
      code: "not_found",
    });
  await assert.rejects(
    approvedNativeScan("https://evil.example/products/x", "qr", q),
    { code: "unsupported_qr" },
  );
});
test("identity, publication, complete variants, price and availability validation remain enforced", async () => {
  for (const mutate of [
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].id = "gid://shopify/Product/999";
    },
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].handle = "wrong-handle";
    },
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].variants.nodes[0].id = "gid://shopify/ProductVariant/999";
    },
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].variants.pageInfo.hasNextPage = true;
    },
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].publishedAt = "";
    },
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].variants.nodes[0].price.currencyCode = "CAD";
    },
    (d: ReturnType<typeof payload>) => {
      d.nodes[5].variants.nodes[0].price.amount = "NaN";
    },
  ])
    await assert.rejects(
      approvedNativeScan(
        "746134151026",
        undefined,
        query(
          (() => {
            const d = payload();
            mutate(d);
            return d;
          })(),
        ),
      ),
    );
  const data = payload();
  data.nodes[5].variants.nodes[0].availableForSale = false;
  assert.equal(
    (await approvedNativeScan("746134151026", undefined, query(data))).product
      .variants.nodes[0].availability.state,
    "unavailable",
  );
});
