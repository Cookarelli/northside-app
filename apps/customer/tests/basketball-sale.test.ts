import test from "node:test";
import assert from "node:assert/strict";
import { publicFlags } from "../lib/policy.mjs";
import {
  approvedBasketballSales,
  approvedBasketballSale,
  variantPurchasesEnabled,
} from "../lib/approved-basketball-sales";
import { basketballSalePolicy } from "../lib/server/basketball-sale-policy";
import {
  addLine,
  updateLine,
  checkout,
  createCart,
  readCart,
  type Query,
} from "../lib/server/storefront";
import type { Cart, Variant } from "../lib/commerce";
import { hashToken } from "../lib/server/security";
import { SHOP } from "../lib/server/providers";

// Isolated provider fixture. Never connects to Shopify, reserves inventory,
// creates an order, or touches the hosted operational database.
const outsider = "gid://shopify/ProductVariant/99999999999999";
const heldOptic = "gid://shopify/ProductVariant/64521944826225";
const selected = approvedBasketballSales[0].variantId;
const pageInfo = { hasNextPage: false, endCursor: null };
const money = (value: number) => ({
  amount: (value / 100).toFixed(2),
  currencyCode: "USD",
});
function variant(id: string, priceCents?: number): Variant {
  return {
    id,
    title: "SAMPLE isolated variant",
    availableForSale: true,
    quantityAvailable: 30,
    currentlyNotInStock: false,
    price: money(priceCents ?? approvedBasketballSale(id)?.priceCents ?? 1000),
  };
}
function cartFor(lines: { id: string; quantity: number }[]): Cart {
  const subtotal = lines.reduce(
    (n, line) =>
      n + (approvedBasketballSale(line.id)?.priceCents ?? 1000) * line.quantity,
    0,
  );
  return {
    id: "gid://shopify/Cart/SAMPLE_BASKETBALL_ONLY?key=SAMPLE_SECRET",
    checkoutUrl: `https://${SHOP}/checkouts/SAMPLE_BASKETBALL_ONLY`,
    totalQuantity: lines.reduce((n, line) => n + line.quantity, 0),
    cost: {
      subtotalAmount: money(subtotal),
      totalAmount: money(subtotal),
      totalAmountEstimated: true,
    },
    discountCodes: [],
    lines: {
      pageInfo,
      nodes: lines.map((line, index) => ({
        id: "SAMPLE-line-" + index,
        quantity: line.quantity,
        merchandise: {
          ...variant(line.id),
          product: {
            title: "SAMPLE isolated merchandise",
            handle: "sample-isolated-merchandise",
          },
        },
        cost: {
          totalAmount: money(
            (approvedBasketballSale(line.id)?.priceCents ?? 1000) *
              line.quantity,
          ),
        },
      })),
    },
  };
}
function provider(
  initial: { id: string; quantity: number }[] = [],
  options: {
    lateOutsider?: boolean;
    latePrice?: boolean;
    availabilityPrice?: number;
    stock?: number;
    createOutsider?: boolean;
  } = {},
) {
  let state = cartFor(initial);
  const calls: { document: string; variables: Record<string, unknown> }[] = [];
  const query: Query = async <T>(document: string, value: object) => {
    const variables = value as Record<string, unknown>;
    calls.push({ document, variables });
    if (document.startsWith("query Availability")) {
      const stock = variant(String(variables.id), options.availabilityPrice);
      stock.quantityAvailable = options.stock ?? 30;
      return { node: stock } as T;
    }
    if (document.startsWith("query Cart")) {
      if (document.includes("checkoutUrl")) {
        if (options.lateOutsider)
          return {
            cart: cartFor([
              ...state.lines.nodes.map((line) => ({
                id: line.merchandise.id,
                quantity: line.quantity,
              })),
              { id: outsider, quantity: 1 },
            ]),
          } as T;
        if (options.latePrice) {
          const changed = structuredClone(state);
          changed.lines.nodes[0].merchandise.price = money(7095);
          return { cart: changed } as T;
        }
      }
      return { cart: structuredClone(state) } as T;
    }
    const operation = document.match(/^mutation (\w+)/)?.[1];
    const lines = () =>
      state.lines.nodes.map((line) => ({
        id: line.merchandise.id,
        quantity: line.quantity,
      }));
    switch (operation) {
      case "cartCreate":
        state = cartFor(
          options.createOutsider ? [{ id: outsider, quantity: 1 }] : [],
        );
        break;
      case "cartLinesAdd": {
        const additions = variables.lines as {
          merchandiseId: string;
          quantity: number;
        }[];
        state = cartFor([
          ...lines(),
          ...additions.map((line) => ({
            id: line.merchandiseId,
            quantity: line.quantity,
          })),
        ]);
        break;
      }
      case "cartLinesUpdate": {
        const updates = variables.lines as { id: string; quantity: number }[];
        const update = updates[0];
        state = cartFor(
          state.lines.nodes.map((line) => ({
            id: line.merchandise.id,
            quantity: line.id === update.id ? update.quantity : line.quantity,
          })),
        );
        break;
      }
      case "cartLinesRemove": {
        const removals = variables.lines as string[];
        state = cartFor(
          state.lines.nodes
            .filter((line) => !removals.includes(line.id))
            .map((line) => ({
              id: line.merchandise.id,
              quantity: line.quantity,
            })),
        );
        break;
      }
      case "cartBuyerIdentityUpdate":
        break;
      default:
        throw Error("Unexpected provider operation in SAMPLE fixture");
    }
    return {
      [operation!]: {
        cart: structuredClone(state),
        userErrors: [],
        warnings: [],
      },
    } as T;
  };
  return {
    query,
    calls,
    get cart() {
      return structuredClone(state);
    },
  };
}
const writes = (p: ReturnType<typeof provider>) =>
  p.calls.filter((call) => call.document.startsWith("mutation"));

