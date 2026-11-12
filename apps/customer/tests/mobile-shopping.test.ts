import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "@northside/data";
import { Commerce } from "@northside/domain";
import { ShoppingCartService } from "../lib/server/shopping-cart";
import { AccessError } from "../lib/server/security";
import {
  mobileShoppingHandler,
  resolveShoppingScan,
  type MobileShoppingDependencies,
  type ShoppingScanDependencies,
} from "../lib/server/mobile/shopping";
import {
  SHOPPING_SESSION_HEADER,
  shoppingResponseSchema,
  shoppingErrorSchema,
} from "../../../packages/customer-contracts/src/shopping";
import { MOBILE_CONTRACT_VERSION } from "../../../packages/customer-contracts/src/mobile";
import type { ScanResult } from "../lib/store";
import type { MobileProduct } from "../../../packages/customer-contracts/src/mvp";
import { mobileHandler } from "../lib/server/mobile/http";

const oldKey = process.env.SESSION_ENCRYPTION_KEY;
process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64");
test.after(() => {
  if (oldKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = oldKey;
});
const variantId = "gid://shopify/ProductVariant/8001";
const productId = "gid://shopify/Product/8001";
const barcode = "012345678905";
const ean = "0" + barcode;
const image = {
  url: "https://cdn.shopify.com/s/files/1/0000/synthetic.jpg",
  altText: "SYNTHETIC product",
};
function scan(): ScanResult {
  return {
    product: {
      id: "registered",
      product_id: productId,
      title: "SYNTHETIC item",
      handle: "synthetic-item",
      fixture: false,
      image,
      variants: [
        {
          id: "registered-variant",
          variant_id: variantId,
          sku: "SYNTHETIC",
          locations: [
            {
              label: "Approved retail",
              zone: "Display",
              side: null,
              aisle: null,
            },
          ],
        },
      ],
    },
    selected_variant: variantId,
    campaign_key: null,
    destination: "product",
    availability: {
      checked_at: new Date().toISOString(),
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
}
function setup() {
  let now = Date.now();
  const store = new MemoryStore(),
    current = scan(),
    calls: string[] = [];
  const service = new ShoppingCartService(
    store,
    async (code) => {
      calls.push(code);
      if (code !== barcode) throw new AccessError(404, "not_found");
      return structuredClone(current);
    },
    false,
    () => now,
  );
  const owners: (string | undefined)[] = [];
  const deps: MobileShoppingDependencies = {
    gate: () => {},
    service: () => service,
    owner: async (bearer) => {
      owners.push(bearer);
      if (bearer && !["A".repeat(43), "B".repeat(43)].includes(bearer))
        throw new AccessError(401, "unauthorized");
      return { tenant: "northside", customerId: bearer?.[0] ?? null };
    },
    canonicalCode: async (code, format) => {
      if (code === ean && format === "ean13") return barcode;
      if (code !== barcode) throw new AccessError(404, "not_found");
      return code;
    },
  };
  const send = (
    body: unknown,
    token?: string,
    auth?: string,
    extra: HeadersInit = {},
  ) =>
    mobileShoppingHandler(
      new Request("https://native.invalid/api/mobile/v1/shopping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { [SHOPPING_SESSION_HEADER]: token } : {}),
          ...(auth ? { Authorization: auth } : {}),
          ...extra,
        },
      }),
      body,
      deps,
    );
  const read = async (response: Response) =>
    shoppingResponseSchema.parse(await response.json());
  const start = async () => read(await send({ action: "start" }));
  return {
    deps,
    service,
    store,
    current,
    calls,
    owners,
    send,
    read,
    start,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const add = (version: number, code = barcode, format?: string) => ({
  action: "add",
  version,
  code,
  variantId,
  reviewedPriceCents: 1200,
  ...(format ? { format } : {}),
});
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(
    shoppingErrorSchema.parse(await response.json()).error.code,
    code,
  );
}

test("guest shopping reuses exact unpaid list add/set/remove and never returns provider credentials, raw stock or locators", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  assert.equal(token.length, 43);
  let result = await p.read(await p.send(add(1), token));
  assert.deepEqual(result.cart.lines[0], {
    productId,
    variantId,
    title: "SYNTHETIC item",
    variantTitle: "Base",
    image,
    quantity: 1,
    priceCents: 1200,
  });
  assert.equal(result.cart.subtotalCents, 1200);
  assert.equal(result.sessionToken, undefined);
  assert.equal(result.cart.paymentStatus, "unpaid");
  const text = JSON.stringify(result);
  for (const forbidden of [
    "locations",
    "quantityAvailable",
    "sku",
    "barcode",
    "accessToken",
    "encrypted",
    "customerId",
    "checkoutUrl",
    barcode,
    token,
  ])
    assert.equal(text.includes(forbidden), false, forbidden);
  result = await p.read(
    await p.send(
      { action: "set", version: result.cart.version, variantId, quantity: 3 },
      token,
    ),
  );
  assert.equal(result.cart.subtotalCents, 3600);
  p.current.product.variants = [];
  result = await p.read(
    await p.send(
      { action: "set", version: result.cart.version, variantId, quantity: 0 },
      token,
    ),
  );
  assert.equal(result.cart.lines.length, 0);
});
test("canonical EAN to UPC is stored for subsequent set and ready checks", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  const added = await p.read(await p.send(add(1, ean, "ean13"), token));
  const changed = await p.read(
    await p.send(
      { action: "set", version: added.cart.version, variantId, quantity: 2 },
      token,
    ),
  );
  await p.read(
    await p.send({ action: "ready", version: changed.cart.version }, token),
  );
  assert.deepEqual(p.calls, [barcode, barcode, barcode]);
});
test("duplicate uncertain add is fenced by the existing version; explicit next add increments", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  const responses = await Promise.all([
    p.send(add(1), token),
    p.send(add(1), token),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const current = await p.read(await p.send({ action: "read" }, token));
  assert.equal(current.cart.lines[0].quantity, 1);
  const second = await p.read(await p.send(add(current.cart.version), token));
  assert.equal(second.cart.lines[0].quantity, 2);
});
test("ready freezes an unpaid expiring QR; cancel revokes the reference and keeps list", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  const added = await p.read(await p.send(add(1), token));
  let encoded = "";
  p.deps.encodeQr = async (value) => {
    encoded = value;
    return "data:image/png;base64,aGVsbG8=";
  };
  const ready = await p.read(
    await p.send({ action: "ready", version: added.cart.version }, token),
  );
  assert.equal(ready.cart.phase, "ready_for_staff");
  assert.equal(ready.cart.paymentStatus, "unpaid");
  assert.equal(
    encoded,
    "northside-handoff:v1:" + ready.cart.handoff!.reference,
  );
  const repeated = await p.read(
    await p.send({ action: "ready", version: ready.cart.version }, token),
  );
  assert.equal(repeated.cart.handoff!.reference, ready.cart.handoff!.reference);
  await error(
    await p.send(add(ready.cart.version), token),
    409,
    "cancel_handoff_before_editing",
  );
  const canceled = await p.read(
    await p.send({ action: "cancel", version: ready.cart.version }, token),
  );
  assert.equal(canceled.cart.lines.length, 1);
  assert.equal(canceled.qr, undefined);
  await assert.rejects(
    p.service.inspect(ready.cart.handoff!.reference, "northside"),
    /handoff_not_found/,
  );
  const next = await p.read(
    await p.send({ action: "ready", version: canceled.cart.version }, token),
  );
  p.advance(600001);
  await error(
    await p.send({ action: "ready", version: next.cart.version }, token),
    410,
    "handoff_expired_cancel_and_retry",
  );
});
test("verified owner binding survives failed provider work and denies guest, other customer and invalid Bearer", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  await error(
    await p.send(add(1, "UNKNOWN"), token, "Bearer " + "A".repeat(43)),
    404,
    "not_found",
  );
  await error(
    await p.send({ action: "read" }, token),
    403,
    "cart_owner_mismatch",
  );
  await error(
    await p.send({ action: "read" }, token, "Bearer " + "B".repeat(43)),
    403,
    "cart_owner_mismatch",
  );
  await error(
    await p.send({ action: "read" }, token, "Bearer " + "C".repeat(43)),
    401,
    "unauthorized",
  );
  assert.equal(
    (
      await p.read(
        await p.send({ action: "read" }, token, "Bearer " + "A".repeat(43)),
      )
    ).cart.lines.length,
    0,
  );
  await error(
    await p.send({ action: "start" }, undefined, "bad auth"),
    401,
    "unauthorized",
  );
});
test("web cookies, forged authority/payment fields and malformed capability headers are rejected", async () => {
  const p = setup();
  for (const name of [
    "customerId",
    "tenant",
    "staff",
    "paid",
    "mode",
    "quantity",
    "price",
    "cartId",
  ])
    await error(
      await p.send({ ...add(1), [name]: "FORGED" }),
      400,
      "invalid_request",
    );
  for (const action of ["inspect", "mark-paid", "checkout", "pay"])
    await error(await p.send({ action }), 400, "invalid_request");
  await error(
    await p.send({ action: "start" }, undefined, undefined, {
      Cookie: "__Host-ns_session=",
    }),
    401,
    "unauthorized",
  );
  assert.equal(p.owners.length, 0);
  for (const value of ["", "bad", "A".repeat(43) + ", " + "B".repeat(43)])
    await error(
      await p.send({ action: "start" }, undefined, undefined, {
        [SHOPPING_SESSION_HEADER]: value,
      }),
      401,
      "shopping_session_expired",
    );
});
test("price, stock, missing variants, unknown images and expiration fail closed without mutation", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  for (const quantity of [null, 0]) {
    p.current.availability.variants[0].quantity = quantity;
    await error(await p.send(add(1), token), 409, "quantity_unavailable");
  }
  p.current.availability.variants[0].quantity = 3;
  p.current.availability.variants[0].price.amount = "13.00";
  await error(
    await p.send(add(1), token),
    409,
    "scan_price_changed_review_required",
  );
  p.current.availability.variants[0].price.amount = "12.00";
  p.current.product.variants = [];
  await error(
    await p.send(add(1), token),
    409,
    "missing_or_unverified_variant",
  );
  p.advance(86400001);
  await error(
    await p.send({ action: "read" }, token),
    401,
    "shopping_session_expired",
  );
});
test("service preserves existing Commerce rehearsal state and encrypts this list", async () => {
  const p = setup(),
    rehearsal = new Commerce(p.store),
    before = await rehearsal.start();
  const opened = await p.start();
  await p.read(await p.send(add(1), opened.sessionToken));
  assert.equal((await rehearsal.current(before.secret)).id, before.session.id);
  const stored = JSON.stringify(await p.store.read("commerce", () => ({})));
  for (const value of ["SYNTHETIC", barcode, opened.sessionToken!, variantId])
    assert.equal(stored.includes(value), false);
});
test("default native endpoint remains gated before store, registry or provider access", async () => {
  const response = await mobileHandler(
    new Request("https://native.invalid/api/mobile/v1/shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }),
  );
  await error(response, 404, "not_found");
});

function scanDependencies() {
  const current = scan();
  const product: MobileProduct = {
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "product-detail",
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    product: {
      id: productId,
      handle: current.product.handle,
      title: current.product.title,
      description: "",
      productType: "Cards",
      publication: "published",
      availableForSale: true,
      featuredImage: image,
      minVariantPrice: { amountCents: 1200, currencyCode: "USD" },
      variants: {
        nodes: [
          {
            id: variantId,
            productId,
            title: "Base",
            identifiers: { state: "observed", sku: "SYNTHETIC", barcode },
            price: { amountCents: 1200, currencyCode: "USD" },
            availability: {
              state: "unknown",
              availableForSale: true,
              currentlyNotInStock: false,
              quantityAvailable: null,
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
        after: null,
      },
      selectedVariantId: null,
      productPath: "/shop/" + current.product.handle,
      onlineStoreUrl: null,
    },
  };
  const deps: ShoppingScanDependencies = {
    approval: () => "approved",
    resolve: async (code) =>
      code === barcode ? { result: structuredClone(current), barcode } : null,
    product: async (_handle, approval) => {
      assert.equal(approval, "approved");
      return structuredClone(product);
    },
  };
  return { deps, current, product };
}
test("actual candidate canonicalizer saves unique UPC and rejects duplicate/foreign/changed proof", async () => {
  const p = scanDependencies();
  const match = await resolveShoppingScan(ean, "ean13", p.deps);
  assert.equal(match.canonicalCode, barcode);
  assert.equal(match.scan.selected_variant, variantId);
  assert.equal(
    (await resolveShoppingScan(match.canonicalCode, undefined, p.deps))
      .canonicalCode,
    barcode,
  );
  p.product.product.id = "gid://shopify/Product/99";
  await assert.rejects(resolveShoppingScan(ean, "ean13", p.deps), /not_found/);
});
test("approved product recheck rejects changed price, current barcode, missing publication and unavailable variants", async () => {
  const p = scanDependencies();
  p.product.product.variants.nodes[0].price.amountCents = 1300;
  await assert.rejects(
    resolveShoppingScan(barcode, undefined, p.deps),
    /scan_price_changed_review_required/,
  );
  p.product.product.variants.nodes[0].price.amountCents = 1200;
  p.product.product.variants.nodes[0].identifiers.barcode = "CHANGED";
  await assert.rejects(
    resolveShoppingScan(barcode, undefined, p.deps),
    /invalid_provider_data/,
  );
  p.product.product.variants.nodes[0].identifiers.barcode = barcode;
  p.product.product.variants.nodes[0].availability.availableForSale = false;
  assert.equal(
    (await resolveShoppingScan(barcode, undefined, p.deps)).scan.availability
      .variants[0].available,
    false,
  );
  p.deps.product = async () => {
    throw new AccessError(404, "not_found");
  };
  await assert.rejects(
    resolveShoppingScan(barcode, undefined, p.deps),
    /not_found/,
  );
});
test("canonicalization cannot hide mapped proof failures behind the alternate code", async () => {
  const p = scanDependencies();
  p.deps.resolve = async (code) => {
    if (code === ean) throw new AccessError(409, "invalid_provider_data");
    return { result: structuredClone(p.current), barcode };
  };
  await assert.rejects(
    resolveShoppingScan(ean, "ean13", p.deps),
    /invalid_provider_data/,
  );
});

test("fresh product-level unavailability blocks Add despite still-available variant flags", async () => {
  const p = setup(),
    proof = scanDependencies();
  const service = new ShoppingCartService(
    p.store,
    async (code) =>
      (await resolveShoppingScan(code, undefined, proof.deps)).scan,
    false,
  );
  p.deps.service = () => service;
  const opened = await p.start(),
    token = opened.sessionToken!;
  proof.product.product.availableForSale = false;
  assert.equal(
    proof.product.product.variants.nodes[0].availability.availableForSale,
    true,
  );
  await error(await p.send(add(1), token), 409, "quantity_unavailable");
  const unchanged = await p.read(await p.send({ action: "read" }, token));
  assert.equal(unchanged.cart.version, 1);
  assert.equal(unchanged.cart.lines.length, 0);
});

test("missing images stay missing and private service metadata never enters the projection", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  p.current.product.image = null;
  await p.read(await p.send(add(1), token));
  const read = p.service.read.bind(p.service);
  p.service.read = async (...args) => {
    const cart = await read(...args);
    return {
      ...cart,
      privateActor: "SYNTHETIC_PRIVATE",
      lines: cart.lines.map((line) => ({
        ...line,
        internalPool: "SYNTHETIC_PRIVATE",
        stockQuantity: 3,
      })),
    };
  };
  const response = await p.read(await p.send({ action: "read" }, token));
  assert.equal(response.cart.lines[0].image, null);
  assert.equal(JSON.stringify(response).includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(JSON.stringify(response).includes("stockQuantity"), false);
});

test("unexpected provider failures are redacted and do not create a line", async () => {
  const p = setup(),
    opened = await p.start(),
    token = opened.sessionToken!;
  p.deps.canonicalCode = async () => {
    throw Error("SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD");
  };
  const failure = await p.send(add(1), token);
  assert.equal(failure.status, 503);
  const value = shoppingErrorSchema.parse(await failure.json());
  assert.equal(value.error.code, "service_unavailable");
  assert.equal(JSON.stringify(value).includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(
    (await p.read(await p.send({ action: "read" }, token))).cart.lines.length,
    0,
  );
});
