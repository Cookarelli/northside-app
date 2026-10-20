import { describe, it, expect, vi } from "vitest";
import {
  inventory,
  subscriptionPlan,
  type Inventory,
  type Subscription,
} from "../scripts/lib/webhook-subscriptions";
const origin =
  "https://northside-webhook-pilot-abcdefgh-steves-projects-e37a4ef4.vercel.app";
const data: Inventory = {
  shop: { myshopifyDomain: "9i3hnb-jw.myshopify.com" },
  currentAppInstallation: {
    id: "gid://shopify/AppInstallation/1196680151409",
    app: { id: "gid://shopify/App/436021788673" },
    accessScopes: [{ handle: "read_orders" }],
  },
  webhookSubscriptions: {
    nodes: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};
describe("read-only Shopify subscription planning", () => {
  it("prepares exactly four minimal-payload subscriptions without mutations", () => {
    const plan = subscriptionPlan(origin, [], "2026-07", []);
    expect(plan.map((p) => p.action)).toEqual(Array(4).fill("prepare-create"));
    expect(plan[3].variables.subscription.includeFields).toEqual(["order_id"]);
    expect(plan[0].variables.subscription.includeFields).toEqual([
      "admin_graphql_api_id",
      "test",
    ]);
  });
  it("preserves exact subscriptions and blocks conflicting or app-configured ones", () => {
    const existing: Subscription = {
      id: "gid://shopify/WebhookSubscription/1",
      topic: "ORDERS_PAID",
      uri: origin + "/api/shopify/webhooks",
      format: "JSON",
      includeFields: ["test", "admin_graphql_api_id"],
      apiVersion: { handle: "2026-07" },
    };
    expect(subscriptionPlan(origin, [existing], "2026-07", [])[0].action).toBe(
      "keep",
    );
    for (const changed of [
      { uri: "https://other.invalid" },
      { includeFields: [] },
      { apiVersion: { handle: "2026-10" } },
    ])
      expect(
        subscriptionPlan(
          origin,
          [{ ...existing, ...changed }],
          "2026-07",
          [],
        )[0].action,
      ).toBe("review-conflict");
    expect(
      subscriptionPlan(origin, [existing, existing], "2026-07", [])[0].action,
    ).toBe("review-conflict");
    expect(
      subscriptionPlan(origin, [], "2026-07", ["orders/paid"])[0].action,
    ).toBe("review-conflict");
    expect(
      subscriptionPlan(origin, [], "2026-07", ["ORDERS_PAID"])[0].action,
    ).toBe("review-conflict");
  });
  it("refuses customer/control, production aliases, query credentials and wrong version", () => {
    for (const value of [
      origin.replace("webhook", "customer"),
      origin.replace("webhook", "control"),
      "https://northside-webhook-pilot.vercel.app",
      origin + "?token=secret",
      origin.replace("https:", "http:"),
    ])
      expect(() => subscriptionPlan(value, [], "2026-07", [])).toThrow(
        "receiver_preview_required",
      );
    expect(() => subscriptionPlan(origin, [], "2026-10", [])).toThrow(
      "app_webhook_version_review_required",
    );
  });
  it("reads all pages and verifies installation and read-only scope on every page", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        ...data,
        webhookSubscriptions: {
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: "next" },
        },
      })
      .mockResolvedValue(data);
    expect(await inventory(query)).toEqual([]);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("query PilotWebhookInventory"),
      { after: "next" },
    );
    for (const changed of [
      { shop: { myshopifyDomain: "wrong.myshopify.com" } },
      {
        currentAppInstallation: {
          ...data.currentAppInstallation,
          accessScopes: [{ handle: "write_orders" }],
        },
      },
      {
        currentAppInstallation: {
          ...data.currentAppInstallation,
          app: { id: "wrong" },
        },
      },
    ])
      await expect(
        inventory(async () => ({ ...data, ...changed })),
      ).rejects.toThrow();
  });
  it("fails on pagination loops rather than claiming inventory complete", async () => {
    await expect(
      inventory(async () => ({
        ...data,
        webhookSubscriptions: {
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: "same" },
        },
      })),
    ).rejects.toThrow("incomplete_subscription_inventory");
  });
});
