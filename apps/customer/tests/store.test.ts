import test from "node:test";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPreviewDatabase, previewId } from "../lib/server/grading-preview";
import { initializeStorePreview } from "../lib/server/store-preview";
import {
  storeStaff,
  saveAisle,
  saveLocation,
  saveProduct,
  saveVariant,
  saveNode,
  saveEdge,
  assignLocation,
  saveQR,
  resolveScan,
  pickupRehearsal,
  storeGate,
  qrLink,
  qrOrigin,
  productProof,
  type CatalogProof,
} from "../lib/server/store";
import { storeLabel } from "../lib/server/store-label";
import { parseScan, ScanDeduplicator } from "../lib/store";
import { TENANT } from "../lib/server/providers";
import type { Query } from "../lib/server/storefront";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
const dir = await mkdtemp(join(tmpdir(), "northside-store-")),
  f = await openPreviewDatabase(dir);
await initializeStorePreview(f);
const fail = (status: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === status;
const list = () => f.run("staff", (db, a) => storeStaff(db, a, "sample"));
const scan = (code: string) =>
  f.run("a", (db) => resolveScan(db, code, "sample"));
const token = (await list()).qrs[0].token;
test("eight editable aisles with configurable sides, nodes and connections remain a schematic", async () => {
  let d = await list();
  assert.deepEqual(
    d.aisles.map((a) => a.number),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(d.schematic, true);
  assert.equal(d.nodes.length, 3);
  const a = d.aisles[0];
  await f.run("staff", (db, actor) =>
    saveAisle(
      db,
      actor,
      a.id,
      a.version,
      {
        ...a,
        label: "SAMPLE sports cards",
        sides: ["Front", "Back"],
        x: 22,
        y: 31,
      },
      "SAMPLE relabel",
    ),
  );
  await assert.rejects(
    f.run("staff", (db, actor) =>
      saveAisle(db, actor, a.id, a.version, a, "stale"),
    ),
    fail(409),
  );
  d = await list();
  assert.equal(d.aisles[0].label, "SAMPLE sports cards");
  const used = d.aisles[1];
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveAisle(
        db,
        a,
        used.id,
        used.version,
        { ...used, sides: [] },
        "invalid removal",
      ),
    ),
    fail(409),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveNode(
        db,
        a,
        randomUUID(),
        null,
        { label: "test", kind: "path", x: 101, y: 50, active: true },
        "bad coordinate",
      ),
    ),
    fail(400),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveEdge(db, a, d.nodes[0].id, d.nodes[0].id, true, "bad loop"),
    ),
    fail(400),
  );
});
test("staff scope, read-only writes and raw customer table reads are enforced by real RLS", async () => {
  for (const who of ["a", "b", "editor"])
    await assert.rejects(
      f.run(who, (db, a) => storeStaff(db, a, "sample")),
      fail(403),
    );
  const d = await list();
  assert.equal(
    (await f.run("reader", (db, a) => storeStaff(db, a, "sample"))).qrs.length,
    1,
  );
  await assert.rejects(
    f.run("reader", (db, a) => saveQR(db, a, randomUUID(), null, {}, "bad")),
    fail(403),
  );
  for (const who of ["a", "b"])
    await f.run(who, async (db) => {
      for (const t of [
        "store_locations",
        "store_qr",
        "store_pickups",
        "store_audit",
      ])
        assert.equal((await db.query("select * from ns." + t)).rows.length, 0);
    });
  const attempted = await f.run("a", (db) =>
    db.query("update ns.store_aisles set label=$1 where id=$2 returning id", [
      "stolen",
      d.aisles[0].id,
    ]),
  );
  assert.equal(attempted.rows.length, 0);
  assert.equal((await list()).aisles[0].label, d.aisles[0].label);
});
test("customer projection excludes breaker, backstock, QR placement and nonapproved retail", async () => {
  const r = await scan(qrLink(token, "sample"));
  const text = JSON.stringify(r);
  assert.ok(text.includes("SAMPLE retail display"));
  for (const secret of [
    "private breaker",
    "private backstock",
    "placement_id",
    "8021",
    "8022",
  ])
    assert.ok(!text.includes(secret));
  assert.equal(r.selected_variant, null);
  const d = await list(),
    loc = d.locations.find((l) => l.id === previewId(8020))!;
  await f.run("staff", (db, a) =>
    saveLocation(
      db,
      a,
      loc.id,
      loc.version,
      { ...loc, approved_retail: false },
      "SAMPLE hide retail",
    ),
  );
  assert.equal(
    (await scan("SAMPLE-BOX-BASE")).product.variants[0].locations.length,
    0,
  );
  const fresh = (await list()).locations.find((l) => l.id === loc.id)!;
  await f.run("staff", (db, a) =>
    saveLocation(
      db,
      a,
      fresh.id,
      fresh.version,
      { ...fresh, approved_retail: true },
      "SAMPLE restore",
    ),
  );
  const b = d.locations.find((l) => l.pool === "breaker")!;
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveLocation(
        db,
        a,
        b.id,
        b.version,
        { ...b, approved_retail: true },
        "bad",
      ),
    ),
    fail(400),
  );
});
test("moving a product changes its approved locator while SKU, variant and printed token stay stable", async () => {
  const before = await scan("SAMPLE-BOX-BASE"),
    d = await list(),
    a = d.assignments.find((a) => a.location_id === previewId(8020))!;
  await f.run("staff", (db, actor) =>
    assignLocation(
      db,
      actor,
      a.id,
      a.version,
      a.variant_id,
      previewId(8023),
      "SAMPLE move",
    ),
  );
  const after = await scan(qrLink(token, "sample"));
  assert.equal(after.product.product_id, before.product.product_id);
  assert.deepEqual(
    after.product.variants.map((v) => v.variant_id),
    before.product.variants.map((v) => v.variant_id),
  );
  assert.ok(JSON.stringify(after).includes("SAMPLE second display"));
  assert.ok(!JSON.stringify(after).includes("SAMPLE retail display"));
  assert.equal((await list()).qrs[0].token, token);
  const q = (await list()).qrs[0];
  await f.run("staff", (db, actor) =>
    saveQR(
      db,
      actor,
      q.id,
      q.version,
      {
        ...q,
        destination: "product",
        variant_id: previewId(8030),
        campaign_key: "sample-edited",
      },
      "SAMPLE retarget",
    ),
  );
  const r = await scan(qrLink(token, "sample"));
  assert.equal(r.selected_variant, "gid://shopify/ProductVariant/8030");
  assert.equal(r.destination, "product");
  assert.equal(r.campaign_key, "sample-edited");
  await assert.rejects(
    f.db.query("update ns.store_qr set token=$1 where id=$2", [
      "a".repeat(24),
      q.id,
    ]),
    /immutable/,
  );
  await assert.rejects(
    f.db.query("update ns.store_assignments set variant_id=$1 where id=$2", [
      previewId(8031),
      a.id,
    ]),
    /immutable/,
  );
  await assert.rejects(
    f.db.query("update ns.store_locations set pool=$1 where id=$2", [
      "retail",
      previewId(8021),
    ]),
    /immutable/,
  );
});
test("parser rejects foreign, malformed, injected and opaque Shopcode inputs without fetching URLs", () => {
  const origin = "https://app.example.test";
  assert.equal(parseScan(origin + "/q/" + token, origin).kind, "qr");
  assert.equal(parseScan("SAMPLE-BOX-BASE", origin).kind, "barcode");
  for (const bad of [
    "",
    null,
    "x".repeat(2049),
    "a\n",
    "javascript:alert(1)",
    "https://evil.test/q/" + token,
    "https://app.example.test.evil.test/q/" + token,
    origin + "/q/" + token + "?next=https://evil.test",
    origin + "/q/%61" + token.slice(1),
    origin + "/q/" + token + "#x",
    "https://user@app.example.test/q/" + token,
    "https://shop.app/s/opaque",
    "https://9i3hnb-jw.myshopify.com/x/opaque",
    "https://9i3hnb-jw.myshopify.com/products/sample?variant=oops",
    "https://9i3hnb-jw.myshopify.com/products/sample?variant=",
    "https://9i3hnb-jw.myshopify.com/products/sample?variant=1&variant=2",
  ])
    assert.throws(() => parseScan(bad, origin));
  assert.equal(
    parseScan(
      "https://9i3hnb-jw.myshopify.com/products/sample?variant=2",
      origin,
    ).variant,
    "gid://shopify/ProductVariant/2",
  );
});
test("duplicate camera/manual scans are suppressed during the cooldown", () => {
  const d = new ScanDeduplicator();
  assert.equal(d.accept("same", 1000), true);
  assert.equal(d.accept("same", 1100), false);
  assert.equal(d.accept("other", 1200), true);
  assert.equal(d.accept("other", 4199), false);
  assert.equal(d.accept("other", 4200), true);
});
test("unknown codes, missing variants and unverified barcode mappings fail safely", async () => {
  await assert.rejects(scan("unregistered"), fail(404));
  await assert.rejects(
    scan(
      "https://9i3hnb-jw.myshopify.com/products/sample-basketball-box?variant=999",
    ),
    fail(409),
  );
  const d = await list(),
    v = d.variants.find((v) => v.id === previewId(8030))!;
  await f.run("staff", (db, a) =>
    saveVariant(
      db,
      a,
      v.id,
      v.version,
      { ...v, verified: false },
      "SAMPLE unverify",
      "sample",
    ),
  );
  await assert.rejects(scan("SAMPLE-BOX-BASE"), fail(404));
  await assert.rejects(scan(qrLink(token, "sample")), fail(409));
  const fresh = (await list()).variants.find((x) => x.id === v.id)!;
  await f.run("staff", (db, a) =>
    saveVariant(
      db,
      a,
      v.id,
      fresh.version,
      { ...fresh, verified: true },
      "SAMPLE reverify",
      "sample",
    ),
  );
  const sold = await scan("SAMPLE-BOX-SOLDOUT");
  assert.equal(
    sold.availability.variants.find((x) => x.id === sold.selected_variant)!
      .available,
    false,
  );
});
const proof: CatalogProof = {
  id: "gid://shopify/Product/8888",
  title: "Verified provider title",
  handle: "verified-product",
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/8888",
        title: "Default",
        sku: "VERIFIED-SKU",
        barcode: "12345678",
        availableForSale: true,
        currentlyNotInStock: false,
        quantityAvailable: 2,
        price: { amount: "19.99", currencyCode: "USD" },
      },
    ],
    pageInfo: { hasNextPage: false },
  },
};
const query = (p: CatalogProof | null) =>
  (async (q: string, v: object) => {
    assert.ok(q.startsWith("query "));
    assert.deepEqual(v, { id: proof.id });
    return { node: p };
  }) as Query;
