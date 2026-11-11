import {
  shoppingResponseSchema,
  type ShoppingAction,
  type ShoppingCart,
  type ShoppingResponse,
} from "@northside/customer-contracts/shopping";
import { MobileFailure } from "../api/client";
import { MOBILE_CONTRACT_VERSION } from "@northside/customer-contracts/mobile";
import { currentObservation } from "@northside/customer-contracts/mvp";

export type CartHandleStore = {
  get(): Promise<string | null>;
  set(handle: string): Promise<void>;
  remove(): Promise<void>;
};

export type ShoppingPort = (
  action: ShoppingAction,
  token: string | undefined,
  signal: AbortSignal,
) => Promise<ShoppingResponse>;
export type ShoppingSnapshot = {
  status: "unconfigured" | "idle" | "ready" | "paused" | "error";
  busy: boolean;
  cart?: ShoppingCart;
  qr?: string;
  error?: string;
  needsRefresh?: boolean;
  handoffExpired?: boolean;
};

/** Ephemeral native view of the existing server-owned unpaid shopping list. */
export class ShoppingController {
  private state: ShoppingSnapshot;
  private listeners = new Set<() => void>();
  private token?: string;
  private generation = 0;
  private abort = new AbortController();
  private active: boolean;
  private expiry?: ReturnType<typeof setTimeout>;
  private restored = false;
  constructor(
    private port: ShoppingPort | null,
    private now = Date.now,
    active = true,
    private storage?: CartHandleStore,
  ) {
    this.active = active;
    this.state = {
      status: port ? (active ? "idle" : "paused") : "unconfigured",
      busy: false,
    };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: ShoppingSnapshot) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  private current(g: number) {
    if (g !== this.generation || !this.active || this.abort.signal.aborted)
      throw new MobileFailure("cancelled");
  }
  private publish(response: ShoppingResponse) {
    clearTimeout(this.expiry);
    const handoff = response.cart.handoff;
    if (
      response.cart.source === "shopify_cart" &&
      !currentObservation(
        {
          observedAt: response.cart.observedAt!,
          expiresAt: response.cart.expiresAt!,
        },
        this.now(),
      )
    )
      throw new MobileFailure("refresh_required");
    const expired = !!handoff && handoff.expiresAt <= this.now();
    this.update({
      status: "ready",
      busy: false,
      cart: response.cart,
      qr: expired ? undefined : response.qr,
      handoffExpired: expired,
    });
    if (handoff && !expired) {
      const reference = handoff.reference;
      this.expiry = setTimeout(
        () => {
          if (this.state.cart?.handoff?.reference === reference) {
            this.update({ ...this.state, qr: undefined, handoffExpired: true });
          }
        },
        Math.min(2147483647, Math.max(0, handoff.expiresAt - this.now())),
      );
      (this.expiry as unknown as { unref?: () => void }).unref?.();
    }
    if (response.cart.source === "shopify_cart") {
      this.expiry = setTimeout(
        () =>
          this.update({
            ...this.state,
            status: "error",
            cart: undefined,
            error: "refresh_required",
            needsRefresh: true,
          }),
        Math.max(0, Date.parse(response.cart.expiresAt!) - this.now()),
      );
      (this.expiry as unknown as { unref?: () => void }).unref?.();
    }
  }
  private async request(
    action: ShoppingAction,
    g: number,
  ): Promise<ShoppingResponse> {
    this.current(g);
    const value = await this.port!(action, this.token, this.abort.signal);
    this.current(g);
    const parsed = shoppingResponseSchema.safeParse(value);
    if (
      !parsed.success ||
      (action.action === "start"
        ? !parsed.data.sessionToken
        : !!parsed.data.sessionToken)
    )
      throw new MobileFailure("invalid_response");
    if (action.action === "start") {
      this.token = parsed.data.sessionToken;
      if (this.storage) await this.remember();
      this.current(g);
    }
    return parsed.data;
  }
  private async remember() {
    if (!this.storage || !this.token) return;
    try {
      await this.storage.set(this.token);
    } catch {
      throw new MobileFailure("storage_unavailable");
    }
  }
  private async restoreHandle() {
    if (!this.storage || this.restored) return;
    try {
      const value = await this.storage.get();
      if (value && !/^[A-Za-z0-9_-]{43}$/.test(value)) {
        await this.storage.remove();
        throw new MobileFailure("shopping_session_expired");
      }
      this.token = value ?? undefined;
      this.restored = true;
    } catch (error) {
      throw error instanceof MobileFailure
        ? error
        : new MobileFailure("storage_unavailable");
    }
  }
  private async perform(
    make: (cart: ShoppingCart) => ShoppingAction | undefined,
    start = false,
    refresh = false,
  ) {
    if (!this.port || !this.active || this.state.busy) return;
    if (!refresh && this.state.needsRefresh)
      throw new MobileFailure("cart_changed_reload");
    const g = ++this.generation;
    this.abort.abort();
    this.abort = new AbortController();
    const previous = this.state.cart;
    this.update({ ...this.state, busy: true, error: undefined });
    try {
      if (this.storage) await this.restoreHandle();
      this.current(g);
      if (!this.token && !start) {
        this.update({ status: "idle", busy: false });
        return;
      }
      if (this.storage) await this.remember();
      let response: ShoppingResponse | undefined;
      let cart = previous;
      if (!this.token) {
        response = await this.request({ action: "start" }, g);
        cart = response.cart;
      } else if (!cart || refresh) {
        response = await this.request({ action: "read" }, g);
        cart = response.cart;
      }
      if (!cart) throw new MobileFailure("invalid_response");
      const action = make(cart);
      if (action) response = await this.request(action, g);
      this.current(g);
      this.publish(
        response ?? {
          contractVersion: MOBILE_CONTRACT_VERSION,
          kind: "shopping",
          cart,
        },
      );
      return this.state.cart;
    } catch (error) {
      if (g !== this.generation || !this.active) return;
      const code =
        error instanceof MobileFailure ? error.code : "service_unavailable";
      if (
        [
          "shopping_session_expired",
          "cart_owner_mismatch",
          "cart_mode_mismatch",
          "session_expired",
          "unauthorized",
        ].includes(code)
      ) {
        this.token = undefined;
        if (this.storage) await this.storage.remove().catch(() => {});
      }
      clearTimeout(this.expiry);
      // An uncertain write is never retried. Hide stale prices and reload the
      // canonical list before another mutation, even if the server committed it.
      this.update({
        status: "error",
        busy: false,
        error: code,
        needsRefresh: !!this.token,
      });
      throw new MobileFailure(code);
    }
  }
  read = () => this.perform(() => undefined, false, true);
  restore = () => this.perform(() => undefined, false, true);
  newCart = async () => {
    if (this.state.busy) return;
    if (this.storage) {
      try {
        await this.storage.remove();
      } catch {
        this.update({
          status: "error",
          busy: false,
          error: "storage_unavailable",
        });
        return;
      }
    }
    this.reset();
  };
  start = () => this.perform(() => undefined, true, true);
  add = (
    code: string,
    variantId: string,
    reviewedPriceCents: number,
    format?: Extract<ShoppingAction, { action: "add" }>["format"],
  ) =>
    this.perform(
      (cart) => ({
        action: "add",
        version: cart.version,
        code,
        variantId,
        reviewedPriceCents,
        ...(format ? { format } : {}),
      }),
      true,
    );
  set = (variantId: string, quantity: number) =>
    this.perform((cart) => ({
      action: "set",
      version: cart.version,
      variantId,
      quantity,
    }));
  ready = () =>
    this.perform((cart) => ({ action: "ready", version: cart.version }));
  cancel = () =>
    this.perform((cart) => ({ action: "cancel", version: cart.version }));
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.generation++;
      this.abort.abort();
      clearTimeout(this.expiry);
      this.update({
        status: this.port ? "paused" : "unconfigured",
        busy: false,
        needsRefresh: !!this.token,
      });
    } else if (this.token) void this.read().catch(() => {});
    else
      this.update({ status: this.port ? "idle" : "unconfigured", busy: false });
  }
  reset() {
    this.generation++;
    this.abort.abort();
    this.abort = new AbortController();
    this.token = undefined;
    clearTimeout(this.expiry);
    this.update({ status: this.port ? "idle" : "unconfigured", busy: false });
  }
  dispose() {
    this.reset();
    this.active = false;
    this.listeners.clear();
  }
}
