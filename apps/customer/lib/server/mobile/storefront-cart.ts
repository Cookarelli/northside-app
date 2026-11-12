import "server-only";
import { randomUUID } from "node:crypto";
import type { Store } from "@northside/data";
import { initialCommerceState, type CommerceState } from "@northside/domain";
import {
  AccessError,
  hashToken,
  opaqueToken,
  seal,
  unseal,
  validToken,
} from "../security";
import {
  createCart,
  readCart,
  addLine,
  updateLine,
  storefront,
  type Query,
} from "../storefront";
import { cents } from "../shopify-config";
import type { ShoppingOwner } from "../shopping-cart";
import type { Cart } from "../../commerce";
import {
  shoppingCartSchema,
  type ShoppingCart,
} from "../../../../../packages/customer-contracts/src/shopping";
import {
  approvedNativeProducts,
  approvedNativeScan,
  nativeRetailQuantity,
} from "./approved-native-catalog";
import { NORTHSIDE_NATIVE_SELECTION } from "../../../../../packages/customer-contracts/src/native-scan";

function assertScope(cart: Cart) {
  const seen = new Set<string>();
  if (
    cart.lines.pageInfo.hasNextPage ||
    cart.lines.nodes.length > NORTHSIDE_NATIVE_SELECTION.length
  )
    fail("cart_line_limit");
  for (const line of cart.lines.nodes) {
    const expected = NORTHSIDE_NATIVE_SELECTION.find(
      (p) => p.variantId === line.merchandise.id,
    );
    if (
      !expected ||
      expected.handle !== line.merchandise.product.handle ||
      seen.has(line.merchandise.id) ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 99
    )
      fail("missing_or_unverified_variant");
    seen.add(line.merchandise.id);
  }
}

type Saved = {
  owner: ShoppingOwner;
  expiresAt: number;
  cartId: string;
  version: number;
  pending?: { nonce: string; until: number };
};
type State = {
  carts: Record<string, { encrypted: string; expiresAt: number }>;
};
export type NativeCartPorts = {
  create(): Promise<Cart>;
  read(id: string): Promise<Cart>;
  add(
    id: string,
    variant: string,
    quantity: number,
    price: number,
    beforeMutation: () => Promise<void>,
  ): Promise<Cart>;
  set(
    id: string,
    line: string,
    quantity: number,
    beforeMutation: () => Promise<void>,
  ): Promise<Cart>;
  products: typeof approvedNativeProducts;
  scan: typeof approvedNativeScan;
  retail: typeof nativeRetailQuantity;
};
export function nativeCartPorts(query: Query = storefront()): NativeCartPorts {
  const policy = {
    assertCart: assertScope,
    assertVariant: (id: string) => {
      if (!NORTHSIDE_NATIVE_SELECTION.some((p) => p.variantId === id))
        fail("missing_or_unverified_variant");
    },
  };
  const fenced =
    (before: () => Promise<void>): Query =>
    async (document, variables) => {
      if (/^\s*mutation\b/.test(document)) await before();
      return query(document, variables);
    };
  return {
    create: () => createCart(query, undefined, policy),
    read: (id) => readCart(query, id, false, policy),
    add: (id, variant, quantity, price, before) =>
      addLine(fenced(before), id, variant, quantity, price, policy),
    set: (id, line, quantity, before) =>
      updateLine(fenced(before), id, line, quantity, policy),
    products: () => approvedNativeProducts(query),
    scan: (code, format) => approvedNativeScan(code, format, query),
    retail: nativeRetailQuantity,
  };
}
function fail(code: string): never {
  throw new AccessError(409, code);
}

