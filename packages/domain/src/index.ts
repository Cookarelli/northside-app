import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Store } from "@northside/data";

export type Phase =
  | "shopping"
  | "awaiting_counter_payment"
  | "paid_awaiting_preparation"
  | "ready"
  | "collected"
  | "cancelled";
export type Variant = {
  id: string;
  title: string;
  unit: "pack" | "box" | "case" | "single";
  cents: number;
  available: number;
};
export type Product = {
  id: string;
  title: string;
  description: string;
  color: string;
  mark: string;
  variants: Variant[];
};
export const products: Product[] = [
  {
    id: "rookie",
    title: "Rookie Series",
    description:
      "A fresh pack. A new possibility. A fixture trading-card product for trying the Northside flow.",
    color: "peach",
    mark: "01",
    variants: [
      {
        id: "fixture-rookie-pack",
        title: "Trading cards · 12 cards",
        unit: "pack",
        cents: 600,
        available: 24,
      },
    ],
  },
  {
    id: "archive",
    title: "The Archive",
    description:
      "A complete box for the collection. Staff will retrieve your merchandise after payment.",
    color: "blue",
    mark: "02",
    variants: [
      {
        id: "fixture-archive-box",
        title: "Collector edition · 6 packs",
        unit: "box",
        cents: 3400,
        available: 8,
      },
      {
        id: "fixture-archive-case",
        title: "Sealed case · 8 boxes",
        unit: "case",
        cents: 25000,
        available: 0,
      },
    ],
  },
  {
    id: "signature",
    title: "Signature Single",
    description:
      "One standout card. This sample is unavailable, so the prototype can verify the sold-out experience.",
    color: "lime",
    mark: "03",
    variants: [
      {
        id: "fixture-signature-single",
        title: "Display card · 1 card",
        unit: "single",
        cents: 1800,
        available: 0,
      },
    ],
  },
];
export type Mapping =
  | { kind: "product"; productId: string; variantId?: string }
  | { kind: "collection"; title: string; productIds: string[] }
  | { kind: "entry" };
