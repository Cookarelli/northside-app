import {
  getStore,
  requireRole,
  login,
  logout,
  assertSameOrigin,
} from "@northside/data";
import { Commerce, CommerceError, type Mapping } from "@northside/domain";
import {
  configuration,
  ShopifyError,
  verifyOrder,
  verifyWebhook,
} from "@northside/shopify";
import QRCode from "qrcode";

const cookieName = "northside_instore_customer";
function cookie(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? ""
  );
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function sessionResponse(
  request: Request,
  result: { secret: string; session: unknown },
) {
  const response = json(result.session);
  response.headers.set(
    "Set-Cookie",
    `${cookieName}=${result.secret}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  );
  response.headers.append(
    "Set-Cookie",
    `northside_instore_shared=${(result.session as { shared?: boolean }).shared ? "1" : "0"}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  );
  if ((result.session as { shared?: boolean }).shared)
    response.headers.append(
      "Set-Cookie",
      `northside_staff=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    );
  return response;
}
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 20_000) throw new CommerceError("Request too large.", 413);
  try {
    const b = JSON.parse(text);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw 0;
    return b as Record<string, unknown>;
  } catch {
    throw new CommerceError("Invalid request body.");
  }
}
function string(value: unknown) {
  if (typeof value !== "string" || value.length > 300)
    throw new CommerceError("Invalid input.");
  return value;
}
function integer(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new CommerceError("Invalid number.");
  return value;
}
export async function handle(request: Request, path: string[]) {
  const route = path.join("/");
  const secret = cookie(request);
  try {
    const fixture =
      process.env.COMMERCE_MODE === "fixture" &&
      process.env.NODE_ENV !== "production";
    if (!fixture)
      throw new CommerceError(
        "In-store rehearsal requires explicit local fixture mode. Live in-store operations are not enabled.",
        503,
      );
    const commerce = new Commerce(getStore(), Date.now, fixture);
    if (route === "shopify/webhook" && request.method === "POST") {
      if (commerce.fixture)
        throw new CommerceError(
          "Live webhook processing is disabled in fixture mode.",
          403,
        );
      const config = configuration();
      const raw = Buffer.from(await request.arrayBuffer());
      if (raw.length > 1_000_000)
        throw new CommerceError("Request too large.", 413);
      if (
        !verifyWebhook(
          raw,
          request.headers.get("x-shopify-hmac-sha256"),
          config.webhookSecret,
        ) ||
        request.headers.get("x-shopify-shop-domain") !== config.domain
      )
        throw new CommerceError("Webhook authentication failed.", 401);
      if (request.headers.get("x-shopify-topic") !== "orders/paid")
        throw new CommerceError("Unsupported webhook topic.", 400);
      const event = request.headers.get("x-shopify-webhook-id");
      if (!event) throw new CommerceError("Missing event ID.");
      const data = JSON.parse(raw.toString()) as {
        admin_graphql_api_id?: string;
      };
      const order = await verifyOrder(config, data.admin_graphql_api_id ?? "");
      return json(await commerce.verifiedPayment(event, order));
    }
    if (request.method !== "GET") assertSameOrigin(request);
    if ((path[0] === "staff" || path[0] === "admin") && !commerce.fixture)
      throw new CommerceError(
        "Live staff access requires the existing invited-staff identity adapter. This local rehearsal is disabled in production.",
        503,
      );
    if (route === "staff/login" && request.method === "POST")
      return login(request, "staff");
    if (route === "staff/logout" && request.method === "POST")
      return logout(request, "staff");
    if (route === "catalog" && request.method === "GET")
      return json({
        mode: commerce.fixture ? "fixture" : "live",
        products: await commerce.catalog(),
      });
    if (path[0] === "qr" && path[1] && request.method === "GET")
      return json(await commerce.resolve(path[1]));
    if (route === "session" && request.method === "GET")
      return json(await commerce.current(secret));
    if (route === "session" && request.method === "POST") {
      const b = await body(request);
      const shared =
        b.shared === undefined
          ? /(?:^|;\s*)northside_instore_shared=1(?:;|$)/.test(
              request.headers.get("cookie") ?? "",
            )
          : b.shared === true;
      if (
        shared &&
        /(?:^|;\s*)__Host-ns_session=[^;]+/.test(
          request.headers.get("cookie") ?? "",
        )
      )
        throw new CommerceError(
          "Sign out of the existing Northside account before using this as a shared iPad.",
          409,
        );
      return sessionResponse(request, await commerce.reset(secret, shared));
    }
    if (route === "session/touch" && request.method === "POST")
      return json(await commerce.current(secret, true));
    if (route === "basket" && request.method === "POST") {
      const b = await body(request);
      return json(
        await commerce.edit(
          secret,
          integer(b.version),
          string(b.variantId),
          integer(b.quantity),
        ),
      );
    }
    if (route === "handoff" && request.method === "POST") {
      const b = await body(request);
      return json(await commerce.handoff(secret, integer(b.version)));
    }
    if (route === "handoff/revoke" && request.method === "POST")
      return json(await commerce.revokeHandoff(secret));
    if (route === "checkout" && request.method === "POST")
      throw new CommerceError(
        commerce.fixture
          ? "Shopify checkout is blocked in fixture mode. Choose Pay at Counter for the local demonstration."
          : "Online payment is blocked until pickup, location, tax, plan and duplicate-purchase behavior are verified in a Shopify test store.",
        503,
      );
    if (route === "code-image" && request.method === "GET") {
      const s = await commerce.current(secret);
      const type = new URL(request.url).searchParams.get("type");
      const value =
        type === "collection" ? s.collectionCode : s.handoff?.reference;
      if (!value) throw new CommerceError("No code is available.", 404);
      const url = new URL(
        type === "collection"
          ? `/in-store/staff?collection=${value}`
          : `/in-store/staff?handoff=${value}`,
        request.url,
      ).toString();
      return new Response(
        new Uint8Array(
          await QRCode.toBuffer(url, {
            width: 288,
            margin: 4,
            errorCorrectionLevel: "M",
          }),
        ),
        {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        },
      );
    }
    if (path[0] === "staff") {
      const staff = await requireRole(request, "staff");
      if (route === "staff/queue" && request.method === "GET")
        return json(await commerce.queue());
      if (route === "staff/handoff" && request.method === "POST") {
        const b = await body(request);
        return json(await commerce.inspectHandoff(string(b.reference)));
      }
      if (route === "staff/claim" && request.method === "POST") {
        const b = await body(request);
        return json(await commerce.claimHandoff(string(b.reference), staff.id));
      }
      if (route === "staff/fixture-payment" && request.method === "POST") {
        const b = await body(request);
        return json(await commerce.fixturePayment(string(b.id), staff.id));
      }
      if (route === "staff/transition" && request.method === "POST") {
        const b = await body(request);
        if (b.next !== "ready" && b.next !== "collected")
          throw new CommerceError("Invalid transition.");
        return json(
          await commerce.transition(
            string(b.id),
            b.next,
            staff.id,
            b.collectionCode === undefined
              ? undefined
              : string(b.collectionCode),
          ),
        );
      }
      if (route === "staff/reconcile" && request.method === "POST") {
        if (commerce.fixture)
          throw new CommerceError(
            "Live order reconciliation is disabled in fixture mode.",
            403,
          );
        const b = await body(request);
        const order = await verifyOrder(configuration(), string(b.orderId));
        return json(
          await commerce.verifiedPayment(`reconcile:${order.id}`, order),
        );
      }
    }
    if (route === "admin/mapping" && request.method === "POST") {
      const actor = await requireRole(request, "staff");
      const b = await body(request);
      const m = b.mapping as Mapping;
      if (!m || !["product", "collection", "entry"].includes(m.kind))
        throw new CommerceError("Invalid mapping.");
      if (
        m.kind === "product" &&
        (typeof m.productId !== "string" ||
          (m.variantId !== undefined && typeof m.variantId !== "string"))
      )
        throw new CommerceError("Invalid product mapping.");
      if (
        m.kind === "collection" &&
        (!Array.isArray(m.productIds) || typeof m.title !== "string")
      )
        throw new CommerceError("Invalid collection mapping.");
      return json(await commerce.remap(string(b.code), m, actor.id));
    }
    throw new CommerceError("Not found.", 404);
  } catch (error) {
    const e = error as { status?: number; message?: string };
    const known =
      error instanceof CommerceError ||
      error instanceof ShopifyError ||
      e.status === 401 ||
      e.status === 403 ||
      e.status === 429;
    return json(
      {
        error: known
          ? e.message
          : "The request could not be completed. Please try again or ask staff.",
      },
      known ? (e.status ?? 400) : 500,
    );
  }
}
