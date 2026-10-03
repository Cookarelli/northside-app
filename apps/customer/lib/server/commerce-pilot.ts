import "server-only";
import { fixturesAllowed, publicFlags } from "../policy.mjs";
import { type Actor, requireRole } from "./db";
import { SHOP } from "./providers";
import { AccessError, appOrigin } from "./security";
import { adminQuery } from "./admin-shopify";
import { TESTED_API_VERSION } from "./shopify-config";
import { browse, storefront, type Query } from "./storefront";
import { productProof } from "./store";

export const pilotTopics = [
  "ORDERS_PAID",
  "ORDERS_CANCELLED",
  "ORDERS_UPDATED",
  "REFUNDS_CREATE",
] as const;

export function requireCommerceInspector(actor: Actor) {
  requireRole(actor, ["owner", "admin"]);
}

export async function inspectInstallation(query: Query) {
  const data = await query<{
    shop: {
      myshopifyDomain: string;
      plan: {
        publicDisplayName: string;
        shopifyPlus: boolean;
        partnerDevelopment: boolean;
      };
    };
    currentAppInstallation: {
      id: string;
      app: { id: string; title: string };
      accessScopes: { handle: string }[];
    };
  }>(
    `query NorthsidePilotInstallation {
      shop { myshopifyDomain plan { publicDisplayName shopifyPlus partnerDevelopment } }
      currentAppInstallation { id app { id title } accessScopes { handle } }
    }`,
    {},
  );
  if (data.shop.myshopifyDomain !== SHOP)
    throw new AccessError(503, "shopify_shop_mismatch");
  return {
    shop: data.shop.myshopifyDomain,
    plan: data.shop.plan,
    installationId: data.currentAppInstallation.id,
    app: data.currentAppInstallation.app,
    scopes: data.currentAppInstallation.accessScopes
      .map((s) => s.handle)
      .sort(),
  };
}

export async function inspectWebhookSubscriptions(
  query: Query,
  origin?: string,
) {
  const data = await query<{
    webhookSubscriptions: {
      nodes: { topic: string; uri: string; apiVersion: { handle: string } }[];
      pageInfo: { hasNextPage: boolean };
    };
  }>(
    `query NorthsidePilotWebhooks($topics: [WebhookSubscriptionTopic!]) {
      webhookSubscriptions(first: 100, topics: $topics) {
        nodes { topic uri apiVersion { handle } }
        pageInfo { hasNextPage }
      }
    }`,
    { topics: pilotTopics },
  );
  // Never render provider callback URLs: an unrelated subscription could embed credentials.
  const expected = origin ? `${origin}/api/shopify/webhooks` : undefined;
  const subscriptions = data.webhookSubscriptions.nodes.map((s) => ({
    topic: s.topic,
    version: s.apiVersion.handle,
    matchesEndpoint: expected !== undefined && s.uri === expected,
    matchesVersion: s.apiVersion.handle === TESTED_API_VERSION,
  }));
  return {
    subscriptions,
    complete: !data.webhookSubscriptions.pageInfo.hasNextPage,
    expectedEndpointConfigured: !!expected,
    missingTopics: pilotTopics.filter(
      (topic) =>
        !subscriptions.some(
          (s) => s.topic === topic && s.matchesEndpoint && s.matchesVersion,
        ),
    ),
  };
}

type Inspection<T> = { state: "observed"; data: T } | { state: "unavailable" };
async function observe<T>(work: () => Promise<T>): Promise<Inspection<T>> {
  try {
    return { state: "observed", data: await work() };
  } catch {
    return { state: "unavailable" };
  }
}

export async function inspectCommercePilot(
  actor: Actor,
  productId?: string,
  dependencies: {
    catalog: () => Query;
    admin: () => Promise<Query>;
    origin: () => string;
  } = { catalog: storefront, admin: adminQuery, origin: appOrigin },
) {
  requireCommerceInspector(actor);
  if (fixturesAllowed(process.env))
    throw new AccessError(503, "live_commerce_disabled_in_fixture_mode");
  let origin: string | undefined;
  try {
    origin = dependencies.origin();
  } catch {
    /* Report missing configuration without raw errors. */
  }
  const catalog = await observe(async () => browse(dependencies.catalog(), {}));
  const selectedProduct = productId
    ? await observe(async () => productProof(dependencies.catalog(), productId))
    : null;
  const installation = await observe(async () =>
    inspectInstallation(await dependencies.admin()),
  );
  // A different shop or failed installation check must not be described as this shop's webhooks.
  const webhooks =
    installation.state === "observed"
      ? await observe(async () =>
          inspectWebhookSubscriptions(await dependencies.admin(), origin),
        )
      : { state: "unavailable" as const };
  return {
    checkedAt: new Date().toISOString(),
    version: TESTED_API_VERSION,
    catalog,
    selectedProduct,
    installation,
    webhooks,
    // These are the canonical source-controlled gates, not a new environment switch.
    purchasesEnabled: publicFlags.purchases,
    pickupEnabled: publicFlags.pickup,
    checkoutVerified: false as const,
    posVerified: false as const,
  };
}