test("six exact variant exception preserves every global activation flag and excludes held/other merchandise", () => {
  assert.ok(Object.values(publicFlags).every((flag) => flag === false));
  assert.equal(approvedBasketballSales.length, 6);
  assert.equal(
    new Set(approvedBasketballSales.map((sale) => sale.variantId)).size,
    6,
  );
  assert.equal(
    approvedBasketballSales.reduce((n, sale) => n + sale.priceCents, 0),
    52970,
  );
  for (const sale of approvedBasketballSales) {
    assert.equal(variantPurchasesEnabled(sale.variantId), true);
    assert.doesNotThrow(() =>
      basketballSalePolicy.assertVariant(sale.variantId),
    );
  }
  for (const id of [
    heldOptic,
    outsider,
    "",
    "gid://shopify/Product/64521944891761",
  ]) {
    assert.equal(variantPurchasesEnabled(id), false);
    assert.throws(
      () => basketballSalePolicy.assertVariant(id),
      /variant_not_approved_for_sale/,
    );
  }
});

test("unapproved and held add IDs reject before any provider call or cart creation", async () => {
  for (const id of [heldOptic, outsider]) {
    const p = provider();
    await assert.rejects(
      addLine(p.query, p.cart.id, id, 1, undefined, basketballSalePolicy),
      /variant_not_approved_for_sale/,
    );
    assert.equal(p.calls.length, 0);
  }
});

test("GET validates all actual cart lines; a mixed cart never becomes an approved cart", async () => {
  const p = provider([
    { id: selected, quantity: 1 },
    { id: outsider, quantity: 1 },
  ]);
  await assert.rejects(
    readCart(p.query, p.cart.id, false, basketballSalePolicy),
    /variant_not_approved_for_sale/,
  );
  assert.equal(writes(p).length, 0);
});

test("new empty guest cart is accepted, but unexpected foreign merchandise in create response is rejected", async () => {
  const empty = provider();
  assert.equal(
    (await createCart(empty.query, undefined, basketballSalePolicy))
      .totalQuantity,
    0,
  );
  const foreign = provider([], { createOutsider: true });
  await assert.rejects(
    createCart(foreign.query, undefined, basketballSalePolicy),
    /variant_not_approved_for_sale/,
  );
});

