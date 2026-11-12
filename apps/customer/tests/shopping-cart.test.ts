import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, SqliteStore } from "@northside/data";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShoppingCartService,
  shoppingInput,
} from "../lib/server/shopping-cart";
import { ScanDeduplicator, type ScanResult } from "../lib/store";
import { Commerce } from "@northside/domain";
const oldKey = process.env.SESSION_ENCRYPTION_KEY;
process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
test.after(() => {
  if (oldKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = oldKey;
});
const owner = { tenant: "northside", customerId: null };
const variantId = "gid://shopify/ProductVariant/8001";
function setup(store = new MemoryStore()) {
  let now = 1_800_000_000_000;
  const scan: ScanResult = {
    product: {
      id: "registered",
      product_id: "gid://shopify/Product/8001",
      title: "SYNTHETIC box",
      handle: "synthetic-box",
      fixture: false,
      image: {
        url: "https://cdn.shopify.com/synthetic.jpg",
        altText: "SYNTHETIC box",
      },
      variants: [
        {
          id: "registered-variant",
          variant_id: variantId,
          sku: "TEST",
          locations: [
            { label: "Retail floor", zone: "Display", side: null, aisle: null },
          ],
        },
      ],
    },
    selected_variant: variantId,
    campaign_key: null,
    destination: "product",
    availability: {
      checked_at: new Date(now).toISOString(),
      source: "shopify",
      variants: [
        {
          id: variantId,
          title: "Base",
          available: true,
          quantity: 3,
          price: { amount: "12.00", currencyCode: "USD" },
        },
      ],
    },
  };
  const calls: string[] = [];
  const service = new ShoppingCartService(
    store,
    async (code) => {
      calls.push(code);
      if (code !== "000012345678")
        throw Error("code_not_registered_or_disabled");
      return structuredClone(scan);
    },
    false,
    () => now,
  );
  const start = () => service.start(owner);
  return {
    service,
    scan,
    calls,
    start,
    advance: (ms: number) => {
      now += ms;
    },
    store,
  };
}
test("scan review adds exact variant/image/current price, merges explicit additions, adjusts/removes and totals in cents", async () => {
  const p = setup(),
    { token, cart } = await p.start();
  const added = await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  assert.equal(added.lines[0].image?.url, p.scan.product.image?.url);
  assert.equal(added.subtotalCents, 1200);
  const repeated = await p.service.add(
    token,
    owner,
    added.version,
    "000012345678",
    variantId,
    1200,
  );
  assert.equal(repeated.lines.length, 1);
  assert.equal(repeated.lines[0].quantity, 2);
  assert.equal(repeated.subtotalCents, 2400);
  const changed = await p.service.set(
    token,
    owner,
    repeated.version,
    variantId,
    3,
  );
  assert.equal(changed.subtotalCents, 3600);
  const decreased = await p.service.set(
    token,
    owner,
    changed.version,
    variantId,
    1,
  );
  assert.equal(decreased.subtotalCents, 1200);
  p.scan.product.variants = []; // Removal survives withdrawn mappings.
  const removed = await p.service.set(
    token,
    owner,
    decreased.version,
    variantId,
    0,
  );
  assert.equal(removed.subtotalCents, 0);
  assert.equal(removed.lines.length, 0);
  await assert.rejects(
    p.service.ready(token, owner, removed.version),
    /cart_empty/,
  );
});
test("duplicate camera frames are suppressed; an uncertain add retried with the same version cannot increment twice", async () => {
  const d = new ScanDeduplicator();
  assert.equal(d.accept("000012345678", 1000), true);
  assert.equal(d.accept("000012345678", 1100), false);
  assert.equal(d.accept("000012345678", 4100), true);
  const p = setup(),
    { token, cart } = await p.start();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      p.service.add(
        token,
        owner,
        cart.version,
        "000012345678",
        variantId,
        1200,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(
    p.service.add(token, owner, cart.version, "000012345678", variantId, 1200),
    /cart_changed_reload/,
  );
  assert.equal((await p.service.read(token, owner)).lines[0].quantity, 1);
});
test("unknown/missing barcodes, wrong variants and unapproved locations cannot add", async () => {
  const p = setup(),
    { token, cart } = await p.start();
  await assert.rejects(
    p.service.add(token, owner, cart.version, "UNKNOWN", variantId, 1200),
    /not_registered/,
  );
  await assert.rejects(
    p.service.add(
      token,
      owner,
      cart.version,
      "000012345678",
      "gid://shopify/ProductVariant/9",
      1200,
    ),
    /scanned_variant_mismatch/,
  );
  p.scan.product.variants[0].locations = [];
  await assert.rejects(
    p.service.add(token, owner, cart.version, "000012345678", variantId, 1200),
    /missing_or_unverified_variant/,
  );
  assert.equal((await p.service.read(token, owner)).lines.length, 0);
});
test("out-of-stock/unknown quantities, over-stock increments and price/currency changes fail without changing the list", async () => {
  for (const change of [
    { quantity: 0 },
    { quantity: null },
    { available: false },
  ]) {
    const p = setup(),
      { token, cart } = await p.start();
    Object.assign(p.scan.availability.variants[0], change);
    await assert.rejects(
      p.service.add(
        token,
        owner,
        cart.version,
        "000012345678",
        variantId,
        1200,
      ),
      /quantity_unavailable/,
    );
    assert.equal((await p.service.read(token, owner)).version, 1);
  }
  const p = setup(),
    { token, cart } = await p.start();
  const added = await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  await assert.rejects(
    p.service.set(token, owner, added.version, variantId, 4),
    /quantity_unavailable/,
  );
  p.scan.availability.variants[0].price.amount = "13.00";
  await assert.rejects(
    p.service.ready(token, owner, added.version),
    /scan_price_changed_review_required/,
  );
  assert.equal((await p.service.read(token, owner)).phase, "shopping");
  p.scan.availability.variants[0].price.currencyCode = "CAD";
  await assert.rejects(
    p.service.set(token, owner, added.version, variantId, 2),
  );
});
test("Ready to Pay returns a frozen unpaid expiring summary; cancellation revokes it and regenerating uses a new reference", async () => {
  const p = setup(),
    { token, cart } = await p.start();
  const added = await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  const ready = await p.service.ready(token, owner, added.version),
    reference = ready.handoff!.reference;
  assert.equal(ready.phase, "ready_for_staff");
  assert.equal(ready.paymentStatus, "unpaid");
  assert.equal(reference.length, 43);
  assert.equal(
    (await p.service.ready(token, owner, added.version)).handoff!.reference,
    reference,
  );
  const staff = await p.service.inspect(reference, owner.tenant);
  assert.deepEqual(staff.lines, ready.lines);
  assert.ok(!JSON.stringify(staff).includes("000012345678"));
  await assert.rejects(
    p.service.set(token, owner, ready.version, variantId, 2),
    /cancel_handoff/,
  );
  const canceled = await p.service.cancel(token, owner, ready.version);
  assert.equal(canceled.lines.length, 1);
  await assert.rejects(
    p.service.inspect(reference, owner.tenant),
    /handoff_not_found/,
  );
  const again = await p.service.ready(token, owner, canceled.version);
  assert.notEqual(again.handoff!.reference, reference);
  p.advance(600_001);
  await assert.rejects(
    p.service.inspect(again.handoff!.reference, owner.tenant),
    /handoff_expired/,
  );
  const recovered = await p.service.cancel(token, owner, again.version);
  assert.equal(recovered.phase, "shopping");
});
test("Ready to Pay rechecks stock and is fenced against concurrent quantity changes", async () => {
  const p = setup(),
    { token, cart } = await p.start();
  const added = await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  p.scan.availability.variants[0].quantity = 0;
  await assert.rejects(
    p.service.ready(token, owner, added.version),
    /quantity_unavailable/,
  );
  p.scan.availability.variants[0].quantity = 3;
  const results = await Promise.allSettled([
    p.service.set(token, owner, added.version, variantId, 2),
    p.service.ready(token, owner, added.version),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("encrypted persistence, owner/tenant isolation, session expiry and mode separation", async () => {
  const p = setup(),
    { token, cart } = await p.start();
  await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  const saved = JSON.stringify(await p.store.read("commerce", () => ({})));
  assert.ok(
    !saved.includes("SYNTHETIC") &&
      !saved.includes(token) &&
      !saved.includes(variantId),
  );
  await p.service.read(token, { ...owner, customerId: "verified-customer-a" });
  for (const other of [
    owner,
    { ...owner, customerId: "customer-b" },
    { tenant: "other", customerId: "verified-customer-a" },
  ])
    await assert.rejects(p.service.read(token, other), /cart_owner_mismatch/);
  const newSession = await p.start();
  await assert.rejects(
    p.service.read(newSession.cart.version.toString(), owner),
    /shopping_session_expired/,
  );
  p.advance(86_400_001);
  await assert.rejects(
    p.service.read(newSession.token, owner),
    /shopping_session_expired/,
  );
});
test("new shopping state preserves existing rehearsal carts and uses the existing authorized commerce namespace", async () => {
  const p = setup(),
    rehearsal = new Commerce(p.store),
    original = await rehearsal.start();
  const { token, cart } = await p.start();
  await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  assert.equal(
    (await rehearsal.current(original.secret)).id,
    original.session.id,
  );
  await rehearsal.edit(
    original.secret,
    original.session.version,
    "fixture-rookie-pack",
    2,
  );
  assert.equal((await p.service.read(token, owner)).subtotalCents, 1200);
  const sampleService = new ShoppingCartService(
    p.store,
    async () => p.scan,
    true,
  );
  await assert.rejects(
    sampleService.read(token, owner),
    /shopping_session_expired/,
  );
});
test("an unpaid handoff survives a local SQLite restart, is tenant restricted, and contains no payment or POS action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "northside-shopping-"));
  let db = new SqliteStore(join(dir, "shopping.sqlite"));
  try {
    const resolver = setup().scan;
    const service = () =>
      new ShoppingCartService(db, async () => resolver, false);
    const { token, cart } = await service().start(owner);
    const added = await service().add(
      token,
      owner,
      cart.version,
      "000012345678",
      variantId,
      1200,
    );
    const ready = await service().ready(token, owner, added.version);
    db.close();
    db = new SqliteStore(join(dir, "shopping.sqlite"));
    assert.equal(
      (await service().inspect(ready.handoff!.reference, owner.tenant))
        .subtotalCents,
      1200,
    );
    await assert.rejects(
      service().inspect(ready.handoff!.reference, "other-tenant"),
      /handoff_not_found/,
    );
    assert.equal((await service().read(token, owner)).paymentStatus, "unpaid");
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("handoff expiry never advertises validity beyond the encrypted cart's deadline", async () => {
  const p = setup(),
    { token, cart } = await p.start();
  const added = await p.service.add(
    token,
    owner,
    cart.version,
    "000012345678",
    variantId,
    1200,
  );
  p.advance(86_400_000 - 60_000);
  const ready = await p.service.ready(token, owner, added.version);
  p.advance(60_001);
  await assert.rejects(
    p.service.inspect(ready.handoff!.reference, owner.tenant),
    /handoff_expired/,
  );
  assert.equal(ready.handoff!.expiresAt, 1_800_000_000_000 + 86_400_000);
});
test("failed quantity/readiness lookups still bind the guest list to the verified customer first", async () => {
  for (const action of ["set", "ready"] as const) {
    const p = setup(),
      { token, cart } = await p.start();
    const added = await p.service.add(
      token,
      owner,
      cart.version,
      "000012345678",
      variantId,
      1200,
    );
    p.scan.availability.variants[0].quantity = 0;
    const signed = { ...owner, customerId: "verified-a" };
    await assert.rejects(
      action === "set"
        ? p.service.set(token, signed, added.version, variantId, 2)
        : p.service.ready(token, signed, added.version),
      /quantity_unavailable/,
    );
    await assert.rejects(p.service.read(token, owner), /cart_owner_mismatch/);
    assert.equal((await p.service.read(token, signed)).lines.length, 1);
  }
});
test("shopping-first initialization still supports the original rehearsal session service", async () => {
  const p = setup(),
    { token } = await p.start();
  const rehearsal = new Commerce(p.store),
    existing = await rehearsal.start();
  await rehearsal.edit(
    existing.secret,
    existing.session.version,
    "fixture-rookie-pack",
    1,
  );
  assert.equal((await p.service.read(token, owner)).lines.length, 0);
});
test("request parser rejects unknown fields, forged owner/cart/price/payment and invalid/missing input", () => {
  const base = {
    action: "add",
    version: 1,
    code: "000012345678",
    variantId,
    reviewedPriceCents: 1200,
  };
  assert.deepEqual(shoppingInput(base), base);
  for (const key of [
    "customerId",
    "tenant",
    "price",
    "cartId",
    "paid",
    "mode",
    "quantity",
  ])
    assert.throws(
      () => shoppingInput({ ...base, [key]: "FORGED" }),
      /invalid_shopping_input/,
    );
  for (const code of ["", null, 123, "a\n", "a".repeat(2049)])
    assert.throws(() => shoppingInput({ ...base, code }));
  for (const action of ["checkout", "pay", "__proto__", "toString", null])
    assert.throws(() => shoppingInput({ action }));
  for (const quantity of [-1, 100, 1.5, "2", null])
    assert.throws(() =>
      shoppingInput({ action: "set", version: 1, variantId, quantity }),
    );
});
