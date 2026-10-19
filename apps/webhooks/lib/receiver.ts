import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SHOP = "9i3hnb-jw.myshopify.com";
export const API_VERSION = "2026-07";
export const topics = [
  "orders/paid",
  "orders/cancelled",
  "orders/updated",
  "refunds/create",
] as const;
export type Receipt = {
  shop: typeof SHOP;
  delivery: string;
  topic: (typeof topics)[number];
  orderId: string;
  apiVersion: typeof API_VERSION;
  bodyHash: string;
  test: boolean;
};
export class ReceiverError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const reject = (status: number, code: string): never => {
  throw new ReceiverError(status, code);
};
export const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function verify(
  request: Request,
  secret: string,
): Promise<Receipt> {
  if (!secret || secret.length < 16) reject(503, "receiver_not_configured");
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    reject(415, "json_required");
  if (
    request.headers.get("content-encoding") &&
    request.headers.get("content-encoding") !== "identity"
  )
    reject(415, "unsupported_encoding");
  const max = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max)
    reject(413, "request_too_large");
  if (!request.body) reject(400, "body_required");
  const reader = request.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + 1000;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ReceiverError(408, "body_timeout")),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (part.done) break;
      size += part.value.length;
      if (size > max) reject(413, "request_too_large");
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks);
  const signature = request.headers.get("x-shopify-hmac-sha256") || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature))
    reject(401, "invalid_webhook_signature");
  const expected = createHmac("sha256", secret).update(raw).digest();
  if (!timingSafeEqual(Buffer.from(signature, "base64"), expected))
    reject(401, "invalid_webhook_signature");
  if (request.headers.get("x-shopify-shop-domain") !== SHOP)
    reject(403, "unrecognized_shop");
  if (request.headers.get("x-shopify-api-version") !== API_VERSION)
    reject(400, "unsupported_api_version");
  const topic = request.headers.get("x-shopify-topic") || "";
  if (!(topics as readonly string[]).includes(topic))
    reject(400, "unsupported_webhook_topic");
  const delivery = request.headers.get("x-shopify-webhook-id") || "";
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      delivery,
    )
  )
    reject(400, "invalid_delivery_id");
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    reject(400, "invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    reject(400, "invalid_json");
  const source =
    topic === "refunds/create"
      ? payload.order_id
      : payload.admin_graphql_api_id;
  const orderId =
    typeof source === "number" && Number.isSafeInteger(source) && source > 0
      ? `gid://shopify/Order/${source}`
      : typeof source === "string" && /^[1-9][0-9]*$/.test(source)
        ? `gid://shopify/Order/${source}`
        : source;
  if (
    typeof orderId !== "string" ||
    !/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,24}$/.test(orderId)
  )
    reject(400, "invalid_order_id");
  return {
    shop: SHOP,
    delivery: delivery.toLowerCase(),
    topic: topic as Receipt["topic"],
    orderId,
    apiVersion: API_VERSION,
    bodyHash: createHash("sha256").update(raw).digest("hex"),
    test: payload.test === true,
  };
}

export async function handle(
  request: Request,
  save: (receipt: Receipt) => Promise<unknown>,
  environment: Record<string, string | undefined> = process.env,
) {
  try {
    if (request.method !== "POST")
      return Response.json(
        { error: "method_not_allowed" },
        { status: 405, headers: { ...headers, Allow: "POST" } },
      );
    if (environment.WEBHOOK_RECEIVER_MODE !== "pilot-inbox")
      reject(503, "receiver_disabled");
    const receipt = await verify(
      request,
      environment.SHOPIFY_APP_CLIENT_SECRET || "",
    );
    await save(receipt);
    // Metadata quarantine only: never payment verification, order processing or fulfillment.
    return Response.json({ received: true, mode: "pilot-inbox" }, { headers });
  } catch (error) {
    const known = error instanceof ReceiverError;
    return Response.json(
      { error: known ? error.code : "receipt_unavailable" },
      { status: known ? error.status : 503, headers },
    );
  }
}
