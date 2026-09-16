import "server-only";
import type {
  Browse,
  Cart,
  CartView,
  Connection,
  Merchandise,
  Variant,
} from "../commerce";
import { AccessError, hashToken } from "./security";
import {
  commerceConfig,
  required,
  graphql,
  gid,
  cursor,
  cents,
} from "./shopify-config";
export type Query = <T>(query: string, variables: object) => Promise<T>;
const PAGE = "pageInfo { hasNextPage endCursor }";
const MONEY = "amount currencyCode";
const VARIANT = `id title availableForSale quantityAvailable currentlyNotInStock price { ${MONEY} }`;
const PRODUCT = `id handle title description productType availableForSale featuredImage { url altText } priceRange { minVariantPrice { ${MONEY} } } variants(first: 1) { nodes { ${VARIANT} } ${PAGE} }`;
const CART = `id totalQuantity discountCodes { code applicable } cost { subtotalAmount { ${MONEY} } totalAmount { ${MONEY} } totalAmountEstimated } lines(first: 100) { ${PAGE} nodes { id quantity cost { totalAmount { ${MONEY} } } merchandise { ... on ProductVariant { ${VARIANT} product { title handle } } } } }`;
export function storefront(ip?: string): Query {
  const { shop, version } = commerceConfig();
  const token = required("SHOPIFY_STOREFRONT_PRIVATE_TOKEN");
  return (query, variables) =>
    graphql(
      `https://${shop}/api/${version}/graphql.json`,
      {
        "Shopify-Storefront-Private-Token": token,
        ...(ip ? { "Shopify-Storefront-Buyer-IP": ip } : {}),
      },
      query,
      variables,
    );
}
function textFilter(s: string) {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
export async function browse(query: Query, input: Browse) {
  if (
    (input.q?.length || 0) > 100 ||
    (input.category?.length || 0) > 80 ||
    (input.collection && !/^[a-z0-9-]{1,150}$/.test(input.collection))
  )
    throw new AccessError(400, "invalid_filter");
  const collections = await query<{
    collections: Connection<{ handle: string; title: string }>;
  }>(
    `query Collections($after: String) { collections(first: 12, after: $after) { nodes { handle title } ${PAGE} } }`,
    { after: cursor(input.collectionsAfter) },
  );
  let products: Connection<Merchandise>;
  if (input.collection && !input.q) {
    const result = await query<{
      collection: { products: Connection<Merchandise> } | null;
    }>(
      `query Collection($handle: String!, $after: String, $filters: [ProductFilter!]) { collection(handle: $handle) { products(first: 12, after: $after, filters: $filters) { nodes { ${PRODUCT} } ${PAGE} } } }`,
      {
        handle: input.collection,
        after: cursor(input.after),
        filters: input.category ? [{ productType: input.category }] : [],
      },
    );
    if (!result.collection)
      throw new AccessError(404, "collection_unavailable");
    products = result.collection.products;
  } else {
    const filter = [
      input.q ? textFilter(input.q) : "",
      input.category ? `product_type:${textFilter(input.category)}` : "",
    ]
      .filter(Boolean)
      .join(" AND ");
    products = (
      await query<{ products: Connection<Merchandise> }>(
        `query Products($query: String, $after: String) { products(first: 12, after: $after, query: $query, sortKey: TITLE) { nodes { ${PRODUCT} } ${PAGE} } }`,
        { query: filter, after: cursor(input.after) },
      )
    ).products;
  }
  products.nodes.forEach((p) => cents(p.priceRange.minVariantPrice));
  return { products, collections: collections.collections };
}
export async function product(query: Query, handle: string, after?: string) {
  if (!/^[a-z0-9-]{1,150}$/.test(handle))
    throw new AccessError(404, "product_unavailable");
  const result = await query<{ product: Merchandise | null }>(
    `query Product($handle: String!, $after: String) { product(handle: $handle) { id handle title description productType availableForSale featuredImage { url altText } priceRange { minVariantPrice { ${MONEY} } } variants(first: 100, after: $after) { nodes { ${VARIANT} } ${PAGE} } } }`,
    { handle, after: cursor(after) },
  );
  if (result.product)
    result.product.variants.nodes.forEach((v) => cents(v.price));
  return result.product;
}
export function quantity(n: unknown, allowZero = false): number {
  if (
    typeof n !== "number" ||
    !Number.isInteger(n) ||
    n < (allowZero ? 0 : 1) ||
    n > 99
  )
    throw new AccessError(400, "invalid_quantity");
  return n;
}
export function checkAvailable(v: Variant | null, n: number) {
  // Unknown quantity and backorder-only stock fail closed for this finite collectible catalog.
  if (
    !v?.availableForSale ||
    v.currentlyNotInStock ||
    v.quantityAvailable === null ||
    v.quantityAvailable < n
  )
    throw new AccessError(409, "quantity_unavailable");
  cents(v.price);
}
export async function available(query: Query, id: string, n: number) {
  const v = (
    await query<{ node: Variant | null }>(
      `query Availability($id: ID!) { node(id: $id) { ... on ProductVariant { ${VARIANT} } } }`,
      { id: gid(id, "ProductVariant") },
    )
  ).node;
  checkAvailable(v, quantity(n));
}
function validCart(cart: Cart | null): Cart {
  if (!cart) throw new AccessError(409, "cart_expired");
  if (cart.lines.pageInfo.hasNextPage || cart.lines.nodes.length > 99)
    throw new AccessError(409, "cart_too_large");
  cents(cart.cost.totalAmount);
  cents(cart.cost.subtotalAmount);
  return cart;
}
export function cartView(cart: Cart): CartView {
  return {
    lines: {
      ...cart.lines,
      nodes: cart.lines.nodes.map((l) => ({ ...l, id: hashToken(l.id) })),
    },
    totalQuantity: cart.totalQuantity,
    cost: cart.cost,
    discountCodes: cart.discountCodes,
  };
}
export async function readCart(query: Query, id: string, checkout = false) {
  return validCart(
    (
      await query<{ cart: Cart | null }>(
        `query Cart($id: ID!) { cart(id: $id) { ${CART} ${checkout ? "checkoutUrl" : ""} } }`,
        { id },
      )
    ).cart,
  );
}
async function mutate(
  query: Query,
  operation: string,
  declarations: string,
  args: string,
  variables: object,
) {
  const response = await query<
    Record<
      string,
      {
        cart: Cart | null;
        userErrors: { code?: string }[];
        warnings: { code: string }[];
      }
    >
  >(
    `mutation ${operation}(${declarations}) { ${operation}(${args}) { cart { ${CART} } userErrors { code } warnings { code } } }`,
    variables,
  );
  const result = response[operation];
  if (!result || result.userErrors.length || result.warnings.length)
    throw new AccessError(409, "cart_changed_review_required");
  return validCart(result.cart);
}
export async function createCart(query: Query, customerToken?: string) {
  return mutate(query, "cartCreate", "$input: CartInput!", "input: $input", {
    input: {
      buyerIdentity: {
        countryCode: "US",
        ...(customerToken ? { customerAccessToken: customerToken } : {}),
      },
    },
  });
}
export async function updateBuyer(
  query: Query,
  id: string,
  customerToken?: string,
) {
  return mutate(
    query,
    "cartBuyerIdentityUpdate",
    "$id: ID!, $buyer: CartBuyerIdentityInput!",
    "cartId: $id, buyerIdentity: $buyer",
    {
      id,
      buyer: { countryCode: "US", customerAccessToken: customerToken || null },
    },
  );
}
export async function applyDiscount(
  query: Query,
  id: string,
  code: string,
  customerToken: string,
) {
  if (!customerToken || !/^NS[A-F0-9]{40}$/.test(code))
    throw new AccessError(403, "owned_reward_required");
  const current = await readCart(query, id);
  if (
    current.discountCodes.some(
      (d) => d.applicable && d.code.toUpperCase() !== code,
    )
  )
    throw new AccessError(409, "review_existing_cart_discounts");
  await updateBuyer(query, id, customerToken);
  const cart = await mutate(
    query,
    "cartDiscountCodesUpdate",
    "$id: ID!, $codes: [String!]!",
    "cartId: $id, discountCodes: $codes",
    { id, codes: [code] },
  );
  return {
    cart: cartView(cart),
    applicable:
      cart.discountCodes.find((d) => d.code.toUpperCase() === code)
        ?.applicable === true,
  };
}
export async function addLine(
  query: Query,
  cartId: string,
  variantId: string,
  n: number,
) {
  quantity(n);
  gid(variantId, "ProductVariant");
  const cart = await readCart(query, cartId);
  const existing = cart.lines.nodes
    .filter((l) => l.merchandise.id === variantId)
    .reduce((s, l) => s + l.quantity, 0);
  await available(query, variantId, quantity(existing + n));
  return mutate(
    query,
    "cartLinesAdd",
    "$id: ID!, $lines: [CartLineInput!]!",
    "cartId: $id, lines: $lines",
    { id: cartId, lines: [{ merchandiseId: variantId, quantity: n }] },
  );
}
export async function updateLine(
  query: Query,
  cartId: string,
  lineId: string,
  n: number,
) {
  quantity(n, true);
  const cart = await readCart(query, cartId),
    line = cart.lines.nodes.find((l) => hashToken(l.id) === lineId);
  if (!line) throw new AccessError(404, "cart_line_unavailable");
  if (!n)
    return mutate(
      query,
      "cartLinesRemove",
      "$id: ID!, $lines: [ID!]!",
      "cartId: $id, lineIds: $lines",
      { id: cartId, lines: [line.id] },
    );
  const other = cart.lines.nodes
    .filter((l) => l.id !== line.id && l.merchandise.id === line.merchandise.id)
    .reduce((s, l) => s + l.quantity, 0);
  await available(query, line.merchandise.id, quantity(other + n));
  return mutate(
    query,
    "cartLinesUpdate",
    "$id: ID!, $lines: [CartLineUpdateInput!]!",
    "cartId: $id, lines: $lines",
    { id: cartId, lines: [{ id: line.id, quantity: n }] },
  );
}
export async function checkout(
  query: Query,
  cartId: string,
  customerToken?: string,
) {
  const cart = await updateBuyer(query, cartId, customerToken);
  if (!cart.lines.nodes.length) throw new AccessError(409, "cart_empty");
  const amounts = new Map<string, number>();
  for (const l of cart.lines.nodes)
    amounts.set(
      l.merchandise.id,
      (amounts.get(l.merchandise.id) || 0) + l.quantity,
    );
  for (const [id, n] of amounts) await available(query, id, n);
  const fresh = await readCart(query, cartId, true);
  if (
    JSON.stringify(fresh.cost) !== JSON.stringify(cart.cost) ||
    JSON.stringify(fresh.lines) !== JSON.stringify(cart.lines)
  )
    throw new AccessError(409, "cart_changed_review_required");
  const url = new URL(fresh.checkoutUrl || "https://invalid.invalid");
  const allowed = [
    commerceConfig().shop,
    "shopify.com",
    ...(process.env.SHOPIFY_CHECKOUT_HOSTS || "").split(",").filter(Boolean),
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowed.includes(url.hostname)
  )
    throw new AccessError(503, "checkout_destination_unverified");
  return url.toString();
}
export async function cartCampaigns(
  query: Query,
  id: string,
  first?: string,
  last?: string,
) {
  const attributes = [
    { key: "ns_first_campaign", value: first || "" },
    { key: "ns_last_campaign", value: last || "" },
  ];
  return mutate(
    query,
    "cartAttributesUpdate",
    "$id: ID!, $attributes: [AttributeInput!]!",
    "cartId: $id, attributes: $attributes",
    { id, attributes },
  );
}
