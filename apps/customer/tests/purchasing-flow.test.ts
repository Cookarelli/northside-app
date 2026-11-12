import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { type Actor, type Sql, authorizeOn } from "../lib/server/db";
import { SHOP, TENANT } from "../lib/server/providers";
import {
  prepareCartOn,
  cartOn,
  runSavedCart,
} from "../lib/server/cart-session";
import {
  addLine,
  updateLine,
  checkout,
  cartView,
  type Query,
} from "../lib/server/storefront";
import {
  bindCustomer,
  ownedOrders,
  verifiedBuyerId,
} from "../lib/server/customer-commerce";
import { createSession } from "../lib/server/sessions";
import {
  verifyDelivery,
  receiveOn,
  claimOn,
  reconcileOn,
  failOn,
} from "../lib/server/order-jobs";
import { fetchOrder, type OrderSnapshot } from "../lib/server/admin-shopify";
import { hashToken } from "../lib/server/security";
import { publicFlags } from "../lib/policy.mjs";
import type { Cart, Variant } from "../lib/commerce";

// Joined service + real SQL/RLS acceptance. All Shopify replies and signatures
// below are SYNTHETIC; no env files, hosted DB, payment or provider network.
process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Network prohibited in purchasing acceptance");
};
const db = await PGlite.create(),
  sql = db as unknown as Sql;
