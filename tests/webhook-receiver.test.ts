import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";
import {
  API_VERSION,
  SHOP,
  handle,
  verify,
  type Receipt,
} from "../apps/webhooks/lib/receiver";
import { configuration, receiveOn } from "../apps/webhooks/lib/inbox";
const secret = "synthetic-test-secret-never-deployed";
const env = {
  WEBHOOK_RECEIVER_MODE: "pilot-inbox",
  SHOPIFY_APP_CLIENT_SECRET: secret,
};
const body = JSON.stringify({
  admin_graphql_api_id: "gid://shopify/Order/123",
  test: true,
  email: "do-not-persist@example.invalid",
});
function request(raw = body, overrides: Record<string, string> = {}) {
  return new Request("https://receiver.invalid/api/shopify/webhooks", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": createHmac("sha256", secret)
        .update(raw)
        .digest("base64"),
      "x-shopify-shop-domain": SHOP,
      "x-shopify-api-version": API_VERSION,
      "x-shopify-topic": "orders/paid",
      "x-shopify-webhook-id": "5eb715a1-a241-45bc-b4b2-1aa3d3ce649a",
      ...overrides,
    },
  });
}
describe("isolated Shopify pilot ingress", () => {
  it("authenticates exact bytes, persists metadata only, acknowledges after persistence", async () => {
    const save = vi.fn(async (r: Receipt) => {
      expect(r.test).toBe(true);
      expect(JSON.stringify(r)).not.toContain("email");
    });
    const r = await handle(request(), save, env);
    expect(r.status).toBe(200);
    expect(save).toHaveBeenCalledOnce();
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.json()).toEqual({ received: true, mode: "pilot-inbox" });
  });
  it.each(["", "invalid", "A".repeat(43) + "="])(
    "rejects bad signature %s before database access",
    async (signature) => {
      const save = vi.fn();
      expect(
        (
          await handle(
            request("{bad-json", { "x-shopify-hmac-sha256": signature }),
            save,
            env,
          )
        ).status,
      ).toBe(401);
      expect(save).not.toHaveBeenCalled();
    },
  );
  it("rejects altered signed bytes", async () => {
    const signature = request().headers.get("x-shopify-hmac-sha256")!;
    expect(
      (
        await handle(
          request(body + " ", { "x-shopify-hmac-sha256": signature }),
          vi.fn(),
          env,
        )
      ).status,
    ).toBe(401);
  });
  it.each([
    ["x-shopify-shop-domain", "other.myshopify.com", 403],
    ["x-shopify-api-version", "2025-01", 400],
    ["x-shopify-topic", "orders/create", 400],
    ["x-shopify-webhook-id", "missing", 400],
    ["content-type", "text/plain", 415],
    ["content-encoding", "gzip", 415],
    ["content-length", "1048577", 413],
  ])(
    "rejects invalid routing/content header %s",
    async (name, value, status) => {
      const save = vi.fn();
      expect(
        (await handle(request(body, { [name]: String(value) }), save, env))
          .status,
      ).toBe(status);
      expect(save).not.toHaveBeenCalled();
    },
  );
  it("bounds unannounced bytes and stalled streams", async () => {
    expect(
      (await handle(request("x".repeat(1048577)), vi.fn(), env)).status,
    ).toBe(413);
    const slow = new Request("https://receiver.invalid", {
      method: "POST",
      body: new ReadableStream(),
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    expect((await handle(slow, vi.fn(), env)).status).toBe(408);
  });
  it.each([
    "[]",
    "null",
    "{bad-json",
    '{"admin_graphql_api_id":9007199254740993}',
    '{"admin_graphql_api_id":"gid://shopify/Customer/1"}',
  ])("rejects invalid signed payload %s", async (raw) => {
    expect((await handle(request(raw), vi.fn(), env)).status).toBe(400);
  });
  it("normalizes refund order IDs and ignores unsigned test headers", async () => {
    const r = await verify(
      request('{"order_id":"123"}', {
        "x-shopify-topic": "refunds/create",
        "x-shopify-test": "true",
      }),
      secret,
    );
    expect(r.orderId).toBe("gid://shopify/Order/123");
    expect(r.test).toBe(false);
  });
  it("does not acknowledge storage failure or print the thrown secret", async () => {
    const r = await handle(
      request(),
      async () => {
        throw Error(secret);
      },
      env,
    );
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain(secret);
  });
  it("fails closed when disabled, unconfigured or using another method", async () => {
    const save = vi.fn();
    expect((await handle(request(), save, {})).status).toBe(503);
    expect(
      (await handle(request(), save, { WEBHOOK_RECEIVER_MODE: "pilot-inbox" }))
        .status,
    ).toBe(503);
    expect(
      (await handle(new Request("https://receiver.invalid"), save, env)).status,
    ).toBe(405);
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects privileged or wrong-project database URLs and unverified TLS", () => {
    const valid = {
      WEBHOOK_DATABASE_URL:
        "postgresql://northside_webhook_receiver.nrsuosydvjqovrevmych:synthetic@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      WEBHOOK_DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----",
    };
    expect(configuration(valid).ssl).toEqual({
      rejectUnauthorized: true,
      ca: valid.WEBHOOK_DATABASE_CA_CERT,
    });
    for (const url of [
      valid.WEBHOOK_DATABASE_URL.replace(
        "northside_webhook_receiver.",
        "postgres.",
      ),
      valid.WEBHOOK_DATABASE_URL.replace("nrsuosydvjqovrevmych", "wrong"),
      valid.WEBHOOK_DATABASE_URL.replace("verify-full", "require"),
      valid.WEBHOOK_DATABASE_URL + "&host=evil.invalid",
    ])
      expect(() =>
        configuration({ ...valid, WEBHOOK_DATABASE_URL: url }),
      ).toThrow("receiver_database_not_configured");
  });
  it("enforces actual SQL isolation, exact duplicate handling and immutable metadata", async () => {
    const db = new PGlite();
    try {
      await db.exec(
        `create role anon; create role authenticated; create schema ns; create table ns.orders(id int); create schema northside_private; create table northside_private.jobs(id int);`,
      );
      await db.exec(
        readFileSync(
          new URL(
            "../supabase/migrations/20261019133518_shopify_webhook_pilot_inbox.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const state = (
        await db.query<{
          rolcanlogin: boolean;
          rolinherit: boolean;
          rolbypassrls: boolean;
        }>(
          "select rolcanlogin,rolinherit,rolbypassrls from pg_roles where rolname='northside_webhook_receiver'",
        )
      ).rows[0];
      expect(state).toEqual({
        rolcanlogin: false,
        rolinherit: false,
        rolbypassrls: false,
      });
      for (const role of ["anon", "authenticated"]) {
        await db.exec("set role " + role);
        await expect(
          db.query("select * from ns_webhook_pilot.receipts"),
        ).rejects.toThrow();
        await db.exec("reset role");
      }
      await db.exec("set session authorization northside_webhook_receiver");
      const r = await verify(request(), secret);
      expect(await receiveOn(db, r)).toEqual({ duplicate: false });
      expect(await receiveOn(db, r)).toEqual({ duplicate: true });
      for (const changed of [
        { bodyHash: "a".repeat(64) },
        { topic: "orders/updated" as const },
        { orderId: "gid://shopify/Order/124" },
        { test: false },
      ])
        await expect(receiveOn(db, { ...r, ...changed })).rejects.toThrow(
          "delivery_conflict",
        );
      expect(
        (await db.query("select * from ns_webhook_pilot.receipts")).rows,
      ).toHaveLength(1);
      for (const sql of [
        "select * from ns.orders",
        "select * from northside_private.jobs",
        "delete from ns_webhook_pilot.receipts",
        "update ns_webhook_pilot.receipts set is_test=false",
        "set role postgres",
        "insert into ns_webhook_pilot.receipts(shop,delivery_id,topic,order_id,api_version,body_hash,is_test,received_at) values('9i3hnb-jw.myshopify.com','5eb715a1-a241-45bc-b4b2-1aa3d3ce649b','orders/paid','gid://shopify/Order/1','2026-07',repeat('a',64),true,now())",
      ])
        await expect(db.exec(sql)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
