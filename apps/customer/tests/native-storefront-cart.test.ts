import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, SqliteStore, type Store } from "@northside/data";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NativeStorefrontCartService,
  type NativeCartPorts,
} from "../lib/server/mobile/storefront-cart";
import { mobileShoppingHandler } from "../lib/server/mobile/shopping";
import { hashToken, AccessError } from "../lib/server/security";
import { shoppingResponseSchema } from "../../../packages/customer-contracts/src/shopping";
import { NORTHSIDE_NATIVE_SELECTION } from "../../../packages/customer-contracts/src/native-scan";
import type { CatalogProductV1 } from "../../../packages/customer-contracts/src/catalog";
import type { Cart } from "../lib/commerce";

const previous = process.env.SESSION_ENCRYPTION_KEY;
process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
test.after(() => {
  if (previous === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = previous;
});
const identity = NORTHSIDE_NATIVE_SELECTION[0],
  owner = { tenant: "native-test", customerId: null as string | null };
function setup(injected?: Store, selectedIdentity = identity) {
  const identity = selectedIdentity;
  const store = injected ?? new MemoryStore();
  let now = Date.now(),
    stock = 5,
    unavailable = false,
    amount = "69.95",
    discount = false;
  let lose = false,
    calls = 0,
    scanDelay: Promise<void> | undefined;
  const product = (): CatalogProductV1 => ({
    id: identity.id,
    handle: identity.handle,
    title: "SYNTHETIC native cart item",
    description: "",
    productType: "Basketball",
    publication: "published",
    availableForSale: !unavailable,
    featuredImage: null,
    minVariantPrice: {
      amountCents: Math.round(Number(amount) * 100),
      currencyCode: "USD",
    },
    variants: {
      nodes: [
        {
          id: identity.variantId,
          productId: identity.id,
          title: "Base",
          identifiers: {
            state: "observed",
            sku: "SYNTHETIC-SKU",
            barcode: identity.barcode,
          },
          price: {
            amountCents: Math.round(Number(amount) * 100),
            currencyCode: "USD",
          },
          availability: {
            state: unavailable ? "unavailable" : "unknown",
            availableForSale: !unavailable,
            currentlyNotInStock: false,
            quantityAvailable: null,
          },
        },
      ],
      after: null,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    selectedVariantId: identity.variantId,
    productPath: `/shop/${identity.handle}`,
    onlineStoreUrl: null,
  });
  let cart: Cart = {
    id: "gid://shopify/Cart/SYNTHETIC?key=CART_KEY_CANARY",
    totalQuantity: 0,
    discountCodes: [],
    cost: {
      subtotalAmount: { amount: "0.00", currencyCode: "USD" },
      totalAmount: { amount: "0.00", currencyCode: "USD" },
      totalAmountEstimated: true,
    },
    lines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  };
  function quantity(q: number) {
    const value = Number(amount) * q - (discount && q ? 1 : 0);
    cart = {
      ...cart,
      totalQuantity: q,
      cost: {
        subtotalAmount: { amount: value.toFixed(2), currencyCode: "USD" },
        totalAmount: { amount: (value + 1).toFixed(2), currencyCode: "USD" },
        totalAmountEstimated: true,
      },
      lines: {
        nodes: q
          ? [
              {
                id: "gid://shopify/CartLine/LINE_KEY_CANARY",
                quantity: q,
                merchandise: {
                  id: identity.variantId,
                  title: "Base",
                  availableForSale: !unavailable,
                  currentlyNotInStock: false,
                  quantityAvailable: 100,
                  price: { amount, currencyCode: "USD" },
                  product: {
                    id: identity.id,
                    title: product().title,
                    handle: identity.handle,
                  },
                },
                cost: {
                  totalAmount: {
                    amount: value.toFixed(2),
                    currencyCode: "USD",
                  },
                },
              },
            ]
          : [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    return structuredClone(cart);
  }
  const ports: NativeCartPorts = {
    create: async () => structuredClone(cart),
    read: async () => quantity(cart.totalQuantity),
    products: async () => [product()],
    retail: async () => stock,
    scan: async () => {
      if (scanDelay) await scanDelay;
      return {
        contractVersion: "northside.mobile.v1",
        kind: "product-detail",
        product: product(),
        observedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      };
    },
    add: async (_id, variant, q, _price, before) => {
      assert.equal(variant, identity.variantId);
      await before();
      calls++;
      const result = quantity(cart.totalQuantity + q);
      if (lose) {
        lose = false;
        throw Error("PRIVATE lost acknowledgment");
      }
      return result;
    },
    set: async (_id, line, q, before) => {
      assert.equal(line, hashToken("gid://shopify/CartLine/LINE_KEY_CANARY"));
      await before();
      calls++;
      return quantity(q);
    },
  };
  const service = () =>
    new NativeStorefrontCartService(store, ports, () => now);
  return {
    service,
    store,
    ports,
    product,
    calls: () => calls,
    count: () => cart.totalQuantity,
    advance: () => {
      now += 90001;
    },
    stock: (q: number) => {
      stock = q;
    },
    price: () => {
      amount = "70.95";
    },
    unavailable: () => {
      unavailable = true;
    },
    discount: () => {
      discount = true;
    },
    lose: () => {
      lose = true;
    },
    delay: (p: Promise<void>) => {
      scanDelay = p;
    },
  };
}
test("native Shopify cart uses canonical totals, exact variants, edits/removal and no exposed provider keys", async () => {
  const h = setup(),
    service = h.service(),
    started = await service.start(owner);
  const added = await service.add(
    started.token,
    owner,
    started.cart.version,
    identity.barcode,
    identity.variantId,
    6995,
  );
  assert.equal(added.source, "shopify_cart");
  assert.equal(added.lines[0].quantity, 1);
  const changed = await service.set(
    started.token,
    owner,
    added.version,
    identity.variantId,
    3,
  );
  assert.equal(changed.subtotalCents, 20985);
  h.discount();
  const refreshed = await service.read(started.token, owner);
  assert.equal(refreshed.subtotalCents, 20885);
  assert.equal(refreshed.lines[0].lineTotalCents, 20885);
  assert.equal(refreshed.cost!.checkoutEnabled, false);
  assert.equal(
    shoppingResponseSchema.safeParse({
      contractVersion: "northside.mobile.v1",
      kind: "shopping",
      cart: refreshed,
    }).success,
    true,
  );
  const removed = await service.set(
    started.token,
    owner,
    refreshed.version,
    identity.variantId,
    0,
  );
  assert.equal(removed.lines.length, 0);
  assert.equal(h.count(), 0);
  for (const value of [
    JSON.stringify(added),
    JSON.stringify(await h.store.read("commerce", () => ({}))),
  ]) {
    assert(!value.includes("CART_KEY_CANARY"));
    assert(!value.includes("LINE_KEY_CANARY"));
  }
  await assert.rejects(service.ready(), /checkout_disabled/);
});
test("Retail Floor limits are separate from larger online stock and sold-out items cannot be added", async () => {
  const h = setup(),
    service = h.service(),
    { token, cart } = await service.start(owner);
  const added = await service.add(
    token,
    owner,
    cart.version,
    identity.barcode,
    identity.variantId,
    6995,
  );
  h.stock(1);
  await assert.rejects(
    service.set(token, owner, added.version, identity.variantId, 2),
    /quantity_unavailable/,
  );
  assert.equal(h.calls(), 1);
  h.unavailable();
  const current = await service.read(token, owner);
  assert.equal(current.lines[0].availability, "unavailable");
  await assert.rejects(
    service.add(
      token,
      owner,
      current.version,
      identity.barcode,
      identity.variantId,
      6995,
    ),
    /quantity_unavailable/,
  );
  const removed = await service.set(
    token,
    owner,
    current.version,
    identity.variantId,
    0,
  );
  assert.equal(removed.lines.length, 0);
});
test("price mismatch, wrong variant, stale revision and quantity bounds fail before mutation", async () => {
  const h = setup(),
    s = h.service(),
    { token, cart } = await s.start(owner);
  h.price();
  await assert.rejects(
    s.add(
      token,
      owner,
      cart.version,
      identity.barcode,
      identity.variantId,
      6995,
    ),
    /scan_price_changed_review_required/,
  );
  await assert.rejects(
    s.add(
      token,
      owner,
      cart.version,
      identity.barcode,
      "gid://shopify/ProductVariant/999",
      7095,
    ),
    /scanned_variant_mismatch/,
  );
  assert.throws(
    () => s.set(token, owner, cart.version, identity.variantId, 100),
    /invalid_quantity/,
  );
  const fresh = await s.read(token, owner);
  await assert.rejects(
    s.add(
      token,
      owner,
      cart.version,
      identity.barcode,
      identity.variantId,
      7095,
    ),
    /cart_changed_reload/,
  );
  assert(fresh.version > cart.version);
  assert.equal(h.calls(), 0);
});
test("uncertain writes survive service restart and cannot be replayed before canonical reconciliation", async () => {
  const h = setup(),
    s = h.service(),
    { token, cart } = await s.start(owner);
  h.lose();
  await assert.rejects(
    s.add(
      token,
      owner,
      cart.version,
      identity.barcode,
      identity.variantId,
      6995,
    ),
  );
  assert.equal(h.count(), 1);
  const restarted = h.service();
  await assert.rejects(
    restarted.add(
      token,
      owner,
      cart.version,
      identity.barcode,
      identity.variantId,
      6995,
    ),
    /cart_reconciliation_pending/,
  );
  await assert.rejects(
    restarted.read(token, owner),
    /cart_reconciliation_pending/,
  );
  h.advance();
  const restored = await restarted.read(token, owner);
  assert.equal(restored.lines[0].quantity, 1);
  assert.equal(h.calls(), 1);
});
test("an expired operation cannot dispatch after a newer read owns the durable fence", async () => {
  const h = setup(),
    s = h.service(),
    { token, cart } = await s.start(owner);
  let release!: () => void;
  h.delay(
    new Promise<void>((r) => {
      release = r;
    }),
  );
  const old = s.add(
    token,
    owner,
    cart.version,
    identity.barcode,
    identity.variantId,
    6995,
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  h.advance();
  await h.service().read(token, owner);
  release();
  await assert.rejects(old, /cart_changed_reload/);
  assert.equal(h.calls(), 0);
  assert.equal(h.count(), 0);
});
test("owner binding is durable and another customer/tenant cannot read or mutate", async () => {
  const h = setup(),
    s = h.service(),
    { token } = await s.start(owner);
  await s.bind(token, { ...owner, customerId: "customer-A" });
  await assert.rejects(s.read(token, owner), /cart_owner_mismatch/);
  await assert.rejects(
    s.read(token, { ...owner, customerId: "customer-B" }),
    /cart_owner_mismatch/,
  );
  await assert.rejects(
    s.read(token, { tenant: "other", customerId: "customer-A" }),
    /cart_owner_mismatch/,
  );
  assert.equal(
    (await s.read(token, { ...owner, customerId: "customer-A" })).source,
    "shopify_cart",
  );
});
test("HTTP start→add→set→read preserves provider fields and does not increment version in the ownership preflight", async () => {
  const h = setup(),
    service = h.service();
  const request = async (action: object, token?: string) => {
    const r = await mobileShoppingHandler(
      new Request("https://native.example/api/mobile/v1/shopping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { "X-Northside-Shopping-Session": token } : {}),
        },
      }),
      action,
      {
        gate() {},
        service: () => service,
        owner: async () => owner,
        canonicalCode: async (code) => code,
      },
    );
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert(r.headers.get("cache-control")?.includes("no-store"));
    assert(!JSON.stringify(body).includes("CART_KEY_CANARY"));
    return shoppingResponseSchema.parse(body);
  };
  const first = await request({ action: "start" });
  const added = await request(
    {
      action: "add",
      version: first.cart.version,
      code: identity.barcode,
      variantId: identity.variantId,
      reviewedPriceCents: 6995,
    },
    first.sessionToken,
  );
  assert.equal(added.cart.source, "shopify_cart");
  assert.equal(added.cart.lines[0].quantity, 1);
  const changed = await request(
    {
      action: "set",
      version: added.cart.version,
      variantId: identity.variantId,
      quantity: 2,
    },
    first.sessionToken,
  );
  const read = await request({ action: "read" }, first.sessionToken);
  assert.equal(read.cart.lines[0].quantity, 2);
  assert(read.cart.version > changed.cart.version);
});
test("HTTP provider failures are redacted; no implicit write replay or checkout", async () => {
  const h = setup(),
    service = h.service(),
    first = await service.start(owner);
  h.lose();
  const r = await mobileShoppingHandler(
    new Request("https://native.example/api/mobile/v1/shopping", {
      method: "POST",
      headers: { "X-Northside-Shopping-Session": first.token },
    }),
    {
      action: "add",
      version: first.cart.version,
      code: identity.barcode,
      variantId: identity.variantId,
      reviewedPriceCents: 6995,
    },
    {
      gate() {},
      service: () => service,
      owner: async () => owner,
      canonicalCode: async (code) => code,
    },
  );
  const body = await r.text();
  assert.equal(r.status, 503);
  assert(!body.includes("PRIVATE"));
  assert(!body.includes("CANARY"));
  assert.equal(h.calls(), 1);
});
test("unknown canonical merchandise is rejected before any provider mutation", async () => {
  const h = setup(),
    service = h.service(),
    first = await service.start(owner);
  const original = h.ports.read;
  h.ports.read = async (id) => {
    const cart = await original(id);
    cart.lines.nodes = [
      {
        id: "gid://shopify/CartLine/FOREIGN",
        quantity: 1,
        cost: { totalAmount: { amount: "1.00", currencyCode: "USD" } },
        merchandise: {
          id: "gid://shopify/ProductVariant/999",
          title: "Not approved",
          availableForSale: true,
          currentlyNotInStock: false,
          quantityAvailable: 100,
          price: { amount: "1.00", currencyCode: "USD" },
          product: { title: "Foreign", handle: "foreign" },
        },
      },
    ];
    return cart;
  };
  await assert.rejects(
    service.add(
      first.token,
      owner,
      first.cart.version,
      identity.barcode,
      identity.variantId,
      6995,
    ),
    /missing_or_unverified_variant/,
  );
  assert.equal(h.calls(), 0);
});
test("withdrawn approved merchandise stays removable without inventing a public product", async () => {
  const h = setup(),
    service = h.service(),
    first = await service.start(owner);
  const added = await service.add(
    first.token,
    owner,
    first.cart.version,
    identity.barcode,
    identity.variantId,
    6995,
  );
  h.ports.products = async () => [];
  const read = await service.read(first.token, owner);
  assert.equal(read.lines[0].title, "Item no longer available");
  assert.equal(read.lines[0].availability, "unavailable");
  assert.equal(
    (await service.set(first.token, owner, read.version, identity.variantId, 0))
      .lines.length,
    0,
  );
  assert.equal(added.lines[0].quantity, 1);
});
test("ownership binds before a failed HTTP canonical lookup without changing the revision", async () => {
  const h = setup(),
    service = h.service(),
    first = await service.start(owner);
  const r = await mobileShoppingHandler(
    new Request("https://native.example/api/mobile/v1/shopping", {
      method: "POST",
      headers: { "X-Northside-Shopping-Session": first.token },
    }),
    {
      action: "add",
      version: first.cart.version,
      code: "UNKNOWN",
      variantId: identity.variantId,
      reviewedPriceCents: 6995,
    },
    {
      gate() {},
      service: () => service,
      owner: async () => ({ ...owner, customerId: "customer-A" }),
      canonicalCode: async () => {
        throw new AccessError(404, "not_found");
      },
    },
  );
  assert.equal(r.status, 404);
  await assert.rejects(service.read(first.token, owner), /cart_owner_mismatch/);
  assert.equal(h.calls(), 0);
});
test("encrypted saved cart survives a real SQLite store restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "northside-native-cart-")),
    file = join(dir, "cart.sqlite");
  const store = new SqliteStore(file),
    h = setup(store),
    first = await h.service().start(owner);
  await h
    .service()
    .add(
      first.token,
      owner,
      first.cart.version,
      identity.barcode,
      identity.variantId,
      6995,
    );
  store.close();
  const reopened = new SqliteStore(file);
  try {
    const canonical = await new NativeStorefrontCartService(
      reopened,
      h.ports,
    ).read(first.token, owner);
    assert.equal(canonical.lines[0].quantity, 1);
    assert.equal(h.calls(), 1);
  } finally {
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native cart accepts a newly public variant absent from the historical source selection and proves its exact product at Floor", async () => {
  const extra = {
    id: "gid://shopify/Product/777777",
    variantId: "gid://shopify/ProductVariant/888888",
    barcode: "NEW-PUBLIC-BARCODE",
    handle: "new-public-product",
  } as const;
  const h = setup(undefined, extra),
    proofCalls: unknown[][] = [];
  h.ports.retail = async (...args) => {
    proofCalls.push(args);
    return 4;
  };
  const service = h.service(),
    first = await service.start(owner);
  const added = await service.add(
    first.token,
    owner,
    first.cart.version,
    extra.barcode,
    extra.variantId,
    6995,
  );
  assert.equal(added.lines[0].productId, extra.id);
  assert.equal(added.lines[0].variantId, extra.variantId);
  assert.equal(added.lines[0].availability, "available");
  assert.ok(
    proofCalls.every(
      (args) => args[0] === extra.variantId && args[2] === extra.id,
    ),
  );
  assert.equal(
    NORTHSIDE_NATIVE_SELECTION.some((p) => p.id === extra.id),
    false,
  );
});
