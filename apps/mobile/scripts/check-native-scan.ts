import {
  PublicCatalogApi,
  PREVIEW_CATALOG_SELECTION,
} from "../src/api/public-catalog";

async function main() {
  const api = new PublicCatalogApi();
  const results = [];
  for (const p of PREVIEW_CATALOG_SELECTION) {
    const detail = await api.scan(p.barcode, undefined, p.barcode.length === 12 ? "upc_a" : "code128");
    if (detail.product.selectedVariantId !== p.variantId)
      throw Error("scan_mismatch");
    const sku = detail.product.variants.nodes[0].identifiers.sku;
    if (
      !sku ||
      (await api.scan(sku, undefined, "code128")).product.selectedVariantId !==
        p.variantId
    )
      throw Error("sku_mismatch");
    results.push({
      productId: p.id,
      variantId: p.variantId,
      barcodeMatched: true,
      skuMatched: true,
      image: !!detail.product.featuredImage,
    });
  }
  const first = PREVIEW_CATALOG_SELECTION[0];
  const alias = await api.scan("0" + first.barcode, undefined, "ean13");
  const qr = await api.scan(
    `https://9i3hnb-jw.myshopify.com/products/${first.handle}`,
    undefined,
    "qr",
  );
  if (
    alias.product.selectedVariantId !== first.variantId ||
    qr.product.selectedVariantId !== first.variantId
  )
    throw Error("scan_mismatch");
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        results,
        iosEanAliasMatched: true,
        approvedProductQrMatched: true,
        cartMutationsPerformed: false,
        physicalDeviceTested: false,
      },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error(
    "Live scan read validation failed; no cart or inventory writes performed.",
  );
  process.exitCode = 1;
});
