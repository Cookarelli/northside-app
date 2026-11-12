import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../lib/server/db";
import { authorizeOn } from "../lib/server/db";
import { hashToken, opaqueToken, seal } from "../lib/server/security";
import { createSession } from "../lib/server/sessions";
import {
  createIntentOn,
  startIntentOn,
  consumeAttemptOn,
  completeLoginOn,
  exchangeOn,
  loadCredentialOn,
  rotateOn,
  logoutOn,
  cleanupOn,
} from "../lib/server/mobile/store";
import { listCards, readCard } from "../lib/server/records";
import { TENANT } from "../lib/server/providers";
import { customerAccount, bindCustomer } from "../lib/server/customer-commerce";
import {
  projectNativeAccount,
  projectNativeOrders,
} from "../lib/server/mobile/projection";
import { mobileHandler, mobileError } from "../lib/server/mobile/http";
import {
  mobileSessionSchema,
  mobileAccountSchema,
  mobileOrdersSchema,
} from "../../../packages/customer-contracts/src/mobile";

process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
process.env.APP_ORIGIN = "https://native-staging.example.test";
const config = {
  variant: "development" as const,
  origin: process.env.APP_ORIGIN,
  callbackUri: process.env.APP_ORIGIN + "/api/mobile/v1/auth/callback",
  returnUri: "northside-test://auth/return",
};
async function fixture() {
  const db = await PGlite.create();
  await db.exec(
    await readFile(
      "supabase/migrations/202609120001_identity_and_records.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile("supabase/migrations/202609120003_commerce.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261104152327_native_mobile_customer_sessions.sql",
      "utf8",
    ),
  );
  async function auth<T>(fn: (db: Sql) => Promise<T>) {
    return db.transaction(async (tx) => {
      await tx.exec("set local role northside_auth");
      return fn(tx as Sql);
    });
  }
  async function begin() {
    const verifier = opaqueToken(),
      appState = opaqueToken();
    const input = {
      variant: "development" as const,
      appState,
      challenge: createHash("sha256").update(verifier).digest("base64url"),
      challengeMethod: "S256" as const,
    };
    const intent = await auth((d) => createIntentOn(d, input, config));
    const start = await auth((d) =>
      startIntentOn(d, intent.intentId, {
        state: opaqueToken(),
        nonce: opaqueToken(),
        verifier: opaqueToken(),
      }),
    );
    const attempt = await auth((d) => consumeAttemptOn(d, start.cookie));
    return { verifier, appState, intent, start, attempt };
  }
  async function login(subject = "1001") {
    const flow = await begin();
    const target = new URL(
      await auth((d) =>
        completeLoginOn(
          d,
          flow.attempt,
          subject,
          {
            access_token: "SYNTHETIC PROVIDER TOKEN",
            refresh_token: "SYNTHETIC REFRESH",
            subject,
          },
          3600,
        ),
      ),
    );
    const exchange = {
      intentId: flow.intent.intentId,
      ticket: target.searchParams.get("ticket")!,
      appState: flow.appState,
      verifier: flow.verifier,
    };
    const session = await auth((d) => exchangeOn(d, exchange));
    return { flow, target, exchange, session };
  }
  return { db, auth, begin, login };
}

