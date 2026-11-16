import type { CatalogProductV1 } from "./catalog";

/** Historical regression identities and the legacy /m QR target, not native catalog eligibility. */
export const NORTHSIDE_NATIVE_SELECTION = Object.freeze(
  [
    [
      "15993233277297",
      "64521944891761",
      "746134150968",
      "2023-24-panini-nba-prizm-hanger-box-regular",
    ],
    [
      "15993233375601",
      "64521945022833",
      "746134172663",
      "2023-24-panini-phoenix-basketball-mega-box-regular",
    ],
    [
      "15993233473905",
      "64521945121137",
      "746134170294",
      "2023-24-panini-select-nba-basketball-hanger-box-regular",
    ],
    [
      "15993234522481",
      "64521956622705",
      "746134158551",
      "2023-24-phoenix-nba-blaster-box-regular",
    ],
    [
      "15993234555249",
      "64521956655473",
      "195166245478",
      "2023-24-prizm-monopoly-nba-blaster-box-regular",
    ],
    [
      "16135959413105",
      "68224325419377",
      "746134151026",
      "2023-24-panini-nba-prizm-mega-box-square-nsk7kic6",
    ],
    [
      "15993268240753",
      "64522039460209",
      "053334437622",
      "2026-upper-deck-allure-golf-hobby-box-regular",
    ],
    [
      "16135959970161",
      "68224353927537",
      "793397728021",
      "2026-fanatics-under-wraps-replica-helmet-full-size-square-mghiqfcx",
    ],
  ].map(([product, variant, barcode, handle]) =>
    Object.freeze({
      id: `gid://shopify/Product/${product}`,
      variantId: `gid://shopify/ProductVariant/${variant}`,
      barcode,
      handle,
    }),
  ),
);

export const NATIVE_SCAN_FORMATS = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "qr",
] as const;
export function validGtin(code: string) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length))
    return false;
  let sum = 0;
  for (
    let i = code.length - 2, weight = 3;
    i >= 0;
    i--, weight = weight === 3 ? 1 : 3
  )
    sum += Number(code[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}
export function expandUpce(code: string) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, a, b, c, d, e, f, check] = code;
  const expanded =
    f <= "2"
      ? ns + a + b + f + "0000" + c + d + e + check
      : f === "3"
        ? ns + a + b + c + "00000" + d + e + check
        : f === "4"
          ? ns + a + b + c + d + "00000" + e + check
          : ns + a + b + c + d + e + "0000" + f + check;
  return validGtin(expanded) ? expanded : null;
}
export function isProductBarcode(value: string) {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/^https?:|:\/\//i.test(value)
  );
}
export function barcodeCandidates(code: string, format?: string) {
  if (format && !(NATIVE_SCAN_FORMATS as readonly string[]).includes(format))
    throw Error("invalid_request");
  if (format === "upc_e") {
    const expanded = expandUpce(code);
    if (!expanded) throw Error("invalid_request");
    return [...new Set([code, expanded, "0" + expanded])];
  }
  const length =
    format === "ean13"
      ? 13
      : format === "ean8"
        ? 8
        : format === "upc_a"
          ? 12
          : null;
  // expo-camera on iOS also emits the already-normalized 12-digit UPC while
  // retaining type ean13. Both forms still require a valid GTIN checksum.
  const normalizedIosUpc = format === "ean13" && code.length === 12;
  if (
    length &&
    ((!normalizedIosUpc && code.length !== length) || !validGtin(code))
  )
    throw Error("invalid_request");
  const codes = [code];
  // A Code 128 ESL can carry a GTIN as text rather than an EAN symbology.
  // Infer only the checksum-valid UPC-A / leading-zero EAN-13 pair.
  // Literal/alphanumeric codes and other leading zeros remain exact.
  const textualGtin = (!format || format === "code128") && validGtin(code);
  if ((format === "ean13" || textualGtin) && /^0\d{12}$/.test(code))
    codes.push(code.slice(1));
  if (
    (format === "upc_a" || normalizedIosUpc || textualGtin) &&
    /^\d{12}$/.test(code)
  )
    codes.push("0" + code);
  return codes;
}

/** Fresh public DTOs form an indexed exact match; never search/fetch a scanned URL. */
export function matchCatalogScan(
  products: readonly CatalogProductV1[],
  code: string,
  format?: string,
) {
  if (
    !code ||
    code.length > 2048 ||
    code !== code.trim() ||
    /[\u0000-\u001f\u007f]/.test(code)
  )
    throw Error("invalid_request");
  if (format && !(NATIVE_SCAN_FORMATS as readonly string[]).includes(format))
    throw Error("invalid_request");
  let matched: { product: CatalogProductV1; variantId: string }[] = [];
  // Existing November 10 Monopoly ESL label. Resolve locally against fresh
  // approved data; never follow a scanned URL or guess a redirect destination.
  if (code === "https://9i3hnb-jw.myshopify.com/m") {
    const expected = NORTHSIDE_NATIVE_SELECTION.find(
      (p) => p.variantId === "gid://shopify/ProductVariant/64521956655473",
    );
    if (!expected) throw Error("not_found");
    for (const product of products)
      if (
        product.id === expected.id &&
        product.handle === expected.handle &&
        product.publication === "published"
      )
        for (const v of product.variants.nodes)
          if (
            v.id === expected.variantId &&
            v.productId === expected.id &&
            v.identifiers.barcode === expected.barcode
          )
            matched.push({ product, variantId: v.id });
  } else if (/^https?:/i.test(code) || format === "qr") {
    let url: URL;
    try {
      url = new URL(code);
    } catch {
      throw Error("invalid_request");
    }
    if (
      url.origin !== "https://9i3hnb-jw.myshopify.com" ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/products\/[a-z0-9][a-z0-9-]{0,149}$/.test(url.pathname) ||
      [...url.searchParams.keys()].some((k) => k !== "variant") ||
      url.searchParams.getAll("variant").length > 1
    )
      throw Error("unsupported_qr");
    const selected = url.searchParams.get("variant");
    if (selected !== null && !/^[1-9][0-9]{0,29}$/.test(selected))
      throw Error("invalid_request");
    for (const product of products.filter(
      (p) => p.handle === url.pathname.slice(10),
    ))
      for (const v of product.variants.nodes)
        if (
          (!selected &&
            product.variants.nodes.length === 1 &&
            product.variants.after === null &&
            !product.variants.pageInfo.hasNextPage) ||
          v.id === `gid://shopify/ProductVariant/${selected}`
        )
          matched.push({ product, variantId: v.id });
  } else {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._$%+\/-]{0,63}$/.test(code))
      throw Error("invalid_request");
    const index = new Map<string, typeof matched>();
    for (const product of products)
      for (const v of product.variants.nodes) {
        // A SKU is inventory metadata, never an implicit barcode alias.
        for (const key of v.identifiers.barcode ? [v.identifiers.barcode] : [])
          index.set(key, [
            ...(index.get(key) ?? []),
            { product, variantId: v.id },
          ]);
      }
    matched = barcodeCandidates(code, format).flatMap(
      (c) => index.get(c) ?? [],
    );
  }
  const identities = new Map(matched.map((m) => [m.variantId, m]));
  if (identities.size !== 1)
    throw Error(identities.size ? "ambiguous_scan" : "not_found");
  const match = [...identities.values()][0];
  return { ...match.product, selectedVariantId: match.variantId };
}
