import "server-only";
import type { Store } from "@northside/data";
import { initialCommerceState, type CommerceState } from "@northside/domain";
import type { ScanResult } from "../store";
import type { ShoppingCart, ShoppingLine } from "../shopping";
import {
  AccessError,
  hashToken,
  opaqueToken,
  seal,
  unseal,
  validToken,
} from "./security";
import { cents, gid } from "./shopify-config";

export type ShoppingOwner = { tenant: string; customerId: string | null };
type Saved = {
  owner: ShoppingOwner;
  expiresAt: number;
  sample: boolean;
  version: number;
  lines: (ShoppingLine & { code: string })[];
  handoff: { reference: string; expiresAt: number } | null;
};
type State = {
  carts: Record<string, { encrypted: string; expiresAt: number }>;
  handoffs: Record<string, { cart: string; expiresAt: number }>;
};
const initial = (): State => ({ carts: {}, handoffs: {} });
function fail(code: string, status = 409): never {
  throw new AccessError(status, code);
}

// A shopping list, not a Shopify checkout/cart or inventory reservation. The
// existing registry/Storefront adapter is read-only. Provider work is outside
// Store's synchronous transaction; version checks fence every subsequent write.
export class ShoppingCartService {
  constructor(
    private store: Store,
    private resolve: (code: string) => Promise<ScanResult>,
    private sample: boolean,
    private now = Date.now,
  ) {}
  private tx<T>(fn: (state: State) => T) {
    // Reuse the customer server's already-authorized aggregate. Keep an additive
    // encrypted property so rehearsal sessions and their schema remain intact;
    // no customer/control-plane role or RLS policy is widened.
    type Aggregate = CommerceState & {
      shoppingLists?: Partial<Record<"sample" | "live", State>>;
    };
    return this.store.transact<Aggregate, T>(
      "commerce",
      initialCommerceState,
      (aggregate) => {
        const lists = (aggregate.shoppingLists ??= {});
        const state = (lists[this.sample ? "sample" : "live"] ??= initial());
        return fn(state);
      },
    );
  }
  private load(state: State, token: string, owner: ShoppingOwner) {
    if (!validToken(token)) fail("shopping_session_expired", 401);
    const key = hashToken(token),
      row = state.carts[key];
    if (!row || row.expiresAt <= this.now())
      fail("shopping_session_expired", 401);
    const cart = unseal<Saved>(row.encrypted, key);
    if (
      cart.owner.tenant !== owner.tenant ||
      (cart.owner.customerId && cart.owner.customerId !== owner.customerId)
    )
      fail("cart_owner_mismatch", 403);
    if (cart.sample !== this.sample) fail("cart_mode_mismatch", 403);
    // Once a verified customer opens a guest list, sign-out or account switching
    // cannot recover that customer's list using its old cookie.
    if (owner.customerId) cart.owner.customerId = owner.customerId;
    return { key, cart };
  }
  private save(state: State, key: string, cart: Saved): ShoppingCart {
    state.carts[key] = {
      encrypted: seal(cart, key),
      expiresAt: cart.expiresAt,
    };
    return this.view(cart);
  }
  private view(cart: Saved): ShoppingCart {
    return {
      version: cart.version,
      sample: cart.sample,
      phase: cart.handoff ? "ready_for_staff" : "shopping",
      lines: cart.lines.map((line) => ({
        variantId: line.variantId,
        productId: line.productId,
        title: line.title,
        variantTitle: line.variantTitle,
        image: line.image,
        quantity: line.quantity,
        priceCents: line.priceCents,
      })),
      subtotalCents: cart.lines.reduce(
        (sum, line) => sum + line.priceCents * line.quantity,
        0,
      ),
      currency: "USD",
      paymentStatus: "unpaid",
      handoff: cart.handoff,
    };
  }
  async start(owner: ShoppingOwner) {
    const token = opaqueToken();
    const cart = await this.tx((state) => {
      for (const [key, row] of Object.entries(state.carts))
        if (row.expiresAt <= this.now()) delete state.carts[key];
      for (const [key, row] of Object.entries(state.handoffs))
        if (row.expiresAt <= this.now() || !state.carts[row.cart])
          delete state.handoffs[key];
      if (Object.keys(state.carts).length >= 500)
        fail("shopping_capacity_reached", 503);
      return this.save(state, hashToken(token), {
        owner,
        expiresAt: this.now() + 86_400_000,
        sample: this.sample,
        version: 1,
        lines: [],
        handoff: null,
      });
    });
    return { token, cart };
  }
  async read(token: string, owner: ShoppingOwner) {
    return this.tx((state) => {
      const { key, cart } = this.load(state, token, owner);
      return this.save(state, key, cart);
    });
  }
  private editable(cart: Saved, version: number) {
    if (cart.version !== version) fail("cart_changed_reload");
    if (cart.handoff) fail("cancel_handoff_before_editing");
  }
  private async line(
    code: string,
    variantId: string,
    quantity: number,
    reviewedPriceCents: number,
  ) {
    const scan = await this.resolve(code);
    if (
      scan.product.fixture !== this.sample ||
      scan.availability.source !== (this.sample ? "sample" : "shopify")
    )
      fail("cart_mode_mismatch");
    if (scan.selected_variant && scan.selected_variant !== variantId)
      fail("scanned_variant_mismatch");
    const registered = scan.product.variants.find(
      (v) => v.variant_id === variantId,
    );
    const variant = scan.availability.variants.find((v) => v.id === variantId);
    if (!registered || !variant || !registered.locations.length)
      fail("missing_or_unverified_variant");
    if (
      !variant.available ||
      variant.quantity === null ||
      !Number.isSafeInteger(variant.quantity) ||
      variant.quantity < quantity
    )
      fail("quantity_unavailable");
    const priceCents = cents(variant.price);
    if (priceCents !== reviewedPriceCents)
      fail("scan_price_changed_review_required");
    return {
      code,
      variantId,
      productId: scan.product.product_id,
      title: scan.product.title,
      variantTitle: variant.title,
      image: scan.product.image || null,
      quantity,
      priceCents,
    };
  }
  async add(
    token: string,
    owner: ShoppingOwner,
    version: number,
    code: string,
    variantId: string,
    reviewedPriceCents: number,
  ) {
    const current = await this.read(token, owner);
    if (current.version !== version) fail("cart_changed_reload");
    if (current.phase !== "shopping") fail("cancel_handoff_before_editing");
    const quantity =
      (current.lines.find((l) => l.variantId === variantId)?.quantity || 0) + 1;
    if (quantity > 99) fail("invalid_quantity", 400);
    if (
      current.lines.length >= 50 &&
      !current.lines.some((l) => l.variantId === variantId)
    )
      fail("cart_line_limit");
    const line = await this.line(code, variantId, quantity, reviewedPriceCents);
    return this.tx((state) => {
      const { key, cart } = this.load(state, token, owner);
      this.editable(cart, version);
      cart.lines = cart.lines
        .filter((l) => l.variantId !== variantId)
        .concat(line);
      cart.version++;
      return this.save(state, key, cart);
    });
  }
  async set(
    token: string,
    owner: ShoppingOwner,
    version: number,
    variantId: string,
    quantity: number,
  ) {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 99)
      fail("invalid_quantity", 400);
    await this.read(token, owner); // Commit a verified owner before provider I/O.
    const current = await this.tx((state) => {
      const { cart } = this.load(state, token, owner);
      this.editable(cart, version);
      return cart.lines.find((l) => l.variantId === variantId);
    });
    if (!current) fail("cart_line_not_found", 404);
    // Removal remains possible even when a mapping or product was withdrawn.
    const line = quantity
      ? await this.line(current.code, variantId, quantity, current.priceCents)
      : null;
    return this.tx((state) => {
      const { key, cart } = this.load(state, token, owner);
      this.editable(cart, version);
      cart.lines = cart.lines.filter((l) => l.variantId !== variantId);
      if (line) cart.lines.push(line);
      cart.version++;
      return this.save(state, key, cart);
    });
  }
  async ready(token: string, owner: ShoppingOwner, version: number) {
    await this.read(token, owner);
    const snapshot = await this.tx(
      (state) => this.load(state, token, owner).cart,
    );
    if (snapshot.version !== version) fail("cart_changed_reload");
    if (snapshot.handoff) {
      if (snapshot.handoff.expiresAt <= this.now())
        fail("handoff_expired_cancel_and_retry", 410);
      return this.read(token, owner); // Lost response: same frozen handoff.
    }
    if (!snapshot.lines.length) fail("cart_empty", 400);
    for (const line of snapshot.lines)
      await this.line(
        line.code,
        line.variantId,
        line.quantity,
        line.priceCents,
      );
    return this.tx((state) => {
      const { key, cart } = this.load(state, token, owner);
      if (cart.version !== version) fail("cart_changed_reload");
      if (cart.handoff) return this.save(state, key, cart);
      const reference = opaqueToken(),
        expiresAt = Math.min(cart.expiresAt, this.now() + 600_000);
      cart.handoff = { reference, expiresAt };
      state.handoffs[hashToken(reference)] = { cart: key, expiresAt };
      return this.save(state, key, cart);
    });
  }
  async cancel(token: string, owner: ShoppingOwner, version: number) {
    return this.tx((state) => {
      const { key, cart } = this.load(state, token, owner);
      if (cart.version !== version) fail("cart_changed_reload");
      if (cart.handoff)
        delete state.handoffs[hashToken(cart.handoff.reference)];
      cart.handoff = null;
      cart.version++;
      return this.save(state, key, cart);
    });
  }
  // Route must authorize invited staff before calling this. A QR only identifies
  // an unpaid summary; it never authorizes payment, stock changes or POS import.
  async inspect(reference: string, tenant: string) {
    if (!validToken(reference)) fail("handoff_not_found", 404);
    return this.tx((state) => {
      const row = state.handoffs[hashToken(reference)];
      if (!row) fail("handoff_not_found", 404);
      if (row.expiresAt <= this.now()) fail("handoff_expired", 410);
      const saved = state.carts[row.cart];
      if (!saved || saved.expiresAt <= this.now()) fail("handoff_expired", 410);
      const cart = unseal<Saved>(saved.encrypted, row.cart);
      if (cart.owner.tenant !== tenant || cart.handoff?.reference !== reference)
        fail("handoff_not_found", 404);
      return this.view(cart);
    });
  }
}