test("approved add, quantity edit and removal use existing Shopify cart operations without reserving stock", async () => {
  const p = provider();
  const added = await addLine(
    p.query,
    p.cart.id,
    selected,
    1,
    undefined,
    basketballSalePolicy,
  );
  assert.equal(added.totalQuantity, 1);
  const edited = await updateLine(
    p.query,
    p.cart.id,
    hashToken(added.lines.nodes[0].id),
    2,
    basketballSalePolicy,
  );
  assert.equal(edited.totalQuantity, 2);
  const removed = await updateLine(
    p.query,
    p.cart.id,
    hashToken(edited.lines.nodes[0].id),
    0,
    basketballSalePolicy,
  );
  assert.equal(removed.totalQuantity, 0);
  assert.deepEqual(
    writes(p).map((call) => call.document.match(/^mutation (\w+)/)?.[1]),
    ["cartLinesAdd", "cartLinesUpdate", "cartLinesRemove"],
  );
  assert.ok(
    !p.calls.some((call) =>
      /inventory|orderCreate|draftOrder|payment|reserve/i.test(call.document),
    ),
  );
});

test("mixed-cart update and zero-quantity removal are denied before provider writes", async () => {
  for (const n of [0, 2]) {
    const p = provider([
      { id: selected, quantity: 1 },
      { id: outsider, quantity: 1 },
    ]);
    await assert.rejects(
      updateLine(
        p.query,
        p.cart.id,
        hashToken(p.cart.lines.nodes[0].id),
        n,
        basketballSalePolicy,
      ),
      /variant_not_approved_for_sale/,
    );
    assert.equal(writes(p).length, 0);
  }
});

test("approved add still rejects fresh stock depletion and a changed provider price before mutation", async () => {
  for (const options of [{ stock: 0 }, { availabilityPrice: 7095 }]) {
    const p = provider([], options);
    await assert.rejects(
      addLine(p.query, p.cart.id, selected, 1, undefined, basketballSalePolicy),
      /quantity_unavailable|scan_price_changed_review_required/,
    );
    assert.equal(writes(p).length, 0);
  }
});

test("all six approved products retain their actual one-each subtotal through checkout handoff without a paid order", async () => {
  const p = provider(
    approvedBasketballSales.map((sale) => ({
      id: sale.variantId,
      quantity: 1,
    })),
  );
  const cart = await readCart(p.query, p.cart.id, false, basketballSalePolicy);
  assert.equal(cart.totalQuantity, 6);
  assert.equal(cart.cost.subtotalAmount.amount, "529.70");
  const url = await checkout(
    p.query,
    cart.id,
    undefined,
    [SHOP],
    basketballSalePolicy,
  );
  assert.equal(url, cart.checkoutUrl);
  assert.deepEqual(
    writes(p).map((call) => call.document.match(/^mutation (\w+)/)?.[1]),
    ["cartBuyerIdentityUpdate"],
  );
});

test("a caller-provided reviewed price cannot override the fixed server sale policy", async () => {
  const p = provider([], { availabilityPrice: 7095 });
  await assert.rejects(
    addLine(p.query, p.cart.id, selected, 1, 7095, basketballSalePolicy),
    /scan_price_changed_review_required/,
  );
  assert.equal(writes(p).length, 0);
});

test("checkout rejects a preexisting mixed cart before buyer or checkout operations", async () => {
  const p = provider([
    { id: selected, quantity: 1 },
    { id: outsider, quantity: 1 },
  ]);
  await assert.rejects(
    checkout(p.query, p.cart.id, undefined, [SHOP], basketballSalePolicy),
    /variant_not_approved_for_sale/,
  );
  assert.equal(writes(p).length, 0);
});

test("checkout rechecks the final provider read for an outsider or changed price before returning a URL", async () => {
  for (const options of [{ lateOutsider: true }, { latePrice: true }]) {
    const p = provider([{ id: selected, quantity: 1 }], options);
    await assert.rejects(
      checkout(p.query, p.cart.id, undefined, [SHOP], basketballSalePolicy),
      /variant_not_approved_for_sale|sale_price_changed_review_required/,
    );
    assert.ok(p.calls.at(-1)?.document.includes("checkoutUrl"));
    assert.equal(writes(p).length, 1);
  }
});
