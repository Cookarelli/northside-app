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
import { customerContext } from "./customer-commerce";
import { createCart, type Query } from "./storefront";
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
  options: { create: boolean; bind: boolean },
  fn: (id: string, token: string | undefined, db: Sql) => Promise<T>,
) {
  const context = await customerContext(true),
    jar = await cookies();
  let handle = jar.get(CART_COOKIE)?.value;
  const customerId = context?.actor.customer_id || null;
  let created = false;
  const result = await transaction("commerce", async (db) => {
    if (!handle && options.create) {
      handle = opaqueToken();
      const hash = hashToken(handle),
        cart = await createCart(query, context?.accessToken);
      await db.query(
        "insert into ns.commerce_carts(token_hash,tenant_id,customer_id,encrypted_cart) values($1,$2,$3,$4)",
        [hash, TENANT, customerId, seal({ id: cart.id }, hash)],
      );
      created = true;
    }
    const saved = await cartOn(db, handle, customerId);
    const value = await fn(saved.cartId, context?.accessToken, db);
    if (options.bind && customerId && !saved.row.customer_id)
      await db.query(
        "update ns.commerce_carts set customer_id=$3 where tenant_id=$1 and token_hash=$2",
        [TENANT, saved.row.token_hash, customerId],
      );
    return value;
  });
  if (created)
    jar.set(CART_COOKIE, handle!, { ...cookieOptions, maxAge: 10 * 86400 });
  return result;
}