const mappings: Record<string, Mapping> = {
  N001: {
    kind: "product",
    productId: "rookie",
    variantId: "fixture-rookie-pack",
  },
  N002: { kind: "product", productId: "archive" },
  N003: {
    kind: "product",
    productId: "signature",
    variantId: "fixture-signature-single",
  },
  C001: {
    kind: "collection",
    title: "The starting lineup",
    productIds: ["rookie", "archive", "signature"],
  },
  STORE: { kind: "entry" },
};
export type Line = {
  variantId: string;
  title: string;
  unit: string;
  quantity: number;
  cents: number;
};
export type Handoff = {
  reference: string;
  code: string;
  version: number;
  expiresAt: number;
  claimedAt?: number;
  claimedBy?: string;
  revoked?: boolean;
};
export type Session = {
  id: string;
  secretHash: string;
  createdAt: number;
  lastActivity: number;
  shared: boolean;
  phase: Phase;
  version: number;
  lines: Line[];
  handoff?: Handoff;
  paymentReference: string;
  checkout?: {
    state: "creating" | "issued" | "uncertain";
    url?: string;
    cartId?: string;
  };
  payment?: { orderId: string; source: "fixture" | "shopify"; at: number };
  collectionCode?: string;
  collectedAt?: number;
  audit: { at: number; actor: string; action: string }[];
};
export type LedgerEntry = {
  id: string;
  memberId: string;
  eventId: string;
  points: number;
  orderId: string;
  reversalOf?: string;
};
export type CommerceState = {
  creationTimes: number[];
  sessions: Record<string, Session>;
  mappings: Record<string, Mapping>;
  events: Record<string, boolean>;
  ledger: LedgerEntry[];
  members: Record<string, { shopifyCustomerId: string }>;
  tiers: { id: string; name: string; threshold: number }[];
  checkins: { memberId: string; eventId: string; at: number }[];
  redemptions: {
    id: string;
    memberId: string;
    points: number;
    eventId: string;
  }[];
};
const initial = (): CommerceState => ({
  creationTimes: [],
  sessions: {},
  mappings: structuredClone(mappings),
  events: {},
  ledger: [],
  members: {},
  tiers: [],
  checkins: [],
  redemptions: [],
});
export class CommerceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new CommerceError(message, status);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(5).toString("hex").toUpperCase();
export const publicSession = (s: Session) => ({
  id: s.id,
  shared: s.shared,
  phase: s.phase,
  version: s.version,
  lines: s.lines,
  total: s.lines.reduce((a, l) => a + l.cents * l.quantity, 0),
  handoff: s.handoff,
  checkout: s.checkout
    ? { state: s.checkout.state, url: s.shared ? undefined : s.checkout.url }
    : undefined,
  payment: s.payment,
  collectionCode: s.collectionCode,
  lastActivity: s.lastActivity,
});
export type PublicSession = ReturnType<typeof publicSession>;
export class Commerce {
  constructor(
    private store: Store,
    private now = Date.now,
    public fixture = true,
  ) {}
  private tx<R>(fn: (s: CommerceState) => R) {
    return this.store.transact("commerce", initial, fn);
  }
  private session(state: CommerceState, secret: string, touch = false) {
    const s = Object.values(state.sessions).find(
      (s) => s.secretHash === hash(secret),
    );
    if (
      !s ||
      !secret ||
      this.now() - s.lastActivity > (s.shared ? 180_000 : 86_400_000)
    )
      return fail("Your shopping session expired. Start a new basket.", 401);
    if (touch) s.lastActivity = this.now();
    return s;
  }
  async start(shared = false) {
    const secret = token();
    const result = await this.tx((state) => {
      for (const [key, s] of Object.entries(state.sessions)) {
        if (
          !s.payment &&
          !s.checkout &&
          !s.handoff?.claimedAt &&
          (s.phase === "cancelled" ||
            this.now() - s.lastActivity > (s.shared ? 180_000 : 86_400_000))
        )
          delete state.sessions[key];
      }
      state.creationTimes = (state.creationTimes ?? []).filter(
        (at) => this.now() - at < 60_000,
      );
      if (state.creationTimes.length >= 120)
        fail("Too many new sessions. Try again in a minute.", 429);
      if (Object.keys(state.sessions).length >= 1000)
        fail(
          "Session capacity reached. Staff must archive resolved records before starting new baskets.",
          503,
        );
      state.creationTimes.push(this.now());
      const id = randomUUID();
      const s: Session = {
        id,
        secretHash: hash(secret),
        createdAt: this.now(),
        lastActivity: this.now(),
        shared,
        phase: "shopping",
        version: 1,
        lines: [],
        paymentReference: token(),
        audit: [],
      };
      state.sessions[id] = s;
      return publicSession(s);
    });
    return { secret, session: result };
  }
  async current(secret: string, touch = false) {
    return this.tx((state) =>
      publicSession(this.session(state, secret, touch)),
    );
  }
  async reset(secret: string, shared = false) {
    await this.tx((state) => {
      const s = Object.values(state.sessions).find(
        (s) => s.secretHash === hash(secret),
      );
      if (s) {
        s.secretHash = "revoked";
        if (!s.payment && !s.checkout && !s.handoff?.claimedAt) {
          s.phase = "cancelled";
          if (s.handoff) s.handoff.revoked = true;
        }
      }
    });
    return this.start(shared);
  }
  async catalog() {
    if (!this.fixture)
      fail(
        "Live catalog mapping is not configured. Complete Shopify onboarding before enabling commerce.",
        503,
      );
    return products;
  }
  async resolve(input: string) {
    const key = input.trim().toUpperCase();
    const state = await this.store.read("commerce", initial);
    const mapping = state.mappings[key];
    if (!mapping)
      fail("That code was not found. Ask a team member for help.", 404);
    return { code: key, mapping };
  }
  async remap(key: string, mapping: Mapping, actor: string) {
    if (!/^[A-Z0-9_-]{2,32}$/.test(key)) fail("Invalid stable code.");
    if (
      mapping.kind === "product" &&
      !products.some(
        (p) =>
          p.id === mapping.productId &&
          (!mapping.variantId ||
            p.variants.some((v) => v.id === mapping.variantId)),
      )
    )
      fail("Unknown product or variant.");
    if (
      mapping.kind === "collection" &&
      (!mapping.productIds.length ||
        mapping.productIds.some((id) => !products.some((p) => p.id === id)))
    )
      fail("Unknown collection product.");
    await this.tx((s) => {
      s.mappings[key] = mapping;
    });
    return { updated: true, actor };
  }
  async edit(
    secret: string,
    version: number,
    variantId: string,
    quantity: number,
  ) {
    if (!this.fixture) fail("Live catalog validation is required.", 503);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 50)
      fail("Choose a quantity from 0 to 50.");
    return this.tx((state) => {
      const s = this.session(state, secret, true);
      if (s.phase !== "shopping" || s.checkout)
        fail(
          "This basket is frozen for payment. Ask staff before making changes.",
          409,
        );
      if (s.version !== version)
        fail("Your basket changed. Refresh and try again.", 409);
      const p = products.find((p) =>
        p.variants.some((v) => v.id === variantId),
      );
      const v = p?.variants.find((v) => v.id === variantId);
      if (!p || !v) fail("Unknown variant.", 404);
      if (quantity > v.available)
        fail(
          v.available === 0
            ? "This item is currently unavailable."
            : `Only ${v.available} are currently available.`,
          409,
        );
      s.lines = s.lines.filter((l) => l.variantId !== variantId);
      if (quantity)
        s.lines.push({
          variantId,
          title: `${p.title} · ${v.title}`,
          unit: v.unit,
          cents: v.cents,
          quantity,
        });
      s.version++;
      return publicSession(s);
    });
  }
  private validate(s: Session) {
    if (!s.lines.length) fail("Add an item before continuing.");
    for (const line of s.lines) {
      const v = products
        .flatMap((p) => p.variants)
        .find((v) => v.id === line.variantId);
      if (!v || v.available < line.quantity)
        fail("An item is no longer available. Please update your basket.", 409);
      if (v.cents !== line.cents)
        fail(
          "A price changed. Remove and add this item to confirm its current price.",
          409,
        );
    }
  }
  async handoff(secret: string, version: number) {
    return this.tx((state) => {
      const s = this.session(state, secret, true);
      if (!this.fixture)
        fail("Live POS catalog validation is not configured.", 503);
      if (s.phase !== "shopping" || s.checkout)
        fail(
          "A payment path is already active. Staff must reconcile it before switching.",
          409,
        );
      if (s.version !== version)
        fail("Your basket changed. Refresh and try again.", 409);
      this.validate(s);
      s.handoff = {
        reference: token(),
        code: code(),
        version: s.version,
        expiresAt: this.now() + 600_000,
      };
      s.phase = "awaiting_counter_payment";
      s.audit.push({
        at: this.now(),
        actor: "customer",
        action: "counter handoff issued",
      });
      return publicSession(s);
    });
  }
  async revokeHandoff(secret: string) {
    return this.tx((state) => {
      const s = this.session(state, secret, true);
      if (
        s.phase !== "awaiting_counter_payment" ||
        !s.handoff ||
        s.handoff.claimedAt ||
        s.payment
      )
        fail(
          "Staff has already opened this basket. Ask them to resolve payment first.",
          409,
        );
      s.handoff.revoked = true;
      s.phase = "shopping";
      s.version++;
      return publicSession(s);
    });
  }
  private findHandoff(state: CommerceState, reference: string) {
    const s = Object.values(state.sessions).find(
      (s) =>
        s.handoff?.reference === reference ||
        s.handoff?.code === reference.toUpperCase(),
    );
    if (!s?.handoff || s.handoff.revoked) fail("Handoff not found.", 404);
    if (s.handoff.expiresAt <= this.now())
      fail(
        "This handoff expired. The customer can cancel it and generate another.",
        410,
      );
    if (
      s.phase !== "awaiting_counter_payment" ||
      s.handoff.version !== s.version
    )
      fail("This handoff is no longer valid.", 409);
    return s;
  }
  async inspectHandoff(reference: string) {
    return this.tx((state) => {
      const s = this.findHandoff(state, reference);
      this.validate(s);
      return publicSession(s);
    });
  }
  async claimHandoff(reference: string, actor: string) {
    return this.tx((state) => {
      const s = this.findHandoff(state, reference);
      if (s.handoff!.claimedAt)
        fail(
          "This handoff has already been imported. Inspect the existing POS cart; do not import it again.",
          409,
        );
      this.validate(s);
      s.handoff!.claimedAt = this.now();
      s.handoff!.claimedBy = actor;
      s.audit.push({ at: this.now(), actor, action: "handoff claimed" });
      return { ...publicSession(s), paymentReference: s.paymentReference };
    });
  }
  async fixturePayment(id: string, actor: string) {
    if (!this.fixture) fail("Fixture payments are disabled.", 403);
    return this.tx((state) => {
      const s = state.sessions[id];
      if (!s || s.phase !== "awaiting_counter_payment" || !s.handoff?.claimedAt)
        fail("Claim an unpaid fixture handoff first.", 409);
      s.payment = {
        source: "fixture",
        orderId: `FIXTURE-${code()}`,
        at: this.now(),
      };
      s.phase = "paid_awaiting_preparation";
      s.collectionCode = code();
      s.audit.push({
        at: this.now(),
        actor,
        action: "simulated fixture payment — no charge",
      });
      return publicSession(s);
    });
  }
  async queue() {
    return this.tx((state) =>
      Object.values(state.sessions)
        .filter((s) =>
          [
            "awaiting_counter_payment",
            "paid_awaiting_preparation",
            "ready",
            "collected",
          ].includes(s.phase),
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(publicSession),
    );
  }
  async transition(
    id: string,
    next: "ready" | "collected",
    actor: string,
    collectionCode?: string,
  ) {
    return this.tx((state) => {
      const s = state.sessions[id];
      if (!s?.payment)
        fail("Payment must be verified before preparing or collecting.", 409);
      if (next === "ready" && s.phase !== "paid_awaiting_preparation")
        fail("Only paid orders awaiting preparation can become ready.", 409);
      if (
        next === "collected" &&
        (s.phase !== "ready" ||
          !collectionCode ||
          s.collectionCode !== collectionCode.toUpperCase())
      )
        fail(
          "A ready order and matching collection code are required. Collection cannot be repeated.",
          409,
        );
      s.phase = next;
      if (next === "collected") s.collectedAt = this.now();
      s.audit.push({ at: this.now(), actor, action: next });
      return publicSession(s);
    });
  }
  async beginCheckout(secret: string) {
    return this.tx((state) => {
      const s = this.session(state, secret, true);
      if (s.shared)
        fail(
          "For shared iPads, please pay at the counter. Phone checkout transfer is pending integration.",
          409,
        );
      if (this.fixture)
        fail(
          "Shopify checkout is unavailable in fixture mode. Use Pay at Counter to try the local flow.",
          503,
        );
      if (s.phase !== "shopping" || s.checkout)
        fail(
          "A payment attempt is already active. Staff reconciliation is required before retrying.",
          409,
        );
      if (!s.lines.length) fail("Your basket is empty.");
      s.checkout = { state: "creating" };
      return {
        id: s.id,
        reference: s.paymentReference,
        lines: structuredClone(s.lines),
      };
    });
  }
  async finishCheckout(id: string, result?: { url: string; cartId: string }) {
    return this.tx((state) => {
      const s = state.sessions[id];
      if (!s || s.checkout?.state !== "creating")
        fail("Checkout attempt is no longer current.", 409);
      s.checkout = result
        ? { state: "issued", ...result }
        : { state: "uncertain" };
      return publicSession(s);
    });
  }
  async verifiedPayment(
    eventId: string,
    order: {
      id: string;
      reference: string;
      paid: boolean;
      lines: { variantId: string; quantity: number }[];
    },
  ) {
    if (this.fixture)
      fail("Live payment events are disabled in fixture mode.", 403);
    return this.tx((state) => {
      if (state.events[eventId]) return { duplicate: true };
      if (!order.paid) fail("Shopify has not verified full payment.", 409);
      const s = Object.values(state.sessions).find(
        (s) => s.paymentReference === order.reference,
      );
      if (!s) fail("No matching payment attempt.", 404);
      if (!s.checkout && !s.handoff?.claimedAt)
        fail("No server-authorized payment attempt.", 409);
      if (s.payment) {
        if (s.payment.orderId !== order.id)
          fail(
            "A second order needs staff reconciliation. No second collection authorized.",
            409,
          );
        state.events[eventId] = true;
        return { duplicate: true };
      }
      const tally = (lines: { variantId: string; quantity: number }[]) =>
        JSON.stringify(
          Object.entries(
            lines.reduce(
              (a, l) => (
                (a[l.variantId] = (a[l.variantId] ?? 0) + l.quantity),
                a
              ),
              {} as Record<string, number>,
            ),
          ).sort(),
        );
      if (tally(s.lines) !== tally(order.lines))
        fail(
          "Order contents differ from the frozen basket. Staff reconciliation is required.",
          409,
        );
      s.payment = { source: "shopify", orderId: order.id, at: this.now() };
      s.phase = "paid_awaiting_preparation";
      s.collectionCode = code();
      state.events[eventId] = true;
      return { duplicate: false };
    });
  }
  async ledgerEvent(entry: Omit<LedgerEntry, "id">, verified: boolean) {
    if (!verified)
      fail("Membership events require trusted server verification.", 403);
    if (!Number.isInteger(entry.points))
      fail("Points must be integer ledger units.");
    return this.tx((state) => {
      const existing = state.ledger.find((e) => e.eventId === entry.eventId);
      if (existing) return existing;
      if (entry.reversalOf) {
        const original = state.ledger.find((e) => e.id === entry.reversalOf);
        if (
          !original ||
          original.reversalOf ||
          original.memberId !== entry.memberId ||
          original.orderId !== entry.orderId ||
          entry.points !== -original.points
        )
          fail("Invalid refund reversal.");
        if (state.ledger.some((e) => e.reversalOf === original.id))
          fail("This award has already been reversed.", 409);
      }
      const row = { ...entry, id: randomUUID() };
      state.ledger.push(row);
      return row;
    });
  }
}
