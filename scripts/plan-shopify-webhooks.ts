import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  lstatSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  inventory,
  subscriptionPlan,
  createMutation,
  type Inventory,
} from "./lib/webhook-subscriptions";

function privateFile(path: string) {
  const parent = lstatSync(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid?.() ||
    (parent.mode & 0o777) !== 0o700
  )
    throw Error("unsafe_private_directory");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.uid !== process.getuid?.() ||
      (s.mode & 0o777) !== 0o600 ||
      s.nlink !== 1 ||
      s.size > 65536
    )
      throw Error("unsafe_private_file");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
async function json(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok || !response.body) throw Error("shopify_request_failed");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const p = await reader.read();
    if (p.done) break;
    size += p.value.length;
    if (size > 512 * 1024) {
      await reader.cancel();
      throw Error("shopify_response_too_large");
    }
    chunks.push(p.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function main() {
  const [file, origin, configFile, ...extra] = process.argv.slice(2);
  if (!file || !origin || !configFile || extra.length)
    throw Error(
      "usage: plan-shopify-webhooks <private-operator-env> <receiver-preview-origin> <private-reviewed-app-config-json>",
    );
  const config = JSON.parse(privateFile(resolve(configFile)));
  if (
    config.appId !== "gid://shopify/App/436021788673" ||
    config.webhookApiVersion !== "2026-07" ||
    !Array.isArray(config.appConfiguredTopics) ||
    config.appConfiguredTopics.some((s: unknown) => typeof s !== "string")
  )
    throw Error("app_configuration_review_required");
  // Validate destination/config before reading secrets or making requests.
  if (origin !== "--inspect")
    subscriptionPlan(
      origin,
      [],
      config.webhookApiVersion,
      config.appConfiguredTopics,
    );
  const env = parseEnv(privateFile(resolve(file)));
  if (
    config.sameOrgConfirmed !== true ||
    !env.SHOPIFY_APP_CLIENT_ID ||
    !env.SHOPIFY_APP_CLIENT_SECRET
  )
    throw Error("private_shopify_app_credentials_required");
  const token = await json(
    "https://9i3hnb-jw.myshopify.com/admin/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.SHOPIFY_APP_CLIENT_ID,
        client_secret: env.SHOPIFY_APP_CLIENT_SECRET,
      }),
    },
  );
  if (
    typeof token.access_token !== "string" ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 60 ||
    token.scope !== "read_orders"
  )
    throw Error("shopify_scope_or_expiry_review_required");
  const existing = await inventory(async (query, variables) => {
    const data = await json(
      "https://9i3hnb-jw.myshopify.com/admin/api/2026-07/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token.access_token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (data.errors || !data.data) throw Error("shopify_inventory_failed");
    return data.data as Inventory;
  });
  if (origin === "--inspect") {
    console.log(
      JSON.stringify(
        {
          mode: "read-only-inventory",
          subscriptionsChanged: 0,
          complete: true,
          subscriptions: existing.map((s) => ({
            topic: s.topic,
            apiVersion: s.apiVersion.handle,
            format: s.format,
            includeFields: s.includeFields,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const plan = subscriptionPlan(
    origin,
    existing,
    config.webhookApiVersion,
    config.appConfiguredTopics,
  );
  console.log(
    JSON.stringify(
      {
        mode: "read-only-plan",
        subscriptionsChanged: 0,
        publicReceiverAndRoleVerificationRequired: true,
        plan,
        createMutation,
      },
      null,
      2,
    ),
  );
  if (plan.some((s) => s.action === "review-conflict")) process.exitCode = 2;
}
main().catch(() => {
  console.error(
    "Webhook planning stopped: verify private file permissions, app credentials, reviewed config, destination and Shopify access. No subscriptions were changed.",
  );
  process.exitCode = 1;
});
