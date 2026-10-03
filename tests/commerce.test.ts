import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@northside/data";
import { Commerce, products } from "@northside/domain";
import { createHmac } from "node:crypto";
import {
  createCart,
  verifyWebhook,
  verifyPosSessionToken,
} from "@northside/shopify";
let commerce: Commerce;
let now: number;
beforeEach(() => {
  now = 1_800_000_000_000;
  commerce = new Commerce(new MemoryStore(), () => now);
});
async function basket(shared = false) {
  const s = await commerce.start(shared);
  const session = await commerce.edit(s.secret, 1, "fixture-rookie-pack", 2);
  return { ...s, session };
}
async function paid() {
  const s = await basket();
  const h = await commerce.handoff(s.secret, s.session.version);
  await commerce.claimHandoff(h.handoff!.reference, "staff");
  await commerce.fixturePayment(s.session.id, "staff");
  return s;
}
describe("commerce state machine", () => {
  it("resolves exact variants, explicit selection, collection and entry through stable maps", async () => {
    expect((await commerce.resolve("n001")).mapping).toMatchObject({
      variantId: "fixture-rookie-pack",
    });
    expect((await commerce.resolve("N002")).mapping).not.toHaveProperty(
      "variantId",
    );
    expect((await commerce.resolve("C001")).mapping.kind).toBe("collection");
    expect((await commerce.resolve("STORE")).mapping.kind).toBe("entry");
    await commerce.remap(
      "N001",
      { kind: "product", productId: "archive" },
      "operator",
    );
    expect((await commerce.resolve("N001")).mapping).toMatchObject({
      productId: "archive",
    });
  });
  it("edits/removes lines and rejects stale basket writes", async () => {
    const s = await basket();
    expect(s.session.total).toBe(1200);
    await expect(
      commerce.edit(s.secret, 1, "fixture-rookie-pack", 3),
    ).rejects.toThrow("changed");
    const updated = await commerce.edit(
      s.secret,
      s.session.version,
      "fixture-rookie-pack",
      3,
    );
    expect(updated.total).toBe(1800);
    expect(
      (await commerce.edit(s.secret, updated.version, "fixture-rookie-pack", 0))
        .lines,
    ).toHaveLength(0);
  });
  it("rejects unavailable inventory and stale price before handoff", async () => {
    const s = await basket();
    await expect(
      commerce.edit(s.secret, s.session.version, "fixture-signature-single", 1),
    ).rejects.toThrow("unavailable");
    const v = products[0].variants[0];
    const price = v.cents;
    v.cents++;
    try {
      await expect(
        commerce.handoff(s.secret, s.session.version),
      ).rejects.toThrow("price changed");
    } finally {
      v.cents = price;
    }
  });
  it("prevents a different customer from reading or modifying a session", async () => {
    const a = await basket();
    const b = await commerce.start();
    expect((await commerce.current(b.secret)).lines).toEqual([]);
    await expect(commerce.current(a.session.id)).rejects.toThrow("expired");
    await expect(
      commerce.edit(a.session.id, a.session.version, "fixture-rookie-pack", 0),
    ).rejects.toThrow("expired");
  });
  it("freezes handoffs; prevents replay and editing after claim", async () => {
    const s = await basket();
    const h = await commerce.handoff(s.secret, s.session.version);
    await expect(
      commerce.edit(s.secret, h.version, "fixture-rookie-pack", 3),
    ).rejects.toThrow("frozen");
    await commerce.claimHandoff(h.handoff!.code, "staff");
    await expect(
      commerce.claimHandoff(h.handoff!.reference, "staff"),
    ).rejects.toThrow("already");
    await expect(commerce.revokeHandoff(s.secret)).rejects.toThrow("already");
  });
  it("expires handoffs and permits controlled unclaimed restart", async () => {
    const s = await basket();
    const h = await commerce.handoff(s.secret, s.session.version);
    now += 600_001;
    await expect(
      commerce.claimHandoff(h.handoff!.reference, "staff"),
    ).rejects.toThrow("expired");
    const resumed = await commerce.revokeHandoff(s.secret);
    expect(resumed.phase).toBe("shopping");
    await expect(commerce.inspectHandoff(h.handoff!.code)).rejects.toThrow(
      "not found",
    );
  });
  it("allows only one concurrent claim and one collection", async () => {
    const s = await basket();
    const h = await commerce.handoff(s.secret, s.session.version);
    const claims = await Promise.allSettled([
      commerce.claimHandoff(h.handoff!.code, "a"),
      commerce.claimHandoff(h.handoff!.code, "b"),
    ]);
    expect(claims.filter((c) => c.status === "fulfilled")).toHaveLength(1);
    await commerce.fixturePayment(s.session.id, "staff");
    await commerce.transition(s.session.id, "ready", "staff");
    const current = await commerce.current(s.secret);
    const results = await Promise.allSettled([
      commerce.transition(
        s.session.id,
        "collected",
        "a",
        current.collectionCode,
      ),
      commerce.transition(
        s.session.id,
        "collected",
        "b",
        current.collectionCode,
      ),
    ]);
    expect(results.filter((c) => c.status === "fulfilled")).toHaveLength(1);
  });
  it("keeps payment and collection separate and requires the collection code", async () => {
    const unpaid = await basket();
    await expect(
      commerce.transition(unpaid.session.id, "ready", "staff"),
    ).rejects.toThrow("Payment");
    const s = await paid();
    const current = await commerce.current(s.secret);
    expect(current.phase).toBe("paid_awaiting_preparation");
    await expect(
      commerce.transition(
        s.session.id,
        "collected",
        "staff",
        current.collectionCode,
      ),
    ).rejects.toThrow("ready");
    await commerce.transition(s.session.id, "ready", "staff");
    await expect(
      commerce.transition(s.session.id, "collected", "staff", "wrong"),
    ).rejects.toThrow("matching");
    expect(
      (
        await commerce.transition(
          s.session.id,
          "collected",
          "staff",
          current.collectionCode,
        )
      ).phase,
    ).toBe("collected");
  });
  it("expires shared iPads server side and reset revokes the old cookie without losing paid staff records", async () => {
    const s = await basket(true);
    now += 180_001;
    await expect(commerce.current(s.secret)).rejects.toThrow("expired");
    const next = await commerce.reset(s.secret, true);
    expect(next.session.lines).toEqual([]);
    await expect(commerce.current(s.secret)).rejects.toThrow("expired");
    const p = await paid();
    await commerce.reset(p.secret, true);
    expect(
      (await commerce.queue()).some((q) => q.id === p.session.id && q.payment),
    ).toBe(true);
  });
  it("deduplicates trusted membership ledger events and allows one exact refund reversal", async () => {
    const input = {
      memberId: "member",
      eventId: "verified-order:1",
      orderId: "order:1",
      points: 10,
    };
    await expect(commerce.ledgerEvent(input, false)).rejects.toThrow("trusted");
    const e = await commerce.ledgerEvent(input, true);
    expect(await commerce.ledgerEvent(input, true)).toEqual(e);
    const reverse = {
      ...input,
      eventId: "refund:1",
      points: -10,
      reversalOf: e.id,
    };
    expect((await commerce.ledgerEvent(reverse, true)).points).toBe(-10);
    expect(await commerce.ledgerEvent(reverse, true)).toEqual(
      await commerce.ledgerEvent(reverse, true),
    );
    await expect(
      commerce.ledgerEvent({ ...reverse, eventId: "refund:2" }, true),
    ).rejects.toThrow("already");
  });
});
describe("Shopify boundaries (mock network, no live orders)", () => {
  it("authenticates the exact raw webhook bytes and rejects malformed signatures", () => {
    const raw = Buffer.from('{"paid":true}');
    const signature = createHmac("sha256", "secret")
      .update(raw)
      .digest("base64");
    expect(verifyWebhook(raw, signature, "secret")).toBe(true);
    expect(verifyWebhook(Buffer.from("{}"), signature, "secret")).toBe(false);
    expect(verifyWebhook(raw, "invalid", "secret")).toBe(false);
  });
  it("uses Storefront cartCreate and rejects warnings instead of silently accepting changed inventory", async () => {
    let sent: any;
    const config = {
      domain: "example.myshopify.com",
      version: "2026-07",
      storefrontToken: "server-secret",
      adminToken: "",
      webhookSecret: "",
    };
    const fetcher = async (_url: any, init: any) => {
      sent = JSON.parse(init.body);
      return Response.json({
        data: {
          cartCreate: {
            cart: {
              id: "cart",
              checkoutUrl: "https://example.myshopify.com/checkout",
            },
            userErrors: [],
            warnings: [],
          },
        },
      });
    };
    const result = await createCart(
      config,
      [{ variantId: "gid://shopify/ProductVariant/1", quantity: 2 }],
      "correlation",
      fetcher as typeof fetch,
    );
    expect(result.url).toContain("https://");
    expect(sent.variables.input.lines[0].merchandiseId).toContain(
      "ProductVariant",
    );
    expect(sent.variables.input.attributes[0].key).toBe("_northside_reference");
    await expect(
      createCart(
        config,
        [{ variantId: "fixture", quantity: 1 }],
        "ref",
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("validated");
  });
  it("validates POS token audience, shop destination and expiry", () => {
    const encode = (x: unknown) =>
      Buffer.from(JSON.stringify(x)).toString("base64url");
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({
      aud: "app",
      dest: "https://example.myshopify.com",
      exp: 200,
      nbf: 10,
      sub: "staff",
    });
    const sig = createHmac("sha256", "secret")
      .update(`${header}.${payload}`)
      .digest("base64url");
    const jwt = `${header}.${payload}.${sig}`;
    expect(
      verifyPosSessionToken(jwt, "secret", "app", "example.myshopify.com", 100)
        .sub,
    ).toBe("staff");
    expect(() =>
      verifyPosSessionToken(
        jwt,
        "secret",
        "wrong",
        "example.myshopify.com",
        100,
      ),
    ).toThrow("Invalid");
    expect(() =>
      verifyPosSessionToken(jwt, "secret", "app", "example.myshopify.com", 201),
    ).toThrow("expired");
  });
});

describe("retention and verified payment events", () => {
  it("bounds session creation and prunes expired unused baskets", async () => {
    for (let i = 0; i < 120; i++) await commerce.start();
    await expect(commerce.start()).rejects.toMatchObject({ status: 429 });
    now += 86_400_001;
    expect((await commerce.start()).session.lines).toEqual([]);
  });
  it("deduplicates paid events and holds adjusted, unpaid or second orders for reconciliation", async () => {
    const store = new MemoryStore();
    const rehearsal = new Commerce(store, () => now, true);
    const s = await rehearsal.start();
    const edited = await rehearsal.edit(s.secret, 1, "fixture-rookie-pack", 1);
    const handoff = await rehearsal.handoff(s.secret, edited.version);
    const claimed = await rehearsal.claimHandoff(
      handoff.handoff!.code,
      "staff",
    );
    const liveBoundary = new Commerce(store, () => now, false);
    const order = {
      id: "gid://shopify/Order/1",
      reference: claimed.paymentReference,
      paid: true,
      lines: [{ variantId: "fixture-rookie-pack", quantity: 1 }],
    };
    await expect(
      liveBoundary.verifiedPayment("not-paid", { ...order, paid: false }),
    ).rejects.toThrow("not verified");
    await expect(
      liveBoundary.verifiedPayment("adjusted", {
        ...order,
        lines: [{ variantId: "fixture-rookie-pack", quantity: 2 }],
      }),
    ).rejects.toThrow("differ");
    expect(await liveBoundary.verifiedPayment("paid", order)).toEqual({
      duplicate: false,
    });
    expect(await liveBoundary.verifiedPayment("paid", order)).toEqual({
      duplicate: true,
    });
    expect(await liveBoundary.verifiedPayment("redelivery", order)).toEqual({
      duplicate: true,
    });
    await expect(
      liveBoundary.verifiedPayment("second-order", {
        ...order,
        id: "gid://shopify/Order/2",
      }),
    ).rejects.toThrow("second order");
    expect((await rehearsal.current(s.secret)).phase).toBe(
      "paid_awaiting_preparation",
    );
    await expect(
      liveBoundary.fixturePayment(s.session.id, "staff"),
    ).rejects.toThrow("disabled");
  });
  it("rejects Storefront removed-line warnings", async () => {
    const config = {
      domain: "example.myshopify.com",
      version: "2026-07",
      storefrontToken: "test-token",
      adminToken: "",
      webhookSecret: "",
    };
    const fetcher = async () =>
      Response.json({
        data: {
          cartCreate: {
            cart: {
              id: "cart",
              checkoutUrl: "https://example.myshopify.com/checkout",
            },
            userErrors: [],
            warnings: [{ message: "Merchandise is out of stock." }],
          },
        },
      });
    await expect(
      createCart(
        config,
        [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
        "ref",
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("changed or rejected");
  });
});
