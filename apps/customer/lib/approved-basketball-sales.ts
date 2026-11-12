import { publicFlags } from "./policy.mjs";

// November 10 authorization: exact verified variants only. The Optic candidate
// with a different UPC and the explicitly excluded Prizm Blaster are not approved.
// This public merchandise data is shared by controls and authoritative server checks.
export const approvedBasketballSales = Object.freeze(
  [
    {
      variantId: "gid://shopify/ProductVariant/64521944891761",
      barcode: "746134150968",
      priceCents: 6995,
    },
    {
      variantId: "gid://shopify/ProductVariant/68224325419377",
      barcode: "746134151026",
      priceCents: 21995,
    },
    {
      variantId: "gid://shopify/ProductVariant/64521945022833",
      barcode: "746134172663",
      priceCents: 9995,
    },
    {
      variantId: "gid://shopify/ProductVariant/64521945121137",
      barcode: "746134170294",
      priceCents: 3995,
    },
    {
      variantId: "gid://shopify/ProductVariant/64521956622705",
      barcode: "746134158551",
      priceCents: 4995,
    },
    {
      variantId: "gid://shopify/ProductVariant/64521956655473",
      barcode: "195166245478",
      priceCents: 4995,
    },
  ].map((sale) => Object.freeze(sale)),
);

export function approvedBasketballSale(variantId: string) {
  return approvedBasketballSales.find((sale) => sale.variantId === variantId);
}

export function variantPurchasesEnabled(variantId: string) {
  return publicFlags.purchases || !!approvedBasketballSale(variantId);
}

export const basketballCartEnabled =
  publicFlags.purchases || approvedBasketballSales.length > 0;
