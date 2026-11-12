import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedNativeProducts,
  approvedNativeScan,
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
  assert.equal((await approvedNativeProducts(q)).length, 6);
  for (const code of [
    "CHANGED-GOLF",
    "92840090001065",
    `https://9i3hnb-jw.myshopify.com/products/${data.nodes[6].handle}`,
  ])
    await assert.rejects(approvedNativeScan(code, undefined, q), {
      code: "invalid_provider_data",
    });
});
test("quarantined live barcode/SKU collisions still reject ambiguity", async () => {
  for (const field of ["barcode", "sku"] as const) {
    const data = payload();
    data.nodes[6].variants.nodes[0].barcode = "CHANGED-GOLF";
    data.nodes[6].variants.nodes[0][field] = "746134151026";
    await assert.rejects(
      approvedNativeScan("746134151026", undefined, query(data)),
      { code: "ambiguous_scan" },
    );
  }
});
test("all approved UPCs, retained Golf SKU and exact shelf QRs resolve stable variant IDs", async () => {
  const q = query(payload());
  for (const p of NORTHSIDE_NATIVE_SELECTION) {
    const result = await approvedNativeScan(p.barcode, "upc_a", q);
    assert.equal(result.product.id, p.id);
    assert.equal(result.product.selectedVariantId, p.variantId);
  }
  const golf = NORTHSIDE_NATIVE_SELECTION[6];
  for (const code of [
    "92840090001065",
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