/** Shopify cart and line keys stay encrypted server-side. Only a random Northside handle leaves this service. */
export class NativeStorefrontCartService {
  constructor(
    private store: Store,
    private ports: NativeCartPorts,
    private now = Date.now,
  ) {}
  private tx<T>(fn: (state: State) => T) {
    type Aggregate = CommerceState & { nativeStorefrontCarts?: State };
    return this.store.transact<Aggregate, T>(
      "commerce",
      initialCommerceState,
      (state) => fn((state.nativeStorefrontCarts ??= { carts: {} })),
    );
  }
  private load(state: State, token: string, owner: ShoppingOwner) {
    if (!validToken(token)) fail("shopping_session_expired");
    const key = hashToken(token),
      row = state.carts[key];
    if (!row || row.expiresAt <= this.now()) fail("shopping_session_expired");
    const saved = unseal<Saved>(row.encrypted, key);
    if (
      saved.owner.tenant !== owner.tenant ||
      (saved.owner.customerId && saved.owner.customerId !== owner.customerId)
    )
      fail("cart_owner_mismatch");
    if (owner.customerId) saved.owner.customerId = owner.customerId;
    return { key, saved };
  }
  private save(state: State, key: string, saved: Saved) {
    state.carts[key] = {
      encrypted: seal(saved, key),
      expiresAt: saved.expiresAt,
    };
  }
  async start(owner: ShoppingOwner) {
    // Empty anonymous carts do not reserve stock, create orders or start checkout.
    const cart = await this.ports.create(),
      token = opaqueToken(),
      key = hashToken(token);
    await this.tx((state) => {
      for (const [k, row] of Object.entries(state.carts))
        if (row.expiresAt <= this.now()) delete state.carts[k];
      if (Object.keys(state.carts).length >= 500)
        fail("shopping_capacity_reached");
      this.save(state, key, {
        owner,
        expiresAt: this.now() + 7 * 86400000,
        cartId: cart.id,
        version: 1,
      });
    });
    return { token, cart: await this.project(cart, 1) };
  }
  private async project(cart: Cart, version: number): Promise<ShoppingCart> {
    assertScope(cart);
    const products = await this.ports.products();
    const lines = await Promise.all(
      cart.lines.nodes.map(async (line) => {
        const product = products.find((p) =>
          p.variants.nodes.some((v) => v.id === line.merchandise.id),
        );
        const variant = product?.variants.nodes.find(
          (v) => v.id === line.merchandise.id,
        );
        if (!product || !variant)
          return {
            variantId: line.merchandise.id,
            productId: NORTHSIDE_NATIVE_SELECTION.find(
              (p) => p.variantId === line.merchandise.id,
            )!.id,
            title: "Item no longer available",
            variantTitle: "Unavailable variant",
            image: null,
            sku: null,
            quantity: line.quantity,
            priceCents: cents(line.merchandise.price),
            lineTotalCents: cents(line.cost.totalAmount),
            availability: "unavailable",
          };
        const retail = await this.ports.retail(
          variant.id,
          variant.identifiers.sku,
        );
        return {
          variantId: variant.id,
          productId: product.id,
          title: product.title,
          variantTitle: variant.title,
          image: product.featuredImage,
          sku: variant.identifiers.sku,
          quantity: line.quantity,
          priceCents: cents(line.merchandise.price),
          lineTotalCents: cents(line.cost.totalAmount),
          availability:
            product.availableForSale &&
            variant.availability.availableForSale &&
            !variant.availability.currentlyNotInStock &&
            retail >= line.quantity &&
            line.merchandise.availableForSale &&
            !line.merchandise.currentlyNotInStock &&
            line.merchandise.quantityAvailable !== null &&
            line.merchandise.quantityAvailable >= line.quantity
              ? "available"
              : "unavailable",
        };
      }),
    );
    const now = this.now();
    const parsed = shoppingCartSchema.safeParse({
      version,
      sample: false,
      phase: "shopping",
      lines,
      subtotalCents: cents(cart.cost.subtotalAmount),
      currency: "USD",
      paymentStatus: "unpaid",
      handoff: null,
      source: "shopify_cart",
      cost: {
        subtotalCents: cents(cart.cost.subtotalAmount),
        totalCents: cents(cart.cost.totalAmount),
        estimated: cart.cost.totalAmountEstimated,
        checkoutEnabled: false,
      },
      observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
    });
    if (!parsed.success) fail("invalid_response");
    return parsed.data;
  }
  private async operate(
    token: string,
    owner: ShoppingOwner,
    version: number | undefined,
    operation?: (
      cart: Cart,
      beforeMutation: () => Promise<void>,
    ) => Promise<Cart>,
  ) {
    const nonce = randomUUID();
    const prepared = await this.tx((state) => {
      const { key, saved } = this.load(state, token, owner);
      // Reads reconcile uncertain writes only after their lease; mutations can never clear the fence.
      if (saved.pending && (operation || saved.pending.until > this.now()))
        fail("cart_reconciliation_pending");
      if (version !== undefined && saved.version !== version)
        fail("cart_changed_reload");
      saved.pending = { nonce, until: this.now() + 90000 };
      this.save(state, key, saved); // Durable BEFORE remote side effects.
      return { key, saved };
    });
    let sent = false;
    try {
      let cart = await this.ports.read(prepared.saved.cartId);
      assertScope(cart);
      if (operation)
        cart = await operation(cart, async () => {
          await this.tx((state) => {
            const { key, saved } = this.load(state, token, owner);
            if (
              saved.pending?.nonce !== nonce ||
              saved.pending.until <= this.now()
            )
              fail("cart_changed_reload");
            saved.pending.until = this.now() + 90000;
            this.save(state, key, saved);
          });
          sent = true;
        });
      const result = await this.project(cart, prepared.saved.version + 1);
      await this.tx((state) => {
        const { key, saved } = this.load(state, token, owner);
        if (saved.pending?.nonce !== nonce) fail("cart_changed_reload");
        saved.version++;
        delete saved.pending;
        this.save(state, key, saved);
      });
      return result;
    } catch (error) {
      // A possibly applied mutation stays fenced across server/client restart. Never replay Add.
      if (!sent)
        await this.tx((state) => {
          const { key, saved } = this.load(state, token, owner);
          if (saved.pending?.nonce === nonce) {
            delete saved.pending;
            this.save(state, key, saved);
          }
        });
      if (error instanceof AccessError && error.code === "cart_expired")
        fail("shopping_session_expired");
      throw error;
    }
  }
  read(token: string, owner: ShoppingOwner) {
    return this.operate(token, owner, undefined);
  }
  async bind(token: string, owner: ShoppingOwner) {
    await this.tx((state) => {
      const { key, saved } = this.load(state, token, owner);
      this.save(state, key, saved);
    });
  }
  add(
    token: string,
    owner: ShoppingOwner,
    version: number,
    code: string,
    variantId: string,
    price: number,
  ) {
    return this.operate(token, owner, version, async (cart, sent) => {
      const scan = await this.ports.scan(code);
      const variant = scan.product.variants.nodes.find(
        (v) => v.id === variantId,
      );
      if (!variant || scan.product.selectedVariantId !== variantId)
        fail("scanned_variant_mismatch");
      if (variant.price.amountCents !== price)
        fail("scan_price_changed_review_required");
      const quantity =
        cart.lines.nodes
          .filter((l) => l.merchandise.id === variantId)
          .reduce((n, l) => n + l.quantity, 0) + 1;
      if (quantity > 99) fail("invalid_quantity");
      if (
        !scan.product.availableForSale ||
        !variant.availability.availableForSale ||
        variant.availability.currentlyNotInStock ||
        (await this.ports.retail(variantId, variant.identifiers.sku)) < quantity
      )
        fail("quantity_unavailable");
      return this.ports.add(cart.id, variantId, 1, price, sent);
    });
  }
  set(
    token: string,
    owner: ShoppingOwner,
    version: number,
    variantId: string,
    quantity: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99)
      fail("invalid_quantity");
    return this.operate(token, owner, version, async (cart, sent) => {
      const lines = cart.lines.nodes.filter(
        (l) => l.merchandise.id === variantId,
      );
      if (lines.length !== 1) fail("cart_line_not_found");
      if (quantity) {
        const products = await this.ports.products(),
          product = products.find((p) =>
            p.variants.nodes.some((v) => v.id === variantId),
          );
        const variant = product?.variants.nodes.find((v) => v.id === variantId);
        if (
          !product?.availableForSale ||
          !variant?.availability.availableForSale ||
          variant.availability.currentlyNotInStock ||
          (await this.ports.retail(variantId, variant.identifiers.sku)) <
            quantity
        )
          fail("quantity_unavailable");
      }
      return this.ports.set(cart.id, hashToken(lines[0].id), quantity, sent);
    });
  }
  async ready(): Promise<ShoppingCart> {
    return fail("checkout_disabled");
  }
  async cancel(): Promise<ShoppingCart> {
    return fail("checkout_disabled");
  }
}
