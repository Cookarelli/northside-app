import "server-only";
import { isIP } from "node:net";
import { fixturesAllowed } from "../policy.mjs";
import { SHOP } from "./providers";
import { AccessError } from "./security";
export const TESTED_API_VERSION = "2026-07";
export function apiVersion() {
  const version = process.env.SHOPIFY_API_VERSION || TESTED_API_VERSION;
  if (version !== TESTED_API_VERSION)
    throw new AccessError(503, "shopify_version_requires_validation");
  return version;
}
export function commerceConfig() {
  if (fixturesAllowed(process.env))
    throw new AccessError(503, "live_commerce_disabled_in_fixture_mode");
  if (process.env.SHOPIFY_SHOP !== SHOP)
    throw new AccessError(503, "shopify_shop_not_configured");
  return { shop: SHOP, version: apiVersion() };
}
export function required(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new AccessError(503, "shopify_not_configured");
  return value;
}
export function buyerIP(headers: Headers) {
  // Only read a header overwritten by the configured, trusted ingress. Never blindly trust X-Forwarded-For.
  const name = required("SHOPIFY_TRUSTED_BUYER_IP_HEADER").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name))
    throw new AccessError(503, "buyer_ip_header_invalid");
  const value = headers.get(name)?.trim();
  if (!value || !isIP(value))
    throw new AccessError(503, "verified_buyer_ip_required");
  return value;
}
export async function graphql<T>(
  url: string,
  headers: Record<string, string>,
  query: string,
  variables: object,
  run = fetch,
): Promise<T> {
  const response = await run(url, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new AccessError(503, "shopify_unavailable");
  const actual = response.headers.get("x-shopify-api-version");
  if (actual && actual !== apiVersion())
    throw new AccessError(503, "shopify_version_mismatch");
  const result = await response.json();
  if (result.errors?.length || !result.data)
    throw new AccessError(503, "shopify_query_failed");
  return result.data as T;
}
export function cents(value: { amount: string; currencyCode: string }) {
  if (value.currencyCode !== "USD" || !/^\d+(\.\d{1,2})?$/.test(value.amount))
    throw new AccessError(503, "unsupported_money");
  const [whole, fraction = ""] = value.amount.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw new AccessError(503, "unsupported_money");
  return n;
}
export function gid(value: unknown, type: string): string {
  if (
    typeof value !== "string" ||
    !new RegExp(`^gid://shopify/${type}/[0-9]+$`).test(value)
  )
    throw new AccessError(400, "invalid_shopify_id");
  return value;
}
export function cursor(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > 1500 ||
    /[\x00-\x1f]/.test(value)
  )
    throw new AccessError(400, "invalid_cursor");
  return value;
}
