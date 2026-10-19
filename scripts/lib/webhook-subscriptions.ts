// Operator-side planning only. This module never calls a Shopify mutation.
export const WEBHOOK_VERSION = "2026-07";
export const WEBHOOK_TOPICS = [
  "ORDERS_PAID",
  "ORDERS_CANCELLED",
  "ORDERS_UPDATED",
  "REFUNDS_CREATE",
] as const;
export const inventoryQuery = `query PilotWebhookInventory($after: String) {
  shop { myshopifyDomain }
  currentAppInstallation { id app { id } accessScopes { handle } }
  webhookSubscriptions(first: 100, after: $after) {
    nodes { id topic uri format includeFields apiVersion { handle } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const createMutation = `mutation PilotWebhookCreate($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) {
    webhookSubscription { id topic uri format includeFields apiVersion { handle } }
    userErrors { field message }
  }
}`;
export type Subscription = {
  id: string;
  topic: string;
  uri: string;
  format: string;
  includeFields: string[];
  apiVersion: { handle: string };
};
export type Inventory = {
  shop: { myshopifyDomain: string };
  currentAppInstallation: {
    id: string;
    app: { id: string };
    accessScopes: { handle: string }[];
  };
  webhookSubscriptions: {
    nodes: Subscription[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};
export type Query = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<Inventory>;
export async function inventory(query: Query) {
  const subscriptions: Subscription[] = [],
    cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data = await query(inventoryQuery, { after });
    if (
      data.shop.myshopifyDomain !== "9i3hnb-jw.myshopify.com" ||
      data.currentAppInstallation.id !==
        "gid://shopify/AppInstallation/1196680151409" ||
      data.currentAppInstallation.app.id !== "gid://shopify/App/436021788673"
    )
      throw Error("shopify_identity_mismatch");
    const scopes = data.currentAppInstallation.accessScopes.map(
      (s) => s.handle,
    );
    if (scopes.length !== 1 || scopes[0] !== "read_orders")
      throw Error("shopify_scope_review_required");
    subscriptions.push(...data.webhookSubscriptions.nodes);
    const info = data.webhookSubscriptions.pageInfo;
    if (!info.hasNextPage) return subscriptions;
    if (!info.endCursor || cursors.has(info.endCursor))
      throw Error("incomplete_subscription_inventory");
    after = info.endCursor;
    cursors.add(after);
  }
  throw Error("incomplete_subscription_inventory");
}
export function subscriptionPlan(
  origin: string,
  existing: Subscription[],
  appVersion: string,
  appConfiguredTopics: string[],
) {
  const u = new URL(origin);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    !/^northside-webhook-pilot-[a-z0-9-]+-steves-projects-e37a4ef4\.vercel\.app$/.test(
      u.hostname,
    )
  )
    throw Error("receiver_preview_required");
  if (appVersion !== WEBHOOK_VERSION)
    throw Error("app_webhook_version_review_required");
  const uri = u.origin + "/api/shopify/webhooks";
  return WEBHOOK_TOPICS.map((topic) => {
    const includeFields =
      topic === "REFUNDS_CREATE"
        ? ["order_id"]
        : ["admin_graphql_api_id", "test"];
    const matching = existing.filter((s) => s.topic === topic);
    const exact =
      matching.length === 1 &&
      matching[0].uri === uri &&
      matching[0].format === "JSON" &&
      matching[0].apiVersion.handle === WEBHOOK_VERSION &&
      [...matching[0].includeFields].sort().join() ===
        [...includeFields].sort().join();
    // Preserve all existing subscriptions. App-configured topics need their own review;
    // they may not be returned by the API, and must not receive duplicate subscriptions.
    const action =
      appConfiguredTopics.some(
        (configured) => configured.replaceAll("/", "_").toUpperCase() === topic,
      ) ||
      (matching.length > 0 && !exact)
        ? "review-conflict"
        : exact
          ? "keep"
          : "prepare-create";
    return {
      topic,
      action,
      variables: {
        topic,
        subscription: { uri, format: "JSON", includeFields },
      },
      existingCount: matching.length,
    };
  });
}
