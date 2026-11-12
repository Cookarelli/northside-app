import {
  PublicCatalogApi,
  PUBLIC_CATALOG_ENDPOINT,
  PREVIEW_CATALOG_SELECTION,
} from "../src/api/public-catalog";

// Read-only live integration check. No credentials, inventory writes or fixtures.
async function main() {
  try {
    const api = new PublicCatalogApi();
    const page = await api.catalog();
    const details = await Promise.all(
      page.products.map((p) => api.product(p.handle)),
    );
    console.log(
      JSON.stringify(
        {
          checkedAt: page.observedAt,
          endpoint: PUBLIC_CATALOG_ENDPOINT,
          products: details.map(({ product: p }) => ({
            id: p.id,
            handle: p.handle,
            title: p.title,
            image: !!p.featuredImage,
            price: p.minVariantPrice,
            availableForSale: p.availableForSale,
            variantId: p.variants.nodes[0].id,
            locationQuantity:
              p.variants.nodes[0].availability.quantityAvailable,
          })),
          physicalDeviceTested: false,
        },
        null,
        2,
      ),
    );
    if (page.products.length !== PREVIEW_CATALOG_SELECTION.length)
      throw new Error("Expected every approved pilot product to be publicly visible.");
  } catch {
    console.error(
      "Live catalog validation failed. No fixture fallback or store changes were made.",
    );
    process.exitCode = 1;
  }
}
void main();