test("native first/existing customer login reuses canonical UUID and keeps provider/parent secrets out of app return", async () => {
  const f = await fixture();
  try {
    const a = await f.login(),
      same = await f.login(),
      b = await f.login("1002");
    assert.equal(a.session.customerId, same.session.customerId);
    assert.notEqual(a.session.customerId, b.session.customerId);
    assert.equal(
      (await f.db.query("select * from ns.customers")).rows.length,
      2,
    );
    assert.equal(a.target.protocol, "northside-test:");
    assert.deepEqual([...a.target.searchParams.keys()].sort(), [
      "intent",
      "state",
      "ticket",
    ]);
    assert(!a.target.toString().includes("SYNTHETIC"));
    assert(!JSON.stringify(a.session).includes("PROVIDER"));
    assert(mobileSessionSchema.safeParse(a.session).success);
    const parent = await f.auth((d) =>
      loadCredentialOn(d, a.session.accessToken, "access"),
    );
    assert(
      Date.parse(a.session.accessExpiresAt) <= Date.parse(parent.expiresAt),
    );
    assert.equal(a.session.absoluteExpiresAt, parent.expiresAt);
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec("set local role northside_runtime");
        return authorizeOn(tx as Sql, a.session.accessToken);
      }),
    );
  } finally {
    await f.db.close();
  }
});
test("one-use browser attempts and PKCE-bound handoffs reject theft, wrong state and replay", async () => {
  const f = await fixture();
  try {
    const flow = await f.begin();
    await assert.rejects(f.auth((d) => consumeAttemptOn(d, flow.start.cookie)));
    await assert.rejects(
      f.auth((d) =>
        startIntentOn(d, flow.intent.intentId, {
          state: opaqueToken(),
          nonce: opaqueToken(),
          verifier: opaqueToken(),
        }),
      ),
    );
    const fresh = await f.begin();
    const target = new URL(
      await f.auth((d) =>
        completeLoginOn(
          d,
          fresh.attempt,
          "1001",
          { access_token: "SYNTHETIC", subject: "1001" },
          3600,
        ),
      ),
    );
    const exchange = {
      intentId: fresh.intent.intentId,
      ticket: target.searchParams.get("ticket")!,
      appState: fresh.appState,
      verifier: fresh.verifier,
    };
    await assert.rejects(
      f.auth((d) => exchangeOn(d, { ...exchange, verifier: opaqueToken() })),
    );
    await assert.rejects(
      f.auth((d) => exchangeOn(d, { ...exchange, appState: opaqueToken() })),
    );
    await f.auth((d) => exchangeOn(d, exchange));
    await assert.rejects(f.auth((d) => exchangeOn(d, exchange)));
    await assert.rejects(
      f.auth((d) => loadCredentialOn(d, opaqueToken(), "access")),
    );
  } finally {
    await f.db.close();
  }
});
test("renewal rotation retains replay evidence and commits family revocation before reporting replay", async () => {
  const f = await fixture();
  try {
    const a = await f.login();
    const next = await f.auth((d) => rotateOn(d, a.session.renewalToken));
    assert(!("replayed" in next));
    if ("replayed" in next) throw Error();
    assert.equal(next.absoluteExpiresAt, a.session.absoluteExpiresAt);
    await assert.rejects(
      f.auth((d) => loadCredentialOn(d, a.session.accessToken, "access")),
    );
    const next2 = await f.auth((d) => rotateOn(d, next.renewalToken));
    assert(!("replayed" in next2));
    const replay = await f.auth((d) => rotateOn(d, a.session.renewalToken));
    assert.deepEqual(replay, { replayed: true });
    // This assertion is outside the transaction: rollback must not undo revocation.
    const family = (
      await f.db.query<{ revoked_at: string; encrypted_parent: string }>(
        "select revoked_at,encrypted_parent from ns.mobile_families",
      )
    ).rows[0];
    assert(family.revoked_at);
    assert.equal(family.encrypted_parent, "revoked");
    assert.equal(
      (
        await f.db.query<{ encrypted_tokens: string }>(
          "select encrypted_tokens from ns.sessions",
        )
      ).rows[0].encrypted_tokens,
      "revoked",
    );
    await assert.rejects(
      f.auth((d) => loadCredentialOn(d, next.accessToken, "access")),
    );
  } finally {
    await f.db.close();
  }
});
test("logout is idempotent, invalidates its parent and leaves a different customer session intact", async () => {
  const f = await fixture();
  try {
    const a = await f.login(),
      b = await f.login("1002"),
      parent = await f.auth((d) =>
        loadCredentialOn(d, a.session.accessToken, "access"),
      );
    assert((await f.auth((d) => logoutOn(d, a.session.renewalToken))).revoked);
    assert((await f.auth((d) => logoutOn(d, a.session.renewalToken))).revoked);
    await assert.rejects(
      f.auth((d) => loadCredentialOn(d, a.session.accessToken, "access")),
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec("set local role northside_runtime");
        return authorizeOn(tx as Sql, parent.parentToken);
      }),
    );
    assert.equal(
      (
        await f.auth((d) =>
          loadCredentialOn(d, b.session.accessToken, "access"),
        )
      ).customerId,
      b.session.customerId,
    );
  } finally {
    await f.db.close();
  }
});
test("absolute expiry and immutable parent/customer binding fail closed", async () => {
  const f = await fixture();
  try {
    const a = await f.login();
    const now = Date.now;
    try {
      Date.now = () => Date.parse(a.session.absoluteExpiresAt);
      await assert.rejects(
        f.auth((d) => loadCredentialOn(d, a.session.renewalToken, "renewal")),
      );
    } finally {
      Date.now = now;
    }
    await assert.rejects(
      f.db.query(
        "update ns.mobile_families set expires_at=expires_at+interval '1 hour'",
      ),
    );
    await assert.rejects(
      f.db.query("update ns.mobile_families set customer_id=$1", [
        randomUUID(),
      ]),
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec("set local role northside_runtime");
        return tx.query("select * from ns.mobile_credentials");
      }),
    );
    await f.auth((d) => cleanupOn(d));
  } finally {
    await f.db.close();
  }
});
test("staff-only parents cannot become native customer families", async () => {
  const f = await fixture();
  try {
    const validCustomer = await f.login();
    const staff = randomUUID();
    await f.db.query(
      "insert into ns.staff_memberships(tenant_id,id,auth_user_id,role) values('11111111-1111-4111-8111-111111111111',$1,$2,'owner')",
      [staff, randomUUID()],
    );
    const token = await f.auth((d) =>
      createSession(
        d,
        { staffId: staff },
        "supabase",
        { access_token: "SYNTHETIC", subject: staff },
        3600,
      ),
    );
    await assert.rejects(
      f.auth((d) =>
        d.query(
          "insert into ns.mobile_families(family_id,tenant_id,customer_id,parent_hash,encrypted_parent,variant,api_origin,expires_at) values($1,'11111111-1111-4111-8111-111111111111',$2,$3,$4,'development',$5,now()+interval '1 hour')",
          [
            randomUUID(),
            validCustomer.session.customerId,
            hashToken(token),
            seal({ parentToken: token }, "synthetic"),
            config.origin,
          ],
        ),
      ),
      /invalid_mobile_parent/,
    );
  } finally {
    await f.db.close();
  }
});
test("mobile HTTP rejects unauthorized/cookie/identity injection and never echoes raw errors", async () => {
  for (const headers of [
    {},
    { authorization: "Bearer " + "a".repeat(64) },
    {
      authorization: "Bearer " + opaqueToken(),
      cookie: "__Host-ns_session=" + opaqueToken(),
    },
  ] as Record<string, string>[]) {
    const response = await mobileHandler(
      new Request("https://native-staging.example.test/api/mobile/v1/me", {
        headers,
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, no-store, max-age=0",
    );
  }
  const response = await mobileHandler(
    new Request(
      "https://native-staging.example.test/api/mobile/v1/auth/intents",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variant: "development",
          customerId: "private-synthetic",
          adminToken: "secret-synthetic",
        }),
      },
    ),
  );
  assert.equal(response.status, 400);
  assert(!(await response.text()).includes("synthetic"));
  const raw = await mobileError(new Error("PRIVATE DATABASE TOKEN")).text();
  assert(!raw.includes("PRIVATE"));
});
test("strict customer/order projections reject private extensions and invented money", () => {
  assert(
    !mobileAccountSchema.safeParse({ kind: "account", access_token: "private" })
      .success,
  );
  assert(
    !mobileOrdersSchema.safeParse({
      kind: "orders",
      orders: [{ total: { amountCents: null, currencyCode: "USD" } }],
    }).success,
  );
});