for (const file of [
  "202609120001_identity_and_records.sql",
  "202609120003_commerce.sql",
  "20261029133844_commerce_delivery_integrity.sql",
])
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
test.after(async () => {
  globalThis.fetch = originalFetch;
  await db.close();
});
async function tx<T>(
  role: "auth" | "commerce" | "runtime",
  fn: (s: Sql) => Promise<T>,
) {
  await db.exec(`begin; set local role northside_${role}`);
  try {
    const value = await fn(sql);
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const customerA = randomUUID(),
  customerB = randomUUID();
for (const id of [customerA, customerB])
  await db.query("insert into ns.customers(tenant_id,id) values($1,$2)", [
    TENANT,
    id,
  ]);
function actor(id: string): Actor {
  return {
    tenant_id: TENANT,
    customer_id: id,
    staff_id: null,
    staff_role: null,
  };
}
const session = async (id: string) =>
  tx("auth", (s) =>
    createSession(
      s,
      { customerId: id },
      "shopify",
      { access_token: "SYNTHETIC", subject: id },
      3600,
    ),
  );
const sessionA = await session(customerA),
  sessionB = await session(customerB);
const money = { amount: "12.50", currencyCode: "USD" };
const variant: Variant = {
  id: "gid://shopify/ProductVariant/123",
  title: "SYNTHETIC",
  availableForSale: true,
  currentlyNotInStock: false,
  quantityAvailable: 5,
  price: money,
};
const pageInfo = { hasNextPage: false, endCursor: null };
function provider() {
  const current: Cart = {
    id: "gid://shopify/Cart/SYNTHETIC?key=PRIVATE_CART",
    totalQuantity: 0,
    discountCodes: [],
    cost: {
      subtotalAmount: money,
      totalAmount: money,
      totalAmountEstimated: true,
    },
    lines: { nodes: [], pageInfo },
    checkoutUrl: "https://checkout-test.myshopify.com/checkouts/SYNTHETIC",
  };
  const controls = {
    expired: false,
    missing: false,
    loseBuyerResponse: false,
    reprice: false,
    missingLine: false,
  };
  const calls: { document: string; variables: Record<string, unknown> }[] = [];
  let buyer: unknown = null;
  const query: Query = async <T>(document: string, variables: object) => {
    const v = variables as Record<string, unknown>;
    calls.push({ document, variables: v });
    if (document.includes("query Availability"))
      return { node: controls.missing ? null : variant } as T;
    if (document.includes("query Cart"))
      return { cart: controls.expired ? null : structuredClone(current) } as T;
    const operation = document.match(/^mutation (\w+)/)?.[1];
    if (operation === "cartCreate") {
      assert.deepEqual(v.input, { buyerIdentity: { countryCode: "US" } });
    } else if (operation === "cartLinesAdd") {
      const line = (v.lines as { quantity: number }[])[0];
      current.lines.nodes = [
        {
          id: "PRIVATE_LINE",
          quantity: line.quantity,
          merchandise: {
            ...variant,
            product: { title: "SYNTHETIC", handle: "sample" },
          },
          cost: { totalAmount: money },
        },
      ];
      current.totalQuantity = line.quantity;
    } else if (operation === "cartLinesUpdate") {
      current.lines.nodes[0].quantity = (
        v.lines as { quantity: number }[]
      )[0].quantity;
    } else if (operation === "cartLinesRemove") current.lines.nodes = [];
    else if (operation === "cartBuyerIdentityUpdate") {
      buyer = v.buyer;
      if (controls.loseBuyerResponse)
        throw Error("SYNTHETIC lost response after provider applied buyer");
      if (controls.reprice)
        current.cost.totalAmount = { amount: "13.50", currencyCode: "USD" };
    } else throw Error(`Unexpected synthetic operation: ${operation}`);
    const responseCart = structuredClone(current);
    if (controls.missingLine && responseCart.lines.nodes.length)
      responseCart.lines.nodes[0].merchandise =
        null as unknown as (typeof responseCart.lines.nodes)[0]["merchandise"];
    return {
      [operation]: { cart: responseCart, userErrors: [], warnings: [] },
    } as T;
  };
  return {
    query,
    controls,
    calls,
    get buyer() {
      return buyer;
    },
  };
}
const mappingQuery: Query = async <T>(document: string, variables: object) => {
  assert.equal(document, "query CheckoutBuyer { customer { id } }");
  assert.deepEqual(variables, {});
  return { customer: { id: "gid://shopify/Customer/123" } } as T;
};
async function operation<T>(
  handle: string,
  owner: string | null,
  fn: (id: string) => Promise<T>,
) {
  return tx("commerce", async (s) =>
    fn((await cartOn(s, handle, owner)).cartId),
  );
}

test("guest cart becomes durably customer-bound before a lost buyer response; another customer/guest never reaches Shopify", async () => {
  const p = provider();
  const saved = await tx("commerce", (s) =>
    prepareCartOn(s, p.query, undefined, null, { create: true, bind: false }),
  );
  await operation(saved.handle, null, (id) =>
    addLine(p.query, id, variant.id, 1),
  );
  const verified = await verifiedBuyerId(mappingQuery);
  await tx("auth", (s) => bindCustomer(s, actor(customerA), verified));
  let committed = 0;
  const transact = async <T>(fn: (s: Sql) => Promise<T>) => {
    const value = await tx("commerce", fn);
    committed++;
    return value;
  };
  p.controls.loseBuyerResponse = true;
  await assert.rejects(
    runSavedCart(
      transact,
      p.query,
      saved.handle,
      customerA,
      { create: false, bind: true },
      () => {},
      (id) => {
        assert.equal(
          committed,
          1,
          "binding must be committed before buyer-bearing provider work",
        );
        return checkout(p.query, id, "SYNTHETIC_BUYER_TOKEN", [
          "checkout-test.myshopify.com",
        ]);
      },
    ),
    /lost response/,
  );
  assert.deepEqual(p.buyer, {
    countryCode: "US",
    customerAccessToken: "SYNTHETIC_BUYER_TOKEN",
  });
  const before = p.calls.length;
  for (const other of [null, customerB])
    await assert.rejects(
      runSavedCart(
        transact,
        p.query,
        saved.handle,
        other,
        { create: false, bind: true },
        () => {},
        (id) =>
          checkout(p.query, id, undefined, ["checkout-test.myshopify.com"]),
      ),
      /cart_owner_mismatch/,
    );
  assert.equal(p.calls.length, before);
  const stored = (
    await db.query<{ encrypted_cart: string; customer_id: string }>(
      "select encrypted_cart,customer_id from ns.commerce_carts where token_hash=$1",
      [hashToken(saved.handle)],
    )
  ).rows[0];
  assert.equal(stored.customer_id, customerA);
  assert.ok(!stored.encrypted_cart.includes("PRIVATE_CART"));
  p.controls.loseBuyerResponse = false;
  assert.equal(
    await operation(saved.handle, customerA, (id) =>
      checkout(p.query, id, "SYNTHETIC_BUYER_TOKEN", [
        "checkout-test.myshopify.com",
      ]),
    ),
    "https://checkout-test.myshopify.com/checkouts/SYNTHETIC",
  );
  assert.equal(
    (await db.query("select * from ns.shopify_orders")).rows.length,
    0,
    "checkout URL is not payment evidence",
  );
});

test("cart quantity/update/remove, missing variants, provider/local expiry and buyer repricing fail safely", async () => {
  const p = provider();
  const saved = await tx("commerce", (s) =>
    prepareCartOn(s, p.query, undefined, customerA, {
      create: true,
      bind: true,
    }),
  );
  p.controls.missing = true;
  await assert.rejects(
    operation(saved.handle, customerA, (id) =>
      addLine(p.query, id, variant.id, 1),
    ),
    /quantity_unavailable/,
  );
  p.controls.missing = false;
  const added = cartView(
    await operation(saved.handle, customerA, (id) =>
      addLine(p.query, id, variant.id, 1),
    ),
  );
  assert.ok(!JSON.stringify(added).includes("PRIVATE_"));
  assert.equal(
    (
      await operation(saved.handle, customerA, (id) =>
        updateLine(p.query, id, added.lines.nodes[0].id, 2),
      )
    ).lines.nodes[0].quantity,
    2,
  );
  p.controls.reprice = true;
  await assert.rejects(
    operation(saved.handle, customerA, (id) =>
      checkout(p.query, id, "SYNTHETIC", ["checkout-test.myshopify.com"]),
    ),
    /cart_changed_review_required/,
  );
  p.controls.reprice = false;
  p.controls.missingLine = true;
  await assert.rejects(
    operation(saved.handle, customerA, (id) =>
      checkout(p.query, id, "SYNTHETIC", ["checkout-test.myshopify.com"]),
    ),
    /cart_changed_review_required/,
  );
  p.controls.missingLine = false;
  await operation(saved.handle, customerA, (id) =>
    updateLine(p.query, id, added.lines.nodes[0].id, 0),
  );
  await assert.rejects(
    operation(saved.handle, customerA, (id) =>
      checkout(p.query, id, "SYNTHETIC", ["checkout-test.myshopify.com"]),
    ),
    /cart_empty/,
  );
  p.controls.expired = true;
  await assert.rejects(
    operation(saved.handle, customerA, (id) =>
      addLine(p.query, id, variant.id, 1),
    ),
    /cart_expired/,
  );
  await db.query(
    "update ns.commerce_carts set expires_at=now()-interval '1 second' where token_hash=$1",
    [hashToken(saved.handle)],
  );
  const before = p.calls.length;
  await assert.rejects(
    operation(saved.handle, customerA, (id) =>
      addLine(p.query, id, variant.id, 1),
    ),
    /cart_expired/,
  );
  assert.equal(p.calls.length, before);
});

const order: OrderSnapshot = {
  id: "gid://shopify/Order/123",
  test: false,
  customerId: "gid://shopify/Customer/123",
  name: "SYNTHETIC ONLY",
  financialStatus: "PENDING",
  cancelledAt: null,
  updatedAt: "2026-10-29T00:00:00Z",
  currency: "USD",
  totalCents: 1250,
  receivedCents: 0,
  refundedCents: 0,
};
function signed(topic: string, delivery = randomUUID()) {
  const body = Buffer.from(
    JSON.stringify(
      topic === "refunds/create"
        ? { order_id: "123" }
        : { admin_graphql_api_id: order.id },
    ),
  );
  return verifyDelivery(
    body,
    new Headers({
      "x-shopify-shop-domain": SHOP,
      "x-shopify-api-version": "2026-07",
      "x-shopify-topic": topic,
      "x-shopify-webhook-id": delivery,
      "x-shopify-hmac-sha256": createHmac("sha256", "SYNTHETIC_SECRET")
        .update(body)
        .digest("base64"),
    }),
    "SYNTHETIC_SECRET",
  );
}
async function canonical(snapshot: OrderSnapshot) {
  const bag = (value: number) => ({
    shopMoney: { amount: (value / 100).toFixed(2), currencyCode: "USD" },
  });
  const query: Query = async <T>() =>
    ({
      order: {
        id: snapshot.id,
        test: snapshot.test,
        customer: snapshot.customerId ? { id: snapshot.customerId } : null,
        name: snapshot.name,
        displayFinancialStatus: snapshot.financialStatus,
        cancelledAt: snapshot.cancelledAt,
        updatedAt: snapshot.updatedAt,
        currentTotalPriceSet: bag(snapshot.totalCents),
        totalReceivedSet: bag(snapshot.receivedCents),
        totalRefundedSet: bag(snapshot.refundedCents),
      },
    }) as T;
  return fetchOrder(query, snapshot.id);
}
async function view(token: string) {
  return tx("runtime", async (s) =>
    ownedOrders(s, await authorizeOn(s, token)),
  );
}

test("signed deliveries and canonical reads converge through failed payment, paid, cancellation and refund without crossing owner boundaries", async () => {
  for (const [index, status] of [
    "PENDING",
    "EXPIRED",
    "PAID",
    "VOIDED",
    "REFUNDED",
  ].entries()) {
    const snapshot = {
      ...order,
      financialStatus: status,
      updatedAt: `2026-10-29T00:0${index}:00Z`,
      receivedCents: index >= 2 ? 1250 : 0,
      refundedCents: status === "REFUNDED" ? 1250 : 0,
      cancelledAt: index >= 3 ? "2026-10-29T00:03:00Z" : null,
    };
    const event = signed(
      status === "REFUNDED"
        ? "refunds/create"
        : index === 3
          ? "orders/cancelled"
          : "orders/paid",
    );
    await tx("commerce", (s) => receiveOn(s, event));
    assert.deepEqual(await tx("commerce", (s) => receiveOn(s, event)), {
      duplicate: true,
    });
    const job = await tx("commerce", claimOn);
    assert.ok(job);
    if (index === 0) {
      await assert.rejects(
        tx("commerce", (s) =>
          reconcileOn(s, job, async () => {
            throw Error("SYNTHETIC provider failure");
          }),
        ),
      );
      await tx("commerce", (s) => failOn(s, job));
      assert.equal((await view(sessionA)).length, 0);
      await db.query(
        "update ns.order_jobs set available_at=now() where receipt_id=$1",
        [job.receipt_id],
      );
      const retry = await tx("commerce", claimOn);
      assert.ok(retry);
      await tx("commerce", (s) =>
        reconcileOn(s, retry, () => canonical(snapshot)),
      );
    } else
      await tx("commerce", (s) =>
        reconcileOn(s, job, () => canonical(snapshot)),
      );
    const visible = await view(sessionA);
    assert.equal(visible.length, 1);
    assert.equal(
      visible[0].financial_status,
      status,
      "signed orders/paid topic is not authority to mark an unpaid order paid",
    );
    assert.equal(Number(visible[0].received_cents), snapshot.receivedCents);
    assert.equal(Number(visible[0].refunded_cents), snapshot.refundedCents);
    assert.equal((await view(sessionB)).length, 0);
  }
  // A later duplicate notification reads current refund state, never its old topic's implied state.
  await tx("commerce", (s) => receiveOn(s, signed("orders/paid")));
  const job = await tx("commerce", claimOn);
  assert.ok(job);
  const finalState = {
    ...order,
    financialStatus: "REFUNDED",
    receivedCents: 1250,
    refundedCents: 1250,
    cancelledAt: "2026-10-29T00:03:00Z",
    updatedAt: "2026-10-29T00:04:00Z",
  };
  await tx("commerce", (s) => reconcileOn(s, job, () => canonical(finalState)));
  assert.equal(
    (await db.query("select * from ns.order_ledger")).rows.length,
    5,
  );
  assert.equal(publicFlags.purchases, false);
  assert.equal((await view(sessionB)).length, 0);
});

test("unsupported canonical financial states cannot become customer order evidence", async () => {
  await assert.rejects(
    canonical({ ...order, financialStatus: "SUCCESS_FROM_BROWSER" }),
    /order_state_unavailable/,
  );
});
