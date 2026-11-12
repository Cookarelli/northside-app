import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { MemoryStore, login, requireRole } from "@northside/data";
import {
  shoppingHttp,
  type ShoppingDependencies,
} from "../lib/server/shopping-http";
import { ShoppingCartService } from "../lib/server/shopping-cart";
import { resolveScan } from "../lib/server/store";
import { AccessError } from "../lib/server/security";
import { TENANT } from "../lib/server/providers";
import type { Sql } from "../lib/server/db";
import { GET, POST, DELETE } from "../app/api/shopping/route";
const originalEnv = { ...process.env },
  originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("External network prohibited");
};
Object.assign(process.env, {
  SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString("base64"),
  STAFF_PASSWORD: "local-fixture-password-at-least-20",
  NODE_ENV: "test",
  NORTHSIDE_FIXTURES: "1",
});
test.after(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
});
const base = "http://127.0.0.1:3104";
function request(body?: object, cookie = "", origin = base) {
  return new Request(base + "/api/shopping", {
    method: body ? "POST" : "GET",
    headers: { origin, cookie, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
test("real registry → scanner HTTP → encrypted list → authenticated staff → revoked handoff, with no provider/network access", async () => {
  const db = await PGlite.create(),
    store = new MemoryStore();
  try {
    for (const name of [
      "202609120001_identity_and_records.sql",
      "202609120003_commerce.sql",
      "202609120008_store.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    const product = "00000000-0000-4000-8000-000000008001",
      location = "00000000-0000-4000-8000-000000008020",
      qr = "A".repeat(24);
    await db.query(
      "insert into ns.store_products(tenant_id,id,shopify_product_id,title,family,handle,fixture) values($1,$2,'gid://shopify/Product/8001','SAMPLE box','SAMPLE','sample-box',true)",
      [TENANT, product],
    );
    await db.query(
      "insert into ns.store_locations(tenant_id,id,pool,label,approved_retail) values($1,$2,'retail','SAMPLE display',true)",
      [TENANT, location],
    );
    for (const [n, sku] of [
      [8030, "SAMPLE-BOX-BASE"],
      [8031, "SAMPLE-BOX-SOLDOUT"],
    ] as const) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      await db.query(
        "insert into ns.store_variants(tenant_id,id,product_id,shopify_variant_id,sku,barcode,verified,evidence) values($1,$2,$3,$4,$5,$5,true,'SAMPLE test only')",
        [TENANT, id, product, `gid://shopify/ProductVariant/${n}`, sku],
      );
      await db.query(
        "insert into ns.store_assignments(tenant_id,variant_id,location_id) values($1,$2,$3)",
        [TENANT, id, location],
      );
    }
    await db.query(
      "insert into ns.store_qr(tenant_id,token,product_id,destination) values($1,$2,$3,'product')",
      [TENANT, qr, product],
    );
    const resolve = (code: string) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role northside_runtime");
        return resolveScan(tx as unknown as Sql, code, "sample");
      });
    const service = new ShoppingCartService(store, resolve, true);
    const deps: ShoppingDependencies = {
      gate: () => {},
      sameOrigin: (r) => {
        if (r.headers.get("origin") !== base)
          throw new AccessError(403, "invalid_origin");
      },
      service: () => service,
      owner: async () => ({ tenant: TENANT, customerId: null }),
      resolve,
      token: (r) =>
        r.headers.get("cookie")?.match(/shopping=([^;]+)/)?.[1] || "",
      remember: (response, token) =>
        response.headers.set(
          "set-cookie",
          `shopping=${token}; HttpOnly; SameSite=Lax; Path=/`,
        ),
      staff: async (r) => {
        try {
          await requireRole(r, "staff", store);
          return TENANT;
        } catch {
          throw new AccessError(401, "staff_sign_in_required");
        }
      },
    };
    const call = (body?: object, cookie = "", origin = base) =>
      shoppingHttp(request(body, cookie, origin), deps);
    assert.equal(
      (await call({ action: "start" }, "", "https://foreign.invalid")).status,
      403,
    );
    const started = await call({ action: "start" }),
      cookie = started.headers.get("set-cookie")!.split(";")[0];
    assert.ok(started.headers.get("cache-control")?.includes("no-store"));
    assert.match(started.headers.get("set-cookie")!, /HttpOnly/);
    const initial = await started.json();
    assert.equal(
      (await call({ action: "resolve", code: "00000000" })).status,
      404,
    );
    assert.equal(
      (await call({ action: "resolve", code: "https://foreign.invalid/q/abc" }))
        .status,
      400,
    );
    const resolved = await (
      await call({ action: "resolve", code: "SAMPLE-BOX-BASE" })
    ).json();
    assert.equal(
      resolved.selected_variant,
      "gid://shopify/ProductVariant/8030",
    );
    assert.equal(resolved.product.image.url, "/shopping-sample.svg");
    const productQR = await (
      await call({
        action: "resolve",
        code: "http://127.0.0.1:3000/q/sample/" + qr,
      })
    ).json();
    assert.equal(productQR.selected_variant, null);
    const soldout = {
      action: "add",
      code: "SAMPLE-BOX-SOLDOUT",
      version: initial.version,
      variantId: "gid://shopify/ProductVariant/8031",
      reviewedPriceCents: 1200,
    };
    assert.equal((await call(soldout, cookie)).status, 409);
    const add = {
      ...soldout,
      code: "SAMPLE-BOX-BASE",
      variantId: "gid://shopify/ProductVariant/8030",
    };
    const added = await (await call(add, cookie)).json();
    assert.equal(added.subtotalCents, 1200);
    assert.equal((await call(add, cookie)).status, 409); // Lost-response retry fenced.
    const changed = await (
      await call(
        {
          action: "set",
          version: added.version,
          variantId: add.variantId,
          quantity: 2,
        },
        cookie,
      )
    ).json();
    assert.equal(changed.subtotalCents, 2400);
    const ready = await (
      await call({ action: "ready", version: changed.version }, cookie)
    ).json();
    assert.equal(ready.paymentStatus, "unpaid");
    assert.match(ready.qr, /^data:image\/png;base64,/);
    assert.equal(
      (await (await call({ action: "start" }, cookie)).json()).qr,
      ready.qr,
    ); // Reload preserves QR.
    assert.equal(
      (await call({ action: "inspect", reference: ready.handoff.reference }))
        .status,
      401,
    );
    const staffLogin = await login(
      new Request(base + "/api/in-store/staff/login", {
        method: "POST",
        headers: { origin: base, "content-type": "application/json" },
        body: JSON.stringify({ password: process.env.STAFF_PASSWORD }),
      }),
      "staff",
      store,
    );
    const staffCookie = staffLogin.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await call(
          { action: "inspect", reference: ready.handoff.reference },
          staffCookie,
        )
      ).status,
      200,
    );
    await call({ action: "cancel", version: ready.version }, cookie);
    assert.equal(
      (
        await call(
          { action: "inspect", reference: ready.handoff.reference },
          staffCookie,
        )
      ).status,
      404,
    );
    const removed = await (
      await call(
        {
          action: "set",
          version: ready.version + 1,
          variantId: add.variantId,
          quantity: 0,
        },
        cookie,
      )
    ).json();
    assert.equal(removed.lines.length, 0);
  } finally {
    await db.close();
  }
});
test("actual route rejects production fixtures and inactive scans before persistence/providers; client identity cannot grant staff access", async () => {
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal((await GET(request())).status, 404);
  assert.equal((await POST(request({ action: "start" }))).status, 404);
  assert.equal(
    (
      await DELETE(
        new Request(base + "/api/shopping", {
          method: "DELETE",
          headers: { origin: base },
        }),
      )
    ).status,
    404,
  );
  Object.assign(process.env, { NODE_ENV: "test" });
  const forged = new Request(base + "/api/shopping?actor=staff", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action: "inspect", reference: "A".repeat(43) }),
  });
  assert.equal((await POST(forged)).status, 401);
  assert.equal(
    (await POST(request({ action: "start" }, "", "https://foreign.invalid")))
      .status,
    403,
  );
});