test("Customer Account query uses current authenticated customer, projects real response shape and rejects identity rebinding", async () => {
  const f = await fixture();
  try {
    const a = await f.login(),
      parent = await f.auth((d) =>
        loadCredentialOn(d, a.session.accessToken, "access"),
      );
    const customer = await customerAccount(
      async <T>(query: string, variables: object) => {
        assert(query.includes("customer { id"));
        assert(!query.includes("customer(id:"));
        assert.deepEqual(variables, { after: undefined });
        return {
          customer: {
            id: "gid://shopify/Customer/1001",
            firstName: "Synthetic",
            lastName: null,
            emailAddress: { emailAddress: "synthetic@example.test" },
            privateInternal: "NEVER EXPOSE",
            orders: {
              nodes: [
                {
                  id: "gid://shopify/Order/123",
                  name: "#123",
                  processedAt: "2026-11-01T12:00:00Z",
                  financialStatus: "PAID",
                  totalPrice: { amount: "19.99", currencyCode: "USD" },
                  internalCost: "NEVER EXPOSE",
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        } as T;
      },
    );
    const actor = {
      tenant_id: TENANT,
      customer_id: parent.customerId,
      staff_id: null,
      staff_role: null,
    };
    await f.auth((d) => bindCustomer(d, actor, customer.id));
    await assert.rejects(
      f.auth((d) => bindCustomer(d, actor, "gid://shopify/Customer/1002")),
    );
    const orders = projectNativeOrders(customer),
      account = projectNativeAccount(
        customer,
        parent.customerId,
        parent.expiresAt,
      );
    assert.equal(orders.orders[0].total.amountCents, 1999);
    assert.equal(account.customer.id, a.session.customerId);
    assert(!JSON.stringify({ orders, account }).includes("NEVER EXPOSE"));
    await assert.rejects(
      customerAccount(async <T>() => ({ customer: null }) as T),
    );
    assert.throws(() =>
      projectNativeOrders({
        ...customer,
        orders: {
          ...customer.orders,
          nodes: [
            {
              ...customer.orders.nodes[0],
              totalPrice: { amount: "NaN", currencyCode: "USD" },
            },
          ],
        },
      }),
    );
  } finally {
    await f.db.close();
  }
});
test("native customer parents enforce customer-owned service lists and deny another customer detail under actual RLS", async () => {
  const f = await fixture();
  try {
    const a = await f.login(),
      b = await f.login("1002");
    const cards: string[] = [];
    for (const login of [a, b]) {
      const caseId = randomUUID(),
        cardId = randomUUID();
      cards.push(cardId);
      await f.db.query(
        "insert into ns.service_cases(tenant_id,id,customer_id,kind) values($1,$2,$3,'grading')",
        [TENANT, caseId, login.session.customerId],
      );
      await f.db.query(
        "insert into ns.card_items(tenant_id,id,customer_id,case_id,description) values($1,$2,$3,$4,$5)",
        [
          TENANT,
          cardId,
          login.session.customerId,
          caseId,
          "SYNTHETIC OWNED CARD",
        ],
      );
    }
    const parent = await f.auth((d) =>
      loadCredentialOn(d, a.session.accessToken, "access"),
    );
    await f.db.transaction(async (tx) => {
      await tx.exec("set local role northside_runtime");
      const actor = await authorizeOn(tx as Sql, parent.parentToken);
      const rows = await listCards(tx as Sql, actor);
      assert.deepEqual(
        rows.map((r) => r.id),
        [cards[0]],
      );
      const raw = await tx.query<{ id: string }>(
        "select id from ns.card_items",
      );
      assert.deepEqual(
        raw.rows.map((r) => r.id),
        [cards[0]],
      );
    });
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec("set local role northside_runtime");
        const actor = await authorizeOn(tx as Sql, parent.parentToken);
        return readCard(tx as Sql, actor, cards[1]);
      }),
    );
  } finally {
    await f.db.close();
  }
});
test("current mobile realm allowlist is enforced before ticket exchange and families remain immutable", async () => {
  const f = await fixture();
  try {
    const flow = await f.begin();
    const target = new URL(
      await f.auth((d) =>
        completeLoginOn(
          d,
          flow.attempt,
          "1001",
          { access_token: "SYNTHETIC", subject: "1001" },
          3600,
        ),
      ),
    );
    const input = {
      intentId: flow.intent.intentId,
      ticket: target.searchParams.get("ticket")!,
      appState: flow.appState,
      verifier: flow.verifier,
    };
    await assert.rejects(
      f.auth((d) =>
        exchangeOn(d, input, () => {
          throw Error("withdrawn realm");
        }),
      ),
    );
    const session = await f.auth((d) =>
      exchangeOn(d, input, (realm) => {
        assert.equal(realm.origin, config.origin);
        assert.equal(realm.variant, config.variant);
      }),
    );
    assert.equal(session.providerRenewal, "browser_reauthentication");
    await assert.rejects(
      f.db.query(
        "update ns.mobile_families set api_origin='https://foreign.example.test'",
      ),
    );
  } finally {
    await f.db.close();
  }
});

test("abandoned-family cleanup honors the actual unused handoff window", async () => {
  const f = await fixture();
  try {
    const flow = await f.begin();
    await f.auth((d) =>
      completeLoginOn(
        d,
        flow.attempt,
        "1001",
        { access_token: "SYNTHETIC", subject: "1001" },
        3600,
      ),
    );
    await f.auth((d) => cleanupOn(d));
    assert.equal(
      (
        await f.db.query<{ revoked_at: string | null }>(
          "select revoked_at from ns.mobile_families",
        )
      ).rows[0].revoked_at,
      null,
    );
    await f.db.query(
      "update ns.mobile_handoffs set created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'",
    );
    await f.auth((d) => cleanupOn(d));
    assert(
      (
        await f.db.query<{ revoked_at: string | null }>(
          "select revoked_at from ns.mobile_families",
        )
      ).rows[0].revoked_at,
    );
  } finally {
    await f.db.close();
  }
});
