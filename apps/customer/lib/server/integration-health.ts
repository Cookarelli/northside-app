import "server-only";
import { browse, storefront } from "./storefront";
import { adminQuery } from "./admin-shopify";
import { authReadiness, SHOP } from "./providers";
import { commerceConfig, TESTED_API_VERSION } from "./shopify-config";
export async function integrationHealth() {
  let config = "Not configured or invalid";
  try {
    commerceConfig();
    config = "Validated configuration";
  } catch {
    /* No secrets in the projection. */
  }
  const catalog = await Promise.resolve()
    .then(() => browse(storefront(), {}))
    .then((d) =>
      d.products.nodes.length
        ? "Connected · published products returned"
        : "Connected · no published products returned",
    )
    .catch(() => "Not connected or unavailable");
  const admin = await Promise.resolve()
    .then(adminQuery)
    .then((q) =>
      q<{
        shop: { myshopifyDomain: string };
        currentAppInstallation: { accessScopes: { handle: string }[] };
      }>(
        "query IntegrationHealth { shop { myshopifyDomain } currentAppInstallation { accessScopes { handle } } }",
        {},
      ),
    )
    .then((d) =>
      d.shop.myshopifyDomain === SHOP &&
      d.currentAppInstallation.accessScopes.some(
        (s) => s.handle === "read_orders",
      )
        ? "Connected · order-read permission verified"
        : "Required shop or order permission missing",
    )
    .catch(() => "Not connected or unavailable");
  return [
    [
      "Shopify configuration",
      `${config} · tested contract ${TESTED_API_VERSION}`,
    ],
    ["Published catalog", catalog],
    ["Order reconciliation access", admin],
    [
      "Northside loyalty",
      "Ledger, recovery worker and wallet implemented locally; live economics inactive, discount access and checkout verification pending",
    ],
    [
      "Customer login",
      authReadiness().customer
        ? "Configuration present · real login test still required"
        : "Awaiting configuration",
    ],
    [
      "Checkout",
      "Disabled · authorized guest/customer checkout and fulfillment tests pending",
    ],
    [
      "Inventory routing",
      "Unverified · Retail Floor, Breaker Storage and Excess Storage remain separate",
    ],
  ];
}
