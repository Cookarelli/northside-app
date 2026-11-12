import "server-only";
import { cookies } from "next/headers";
import { transaction, type Sql } from "./db";
import { TENANT } from "./providers";
import {
  AccessError,
  cookieOptions,
  hashToken,
  opaqueToken,
  seal,
  unseal,
  validToken,
} from "./security";
import { customerContext, verifyBuyerMapping } from "./customer-commerce";
import { createCart, type Query, type CartPolicy } from "./storefront";
export const CART_COOKIE = "__Host-ns_cart";
export type SavedCart = {
  token_hash: string;
  customer_id: string | null;
  encrypted_cart: string;
};
export async function cartOn(
  db: Sql,
  handle: unknown,
  customerId: string | null,
) {
  if (!validToken(handle)) throw new AccessError(409, "cart_expired");
  const row = (
    await db.query<SavedCart>(
      "select token_hash,customer_id,encrypted_cart from ns.commerce_carts where tenant_id=$1 and token_hash=$2 and expires_at>now() for update",
      [TENANT, hashToken(handle)],
    )
  ).rows[0];
  if (!row) throw new AccessError(409, "cart_expired");
  if (row.customer_id && row.customer_id !== customerId)
    throw new AccessError(403, "cart_owner_mismatch");
  return {
    row,
    cartId: unseal<{ id: string }>(row.encrypted_cart, row.token_hash).id,
  };
}
export async function withCart<T>(
  query: Query,
  options: { create: boolean; bind: boolean; salePolicy?: CartPolicy },
  fn: (id: string, token: string | undefined, db: Sql) => Promise<T>,
) {
  const context = await customerContext(true),
    jar = await cookies();
  const handle = jar.get(CART_COOKIE)?.value;
  const customerId = context?.actor.customer_id || null;
  if (context && options.bind) await verifyBuyerMapping(context);
  return runSavedCart(
    (fn) => transaction("commerce", fn),
    query,
    handle,
    customerId,
    options,
    (createdHandle) => {
      jar.set(CART_COOKIE, createdHandle, {
        ...cookieOptions,
        maxAge: 10 * 86400,
      });
    },
    (id, db) => fn(id, context?.accessToken, db),
  );
}

type CartTransaction = <T>(fn: (db: Sql) => Promise<T>) => Promise<T>;
// Shared orchestration for the real request wrapper and isolated SQL acceptance.
export async function runSavedCart<T>(
  transact: CartTransaction,
  query: Query,
  handle: string | undefined,
  customerId: string | null,
  options: { create: boolean; bind: boolean; salePolicy?: CartPolicy },
  remember: (handle: string) => void,
  fn: (id: string, db: Sql) => Promise<T>,
) {
  // Commit ownership BEFORE sending a buyer token to Shopify. Provider mutations
  // cannot be rolled back with SQL, including when their response is lost.
  const prepared = await transact((db) =>
    prepareCartOn(db, query, handle, customerId, options),
  );
  if (prepared.created) remember(prepared.handle);
  return transact(async (db) => {
    const saved = await cartOn(db, prepared.handle, customerId);
    return fn(saved.cartId, db);
  });
}

// Trusted server context only; callers must commit this transaction before any
// buyer-bearing provider operation. Never accept customerId from a request body.
export async function prepareCartOn(
  db: Sql,
  query: Query,
  handle: string | undefined,
  customerId: string | null,
  options: { create: boolean; bind: boolean; salePolicy?: CartPolicy },
) {
  let created = false;
  if (!handle && options.create) {
    handle = opaqueToken();
    const hash = hashToken(handle);
    // A failed local commit can orphan only an anonymous cart, not buyer data.
    const cart = await createCart(query, undefined, options.salePolicy);
    await db.query(
      "insert into ns.commerce_carts(token_hash,tenant_id,customer_id,encrypted_cart) values($1,$2,$3,$4)",
      [hash, TENANT, customerId, seal({ id: cart.id }, hash)],
    );
    created = true;
  }
  const saved = await cartOn(db, handle, customerId);
  if (options.bind && customerId && !saved.row.customer_id)
    await db.query(
      "update ns.commerce_carts set customer_id=$3 where tenant_id=$1 and token_hash=$2",
      [TENANT, saved.row.token_hash, customerId],
    );
  return { handle: handle!, created };
}
