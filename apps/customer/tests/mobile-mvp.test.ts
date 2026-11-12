import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  readCatalog,
  readProduct,
  projectCatalogProduct,
  scanCandidates,
  nativeScanTargetOn,
  resolveNativeCandidates,
  verifyScanProduct,
  MOBILE_CATALOG_QUERY,
  MOBILE_PRODUCT_QUERY,
} from "../lib/server/mobile/catalog";
import { projectWallet } from "../lib/server/mobile/customer-content";
import {
  privacyRequestOn,
  privacyStatusOn,
} from "../lib/server/mobile/privacy-request";
import { createSession, establishCustomer } from "../lib/server/sessions";
import { AccessError, hashToken, seal } from "../lib/server/security";
import { TENANT } from "../lib/server/providers";
import type { Sql } from "../lib/server/db";
import type { LoyaltyWallet } from "../lib/loyalty";
import type { NativeParent } from "../lib/server/mobile/store";
import type { Query } from "../lib/server/storefront";
import { mobileHandler } from "../lib/server/mobile/http";
const image = {
  url: "https://cdn.shopify.com/s/files/1/1234/5678/products/synthetic.jpg",
  altText: "SYNTHETIC TEST ITEM",
};
function raw() {
  return {
    id: "gid://shopify/Product/1",
    handle: "synthetic-item",
    title: "Synthetic Trading Card",
    description: "Test set",
    productType: "Sports Cards",
    publishedAt: "2026-10-01T00:00:00Z",
    availableForSale: true,
    featuredImage: image,
    priceRange: { minVariantPrice: { amount: "12.34", currencyCode: "USD" } },
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/11",
          title: "Base",
          sku: "TEST-001",
          barcode: "036000291452",
          availableForSale: true,
          currentlyNotInStock: false,
          price: { amount: "12.34", currencyCode: "USD" },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    collections: {
      nodes: [{ handle: "approved-mobile" }],
      pageInfo: { hasNextPage: false },
    },
  };
}
const sourcePage = (
  products: ReturnType<typeof raw>[],
  next: string | null = null,
) => ({
  collection: {
    handle: "approved-mobile",
    products: {
      nodes: products,
      pageInfo: { hasNextPage: !!next, endCursor: next },
      filters: [
        {
          id: "filter.p.product_type",
          values: [
            { label: "Sports Cards", input: '{"productType":"Sports Cards"}' },
          ],
        },
      ],
    },
  },
});
test("catalog is read-only, approved collection scoped and projects no inventory/staff data", async () => {
  const query: Query = async <T>(operation: string, vars: object) => {
    assert(operation.startsWith("query"));
    assert.deepEqual(vars, {
      handle: "approved-mobile",
      after: undefined,
      filters: [],
    });
    return sourcePage([
      {
        ...raw(),
        quantityAvailable: 88,
        staffNote: "PRIVATE",
        internalPool: "breaker",
      } as ReturnType<typeof raw>,
    ]) as T;
  };
  const result = await readCatalog({}, query, "approved-mobile");
  assert.equal(result.products[0].minVariantPrice.amountCents, 1234);
  assert.equal(
    result.products[0].variants.nodes[0].availability.quantityAvailable,
    null,
  );
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert(!JSON.stringify(result).includes("breaker"));
  assert(!MOBILE_CATALOG_QUERY.includes("quantityAvailable"));
  assert(!MOBILE_PRODUCT_QUERY.includes("quantityAvailable"));
});
test("search stays in approval scope across empty pages and preserves a real continuation", async () => {
  let page = 0;
  const query: Query = async <T>(_q: string, vars: object) => {
    page++;
    assert.equal((vars as { handle: string }).handle, "approved-mobile");
    return sourcePage(
      [{ ...raw(), title: page === 2 ? "Find Pikachu" : "No match" }],
      page < 3 ? "cursor" + page : null,
    ) as T;
  };
  const result = await readCatalog({ q: "Pikachu" }, query, "approved-mobile");
  assert.equal(page, 2);
  assert.equal(result.products.length, 1);
  assert.equal(result.pageInfo.endCursor, "cursor2");
  let calls = 0;
  const empty: Query = async <T>() =>
    sourcePage([{ ...raw(), title: "No match" }], "next" + ++calls) as T;
  const bounded = await readCatalog(
    { q: "impossible" },
    empty,
    "approved-mobile",
  );
  assert.equal(calls, 8);
  assert.equal(bounded.products.length, 0);
  assert.equal(bounded.pageInfo.hasNextPage, true);
});
test("category filters are provider product types; cyclic pagination fails closed", async () => {
  const query: Query = async <T>(_q: string, vars: object) => {
    assert.deepEqual((vars as { filters: unknown }).filters, [
      { productType: "Sports Cards" },
    ]);
    return sourcePage([raw()]) as T;
  };
  assert.deepEqual(
    (await readCatalog({ category: "Sports Cards" }, query, "approved-mobile"))
      .categories,
    ["Sports Cards"],
  );
  const cycle: Query = async <T>() => sourcePage([], "same") as T;
  await assert.rejects(readCatalog({ q: "none" }, cycle, "approved-mobile"));
});
test("unpublished or unapproved product detail and forged handle/variant evidence fail closed", async () => {
  for (const product of [
    null,
    { ...raw(), collections: { nodes: [], pageInfo: { hasNextPage: false } } },
    { ...raw(), publishedAt: "" },
    { ...raw(), publishedAt: "2999-01-01T00:00:00Z" },
  ]) {
    const query: Query = async <T>() => ({ product }) as T;
    await assert.rejects(
      readProduct(
        "synthetic-item",
        undefined,
        undefined,
        query,
        "approved-mobile",
      ),
    );
  }
  assert.throws(() =>
    projectCatalogProduct({
      ...raw(),
      variants: { ...raw().variants, nodes: [] },
    }),
  );
  assert.throws(() =>
    projectCatalogProduct(raw(), undefined, "gid://shopify/ProductVariant/999"),
  );
});
test("missing images and unavailable variants remain honest; malformed prices/images never leak", () => {
  const p = projectCatalogProduct({
    ...raw(),
    featuredImage: null,
    availableForSale: false,
    variants: {
      ...raw().variants,
      nodes: [{ ...raw().variants.nodes[0], availableForSale: false }],
    },
  });
  assert.equal(p.featuredImage, null);
  assert.equal(p.variants.nodes[0].availability.state, "unavailable");
  assert.throws(() =>
    projectCatalogProduct({
      ...raw(),
      featuredImage: {
        ...image,
        url: "https://private.example.test/image?secret=synthetic",
      },
    }),
  );
  assert.throws(() =>
    projectCatalogProduct({
      ...raw(),
      priceRange: { minVariantPrice: { amount: "NaN", currencyCode: "USD" } },
    }),
  );
  assert.throws(() =>
    projectCatalogProduct({
      ...raw(),
      priceRange: { minVariantPrice: { amount: "1.00", currencyCode: "EUR" } },
    }),
  );
});
test("barcode normalization preserves leading zeros and only handles valid camera EAN13 UPC representation", () => {
  assert.deepEqual(scanCandidates("0036000291452", "ean13"), [
    "0036000291452",
    "036000291452",
  ]);
  assert.deepEqual(scanCandidates("0036000291452"), ["0036000291452"]);
  assert.deepEqual(scanCandidates("0036000291453", "ean13"), ["0036000291453"]);
  assert.deepEqual(scanCandidates("0000123", "code128"), ["0000123"]);
});
function wallet(
  state: LoyaltyWallet["state"],
  balance: number | null,
): LoyaltyWallet {
  return {
    state,
    rule: null,
    balance,
    held: 5,
    spendable: Math.max(0, (balance ?? 0) - 5),
    negative_review: (balance ?? 0) < 0,
    enrolled_at: null,
    tier: null,
    rewards: [],
    ledger: [],
    reservations: [],
    vouchers: [],
  };
}
test("wallet has no fabricated zero when unlaunched/unenrolled and no raw voucher/rule data", () => {
  const unlaunched = projectWallet(wallet("not_launched", null));
  assert.equal(unlaunched.status, "unavailable");
  assert(!("balance" in unlaunched));
  const empty = projectWallet(wallet("not_enrolled", null));
  assert(!("balance" in empty));
  const debt = projectWallet(wallet("ready", -10));
  assert.equal(debt.status, "ready");
  if (debt.status === "ready") {
    assert.equal(debt.balance, -10);
    assert.equal(debt.available, 0);
  }
  assert(!("vouchers" in debt));
  assert(!("rule" in debt));
});
async function privacyFixture() {
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString("base64");
  const db = await PGlite.create();
  for (const name of [
    "202609120001_identity_and_records.sql",
    "20261104152327_native_mobile_customer_sessions.sql",
    "20261104161250_native_customer_privacy_requests.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  const auth = <T>(fn: (sql: Sql) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role northside_auth");
      return fn(tx as Sql);
    });
  async function parent(subject: string, old = false): Promise<NativeParent> {
    return auth(async (sql) => {
      const customerId = await establishCustomer(sql, subject),
        parentToken = await createSession(
          sql,
          { customerId },
          "shopify",
          { access_token: "SYNTHETIC", subject },
          3600,
        ),
        parentHash = hashToken(parentToken),
        familyId = randomUUID(),
        createdAt = new Date(Date.now() - (old ? 20 * 60000 : 0)).toISOString(),
        expiresAt = new Date(
          Date.now() + (old ? 7 : 8) * 3600000 - 1000,
        ).toISOString();
      await sql.query(
        "insert into ns.mobile_families(family_id,tenant_id,customer_id,parent_hash,encrypted_parent,variant,api_origin,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          familyId,
          TENANT,
          customerId,
          parentHash,
          seal({ parentToken }, "northside.mobile.parent:" + familyId),
          "development",
          "https://synthetic.example.test",
          createdAt,
          expiresAt,
        ],
      );
      return {
        familyId,
        customerId,
        parentToken,
        parentHash,
        expiresAt,
        variant: "development",
        origin: "https://synthetic.example.test",
        used: false,
      };
    });
  }
  return { db, auth, parent };
}
test("deletion initiation is durable/idempotent, owner scoped and revokes the current native family", async () => {
  const f = await privacyFixture();
  try {
    const a = await f.parent("a"),
      b = await f.parent("b");
    const receipt = await f.auth((d) => privacyRequestOn(d, a));
    assert.equal(receipt.request?.status, "requested");
    assert.equal(
      (await f.auth((d) => privacyStatusOn(d, b.customerId))).request,
      null,
    );
    assert(
      (
        await f.db.query<{ revoked_at: string }>(
          "select revoked_at from ns.mobile_families where family_id=$1",
          [a.familyId],
        )
      ).rows[0].revoked_at,
    );
    const next = await f.parent("a"),
      again = await f.auth((d) => privacyRequestOn(d, next));
    assert.equal(again.request?.id, receipt.request?.id);
    assert.equal(
      (await f.db.query("select id from ns.mobile_privacy_requests")).rows
        .length,
      1,
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec("set local role northside_runtime");
        return tx.query("select * from ns.mobile_privacy_requests");
      }),
    );
    await assert.rejects(
      f.auth((d) =>
        d.query("update ns.mobile_privacy_requests set status='completed'"),
      ),
    );
  } finally {
    await f.db.close();
  }
});
test("stale-login deletion requests require reauthentication and create no request", async () => {
  const f = await privacyFixture();
  try {
    const old = await f.parent("old", true);
    await assert.rejects(
      f.auth((d) => privacyRequestOn(d, old)),
      /reauthentication_required/,
    );
    assert.equal(
      (await f.db.query("select id from ns.mobile_privacy_requests")).rows
        .length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("MVP HTTP rejects foreign identity inputs, malformed search and unauthenticated wallet/deletion", async () => {
  for (const path of ["me/wallet", "me/breaks", "me/deletion-request"])
    assert.equal(
      (
        await mobileHandler(
          new Request("https://synthetic.example.test/api/mobile/v1/" + path),
        )
      ).status,
      401,
    );
  for (const query of ["customerId=private", "q=a&q=b", "after="])
    assert.equal(
      (
        await mobileHandler(
          new Request(
            "https://synthetic.example.test/api/mobile/v1/catalog?" + query,
          ),
        )
      ).status,
      400,
    );
  const response = await mobileHandler(
    new Request(
      "https://synthetic.example.test/api/mobile/v1/me/deletion-request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: "DELETE MY ACCOUNT",
          customerId: "foreign",
        }),
      },
    ),
  );
  assert.equal(response.status, 400);
});

test("ambiguous primary barcode is not discarded in favor of a normalized alternate", async () => {
  const db: Sql = {
    async query<T>() {
      return { rows: [{ product_id: "one" }, { product_id: "two" }] as T[] };
    },
  };
  await assert.rejects(
    nativeScanTargetOn(db, "0036000291452", "https://synthetic.example.test"),
    /invalid_provider_data/,
  );
  const alternate = {
    result: {
      product: { product_id: "gid://shopify/Product/1" },
      selected_variant: "gid://shopify/ProductVariant/11",
    },
    barcode: "036000291452",
  } as Awaited<ReturnType<typeof nativeScanTargetOn>>;
  await assert.rejects(
    resolveNativeCandidates("0036000291452", "ean13", async (value) => {
      if (value.length === 13)
        throw new AccessError(409, "invalid_provider_data");
      return alternate;
    }),
    /invalid_provider_data/,
  );
});
test("final fresh scan proof rejects changed SKU/barcode and foreign product identity", () => {
  const product = projectCatalogProduct(raw());
  const match = {
    result: {
      product: {
        product_id: product.id,
        variants: [
          { variant_id: product.variants.nodes[0].id, sku: "TEST-001" },
        ],
      },
      selected_variant: product.variants.nodes[0].id,
    },
    barcode: "036000291452",
  } as NonNullable<Awaited<ReturnType<typeof nativeScanTargetOn>>>;
  verifyScanProduct(match, product);
  for (const change of ["sku", "barcode"] as const) {
    const changed = structuredClone(product);
    changed.variants.nodes[0].identifiers[change] = "CHANGED";
    assert.throws(() => verifyScanProduct(match, changed));
  }
  assert.throws(() =>
    verifyScanProduct(match, { ...product, id: "gid://shopify/Product/999" }),
  );
});

test("published release collection results still require approved collection membership", async () => {
  const query: Query = async <T>() =>
    ({
      collection: {
        ...sourcePage([]).collection,
        handle: "release-list",
        products: {
          ...sourcePage([]).collection.products,
          nodes: [
            raw(),
            {
              ...raw(),
              id: "gid://shopify/Product/2",
              handle: "not-approved",
              collections: {
                nodes: [{ handle: "release-list" }],
                pageInfo: { hasNextPage: false },
              },
            },
          ],
        },
      },
    }) as T;
  const result = await readCatalog(
    {},
    query,
    "release-list",
    "approved-mobile",
  );
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].id, "gid://shopify/Product/1");
});
test("untrusted scanned URLs are rejected before any registry query or URL fetch", async () => {
  let calls = 0;
  const db: Sql = {
    async query<T>() {
      calls++;
      return { rows: [] as T[] };
    },
  };
  await assert.rejects(
    nativeScanTargetOn(
      db,
      "https://attacker.example.test/products/test",
      "https://synthetic.example.test",
    ),
    /invalid_request/,
  );
  assert.equal(calls, 0);
});