export function shoppingInput(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("invalid_shopping_input", 400);
  const b = raw as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    start: [],
    resolve: ["code", "format"],
    add: ["version", "code", "variantId", "reviewedPriceCents"],
    set: ["version", "variantId", "quantity"],
    ready: ["version"],
    cancel: ["version"],
    inspect: ["reference"],
  };
  if (
    typeof b.action !== "string" ||
    !Object.hasOwn(fields, b.action) ||
    Object.keys(b).some(
      (k) => k !== "action" && !fields[b.action as string].includes(k),
    )
  )
    fail("invalid_shopping_input", 400);
  for (const key of fields[b.action as string]) {
    const v = b[key];
    if (key === "format" && v !== undefined && v !== "ean13")
      fail("invalid_shopping_input", 400);
    if (
      key === "code" &&
      (typeof v !== "string" ||
        !v.trim() ||
        v.length > 2048 ||
        /[\u0000-\u001f\u007f]/.test(v))
    )
      fail("malformed_scan", 400);
    if (key === "variantId") gid(v, "ProductVariant");
    if (key === "reference" && !validToken(v)) fail("handoff_not_found", 404);
    if (
      ["version", "quantity", "reviewedPriceCents"].includes(key) &&
      (!Number.isSafeInteger(v) ||
        (v as number) < (key === "version" ? 1 : 0) ||
        (key === "quantity" && (v as number) > 99))
    )
      fail("invalid_shopping_input", 400);
  }
  return b;
}
