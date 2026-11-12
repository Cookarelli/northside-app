// Local, read-only configuration preflight. Prints public names/status only.
import { mobileConfiguration } from "../lib/server/mobile/config";
import { databaseConfig } from "../lib/server/database-config.mjs";
import { selectReadinessVariant } from "./mobile-readiness-variant.mjs";
let variant;
try {
  variant = selectReadinessVariant(process.argv.slice(2), process.env.NORTHSIDE_MOBILE_ENVIRONMENT);
} catch {
  console.error("Select --variant development|preview for staging, or --variant production for production. Values withheld.");
  process.exit(1);
}
const required = [
  "APP_ORIGIN",
  "NORTHSIDE_MOBILE_ENVIRONMENT",
  `NORTHSIDE_MOBILE_${variant.toUpperCase()}_RETURN_URI`,
  "SHOPIFY_SHOP",
  "SHOPIFY_EXPECTED_ISSUER",
  "SHOPIFY_CUSTOMER_CLIENT_ID",
  "SHOPIFY_CUSTOMER_CLIENT_SECRET",
  "SESSION_ENCRYPTION_KEY",
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error("Missing configuration names: " + missing.join(", "));
  process.exitCode = 1;
} else {
  try {
    mobileConfiguration(variant);
    if (process.env.NORTHSIDE_FIXTURES !== "0") throw Error();
    if (process.env.SHOPIFY_SHOP !== "9i3hnb-jw.myshopify.com") throw Error();
    if (
      Buffer.from(process.env.SESSION_ENCRYPTION_KEY!, "base64").length !== 32
    )
      throw Error();
    const runtime = databaseConfig(process.env.DATABASE_URL!),
      auth = databaseConfig(process.env.AUTH_DATABASE_URL!);
    // Supabase session/transaction poolers append the project reference to LOGIN names.
    // The existing runtime transaction check remains authoritative for current_user/RLS.
    if (
      !/^northside_runtime(?:\.[a-z0-9]{20})?$/.test(String(runtime.user)) ||
      !/^northside_auth(?:\.[a-z0-9]{20})?$/.test(String(auth.user))
    )
      throw Error();
    console.log(
      "Local mobile configuration shape passed. Hosted provider, SQL role grants and real login remain unverified.",
    );
  } catch {
    console.error(
      "Mobile configuration validation failed. Check origin, return URI, environment, fixture exclusion, verified shop, encryption key length and SQL role/transport. Values withheld.",
    );
    process.exitCode = 1;
  }
}
