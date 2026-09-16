import "server-only";
import * as oidc from "openid-client";
import { createClient } from "@supabase/supabase-js";
import { AccessError, appOrigin } from "./security";
import { fixturesAllowed } from "../policy.mjs";
export const TENANT = "11111111-1111-4111-8111-111111111111";
export const SHOP = "9i3hnb-jw.myshopify.com";
export function liveOnly() {
  if (fixturesAllowed(process.env))
    throw new AccessError(503, "live_auth_disabled_in_fixture_mode");
  appOrigin();
}
export function authReadiness() {
  return {
    customer: !!(
      process.env.APP_ORIGIN &&
      process.env.SHOPIFY_CUSTOMER_CLIENT_ID &&
      process.env.SHOPIFY_CUSTOMER_CLIENT_SECRET &&
      process.env.SHOPIFY_EXPECTED_ISSUER &&
      process.env.AUTH_DATABASE_URL &&
      process.env.DATABASE_URL &&
      process.env.SESSION_ENCRYPTION_KEY
    ),
    staff: !!(
      process.env.APP_ORIGIN &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_PUBLISHABLE_KEY &&
      process.env.AUTH_DATABASE_URL &&
      process.env.DATABASE_URL &&
      process.env.SESSION_ENCRYPTION_KEY
    ),
  };
}
export function supabase(privileged = false) {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env[
      privileged ? "SUPABASE_SECRET_KEY" : "SUPABASE_PUBLISHABLE_KEY"
    ];
  if (!url || !key) throw new AccessError(503, "supabase_not_configured");
  if (new URL(url).protocol !== "https:")
    throw new AccessError(503, "supabase_https_required");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
let cached: { at: number; config: oidc.Configuration } | undefined;
export async function shopifyOidc() {
  liveOnly();
  if (cached && Date.now() - cached.at < 3600000) return cached.config;
  const id = process.env.SHOPIFY_CUSTOMER_CLIENT_ID,
    secret = process.env.SHOPIFY_CUSTOMER_CLIENT_SECRET,
    issuer = process.env.SHOPIFY_EXPECTED_ISSUER;
  if (!id || !secret || !issuer)
    throw new AccessError(503, "shopify_auth_not_configured");
  const response = await fetch(
    `https://${SHOP}/.well-known/openid-configuration`,
    {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new AccessError(503, "shopify_discovery_unavailable");
  const metadata = (await response.json()) as oidc.ServerMetadata;
  if (metadata.issuer !== issuer)
    throw new AccessError(503, "shopify_issuer_mismatch");
  const allowed = new Set([
    SHOP,
    "shopify.com",
    ...(process.env.SHOPIFY_AUTH_HOSTS || "").split(",").filter(Boolean),
  ]);
  for (const key of [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
    "end_session_endpoint",
  ] as const) {
    const value = metadata[key];
    if (typeof value !== "string")
      throw new AccessError(503, "shopify_metadata_incomplete");
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowed.has(url.hostname)
    )
      throw new AccessError(503, "shopify_endpoint_not_allowed");
  }
  const config = configureOidc(metadata, id, secret);
  cached = { at: Date.now(), config };
  return config;
}
export function configureOidc(
  metadata: oidc.ServerMetadata,
  id: string,
  secret: string,
) {
  const config = new oidc.Configuration(
    metadata,
    id,
    { id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(secret),
  );
  oidc.enableNonRepudiationChecks(config);
  config.timeout = 10;
  return config;
}