let liveProduct = "";
test("live verification checks exact Shopify identity, SKU, barcode, publication and currency; no writes to Shopify", async () => {
  liveProduct = randomUUID();
  await f.run("staff", (db, a) =>
    saveProduct(
      db,
      a,
      liveProduct,
      null,
      {
        shopify_product_id: proof.id,
        title: "internal draft name",
        family: "Cards",
        handle: proof.handle,
      },
      "Local proof test",
    ),
  );
  const input = {
    product_id: liveProduct,
    shopify_variant_id: proof.variants.nodes[0].id,
    sku: "VERIFIED-SKU",
    barcode: "12345678",
    verified: true,
    evidence: "Test provider proof",
  };
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveVariant(
        db,
        a,
        randomUUID(),
        null,
        { ...input, sku: "wrong" },
        "bad",
        "live",
        query(proof),
      ),
    ),
    fail(409),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      saveVariant(db, a, randomUUID(), null, input, "bad", "live", query(null)),
    ),
    fail(404),
  );
  await f.run("staff", (db, a) =>
    saveVariant(
      db,
      a,
      randomUUID(),
      null,
      input,
      "matched",
      "live",
      query(proof),
    ),
  );
  await assert.rejects(
    productProof(
      query({
        ...proof,
        variants: { ...proof.variants, pageInfo: { hasNextPage: true } },
      }),
      proof.id,
    ),
    fail(409),
  );
  await assert.rejects(
    productProof(
      query({
        ...proof,
        variants: {
          ...proof.variants,
          nodes: [
            {
              ...proof.variants.nodes[0],
              price: { amount: "19.99", currencyCode: "CAD" },
            },
          ],
        },
      }),
      proof.id,
    ),
    fail(503),
  );
});
test("scan refreshes current price and availability; changed verified barcode cannot silently resolve", async () => {
  const prior = process.env.NORTHSIDE_QR_ORIGIN;
  process.env.NORTHSIDE_QR_ORIGIN = "https://app.example.test";
  try {
    const fresh = {
      ...proof,
      variants: {
        ...proof.variants,
        nodes: [
          {
            ...proof.variants.nodes[0],
            quantityAvailable: 0,
            price: { amount: "24.99", currencyCode: "USD" },
          },
        ],
      },
    };
    const r = await f.run("a", (db) =>
      resolveScan(db, "12345678", "live", query(fresh)),
    );
    assert.equal(r.product.title, proof.title);
    assert.equal(r.availability.variants[0].price.amount, "24.99");
    assert.equal(r.availability.variants[0].available, false);
    await assert.rejects(
      f.run("a", (db) =>
        resolveScan(
          db,
          "12345678",
          "live",
          query({
            ...fresh,
            variants: {
              ...fresh.variants,
              nodes: [{ ...fresh.variants.nodes[0], barcode: "other" }],
            },
          }),
        ),
      ),
      fail(409),
    );
  } finally {
    if (prior === undefined) delete process.env.NORTHSIDE_QR_ORIGIN;
    else process.env.NORTHSIDE_QR_ORIGIN = prior;
  }
});
test("SVG and PNG labels round-trip through the actual decoder and contain only the stable sample URL", async () => {
  const bytes = await readFile(
    "public/vendor/zxing-wasm/3.1.4/zxing_reader.wasm",
  );
  await prepareZXingModule({
    overrides: {
      wasmBinary: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    },
    fireImmediately: true,
  });
  const png = await f.run("staff", (db, a) =>
    storeLabel(db, a, previewId(8050), "png", "sample"),
  );
  assert.match(png.headers.get("content-disposition")!, /SAMPLE-/);
  const blob = await png.blob(),
    found = await readBarcodes(blob);
  assert.equal(found[0].text, qrLink(token, "sample"));
  const svg = await f.run("reader", (db, a) =>
    storeLabel(db, a, previewId(8050), "svg", "sample"),
  );
  const text = await svg.text();
  assert.match(text, /<svg/);
  assert.match(text, /SAMPLE — NOT FOR STORE USE/);
  const decodedSvg = await readBarcodes(
    new Uint8Array(await sharp(Buffer.from(text)).png().toBuffer()),
  );
  assert.equal(decodedSvg[0].text, qrLink(token, "sample"));
  for (const bad of [
    "private breaker",
    "12.00",
    "quantity",
    "password",
    "customer_id",
  ])
    assert.ok(!text.includes(bad));
  await assert.rejects(
    f.run("a", (db, a) => storeLabel(db, a, previewId(8050), "png", "sample")),
    fail(403),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      storeLabel(db, a, previewId(8050), "pdf", "sample"),
    ),
    fail(400),
  );
});
test("public flags and live domain fail closed; sample links are forbidden in production", () => {
  for (const flag of ["scanner", "aisles", "pickup"] as const)
    assert.throws(() => storeGate(flag), fail(404));
  const origin = process.env.NORTHSIDE_QR_ORIGIN;
  delete process.env.NORTHSIDE_QR_ORIGIN;
  assert.throws(() => qrOrigin(), fail(503));
  process.env.NORTHSIDE_QR_ORIGIN = "http://evil.test";
  assert.throws(() => qrOrigin(), fail(503));
  if (origin === undefined) delete process.env.NORTHSIDE_QR_ORIGIN;
  else process.env.NORTHSIDE_QR_ORIGIN = origin;
  const env = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.throws(() => qrLink(token, "sample"), fail(404));
  if (env === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: env });
});
test("pickup rehearsal uses separate sequential audited states, immutable owner and no live collection", async () => {
  const id = randomUUID(),
    input = {
      customer_id: previewId(1),
      order_id: "SAMPLE pickup test",
      state: "paid",
    };
  await assert.rejects(
    f.run("a", (db, a) =>
      pickupRehearsal(db, a, id, null, input, "bad", "sample"),
    ),
    fail(403),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      pickupRehearsal(db, a, id, null, input, "bad", "live"),
    ),
    fail(503),
  );
  await f.run("staff", (db, a) =>
    pickupRehearsal(db, a, id, null, input, "SAMPLE paid rehearsal", "sample"),
  );
  await assert.rejects(
    f.run("staff", (db, a) =>
      pickupRehearsal(
        db,
        a,
        id,
        1,
        { ...input, state: "collected" },
        "skip",
        "sample",
      ),
    ),
    fail(409),
  );
  for (const [i, state] of ["preparing", "ready", "collected"].entries())
    await f.run("staff", (db, a) =>
      pickupRehearsal(
        db,
        a,
        id,
        i + 1,
        { ...input, state },
        "SAMPLE " + state,
        "sample",
      ),
    );
  await assert.rejects(
    f.run("staff", (db, a) =>
      pickupRehearsal(
        db,
        a,
        id,
        4,
        { ...input, state: "preparing" },
        "backwards",
        "sample",
      ),
    ),
    fail(409),
  );
  await assert.rejects(
    f.db.query("update ns.store_pickups set customer_id=$1 where id=$2", [
      previewId(2),
      id,
    ]),
    /immutable/,
  );
  const audit = (await list()).audit.filter((a) =>
    a.action.startsWith("store_pickups"),
  );
  assert.equal(audit.length, 4);
  await assert.rejects(
    f.db.query("update ns.store_audit set reason=$1", ["rewrite"]),
    /immutable|append|rewrit/i,
  );
});
test("other-tenant locations and codes do not cross customer or staff boundaries", async () => {
  const tenant = randomUUID(),
    product = randomUUID();
  await f.db.query(
    "insert into ns.tenants(id,slug,shop,is_test) values($1,'store-other','store-other.myshopify.com',true)",
    [tenant],
  );
  await f.db.query(
    "insert into ns.store_products(tenant_id,id,shopify_product_id,title,family,handle,fixture) values($1,$2,'gid://shopify/Product/9999','PRIVATE TENANT PRODUCT','secret','other-product',true)",
    [tenant, product],
  );
  for (const who of ["a", "staff", "reader"])
    await f.run(who, async (db) => {
      assert.equal(
        (
          await db.query("select * from ns.store_products where tenant_id=$1", [
            tenant,
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query<{ p: null }>(
            "select ns.store_retail_product($1,true) p",
            [product],
          )
        ).rows[0].p,
        null,
      );
    });
  assert.ok(!(await list()).products.some((p) => p.id === product));
  assert.equal(
    (
      await f.db.query("select * from ns.order_ledger where tenant_id=$1", [
        TENANT,
      ])
    ).rows.length,
    0,
  );
});
let closed = false;
test("store edits and audit survive a database restart without re-seeding", async () => {
  const before = await list();
  await f.db.close();
  closed = true;
  const again = await openPreviewDatabase(dir);
  try {
    await initializeStorePreview(again);
    const after = await again.run("staff", (db, a) =>
      storeStaff(db, a, "sample"),
    );
    assert.equal(after.qrs[0].token, token);
    assert.deepEqual(after.aisles, before.aisles);
    assert.equal(after.audit.length, before.audit.length);
    assert.equal(after.pickups[0].state, "collected");
  } finally {
    await again.db.close();
  }
});
test.after(async () => {
  if (!closed) await f.db.close();
  await rm(dir, { recursive: true, force: true });
});
