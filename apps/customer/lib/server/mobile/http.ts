import {
  readCatalog,
  readReleases,
  readProduct,
  readScannedProduct,
} from "./catalog";
import { requestPhotoAction } from "../service-request-photo-http";
import { mobileShoppingHandler } from "./shopping";
import {
  approvedNativeScan,
  readNativeCatalog,
  readNativeProduct,
} from "./approved-native-catalog";
import { nativeScanCartGate, nativeScanCartSelected } from "./scan-cart-gate";
import {
  readNativeTracking,
  readNativeTrackingPhoto,
  acceptNativeTerms,
} from "./tracking";
import {
  readCustomerInfo,
  readCustomerWallet,
  readCustomerBreaks,
} from "./customer-content";
import { customerPrivacy } from "./privacy-request";
import { withNativeTracking } from "./tracking";
import {
  requestConfig,
  listRequests,
  submitRequest,
  requestClaim,
} from "../service-requests";
import {
  catalogInputSchema,
  scanInputSchema,
  deletionInputSchema,
} from "../../../../../packages/customer-contracts/src/mvp";
import "server-only";
import { randomUUID } from "node:crypto";
import { AccessError, SESSION_COOKIE, validToken } from "../security";
import {
  mobileResponseSchema,
  mobileErrorCodeSchema,
  MOBILE_CONTRACT_VERSION,
  mobileIntentRequestSchema,
  mobileExchangeRequestSchema,
  mobileRenewRequestSchema,
} from "../../../../../packages/customer-contracts/src/mobile";
import {
  createMobileIntent,
  startMobileIntent,
  completeMobileCallback,
  exchangeMobile,
  renewMobile,
  logoutMobile,
  readNativeAccount,
  readNativeServices,
  MOBILE_ATTEMPT_COOKIE,
} from "./service";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const attemptCookie = (value: string, maxAge: number) =>
  `${MOBILE_ATTEMPT_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function cookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + "="));
  if (values.length !== 1) return undefined;
  return values[0].slice(name.length + 1);
}
function hasSessionCookie(request: Request) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .some((s) => s.trim().startsWith(SESSION_COOKIE + "="));
}
function bearer(request: Request) {
  if (hasSessionCookie(request)) throw new AccessError(401, "unauthorized");
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) throw new AccessError(401, "unauthorized");
  return match[1];
}
export async function mobileJson(request: Request) {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new AccessError(400, "invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "invalid_request");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 8192) throw new AccessError(413, "invalid_request");
      chunks.push(part.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AccessError(400, "invalid_request");
  }
}
function successMvp(value: unknown) {
  return Response.json(value, { headers });
}
function success(value: unknown) {
  const result = mobileResponseSchema.safeParse(value);
  if (!result.success) throw new AccessError(503, "invalid_provider_data");
  return Response.json(result.data, { headers });
}
function input<T>(
  schema: {
    safeParse: (v: unknown) => { success: true; data: T } | { success: false };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AccessError(400, "invalid_request");
  return result.data;
}
export function mobileError(error: unknown) {
  const proposed =
    error instanceof AccessError ? error.code : "service_unavailable";
  const parsed = mobileErrorCodeSchema.safeParse(proposed);
  const code = parsed.success
    ? parsed.data
    : error instanceof AccessError && [400, 413, 415].includes(error.status)
      ? "invalid_request"
      : error instanceof AccessError && error.status === 401
        ? "session_expired"
        : error instanceof AccessError && error.status === 404
          ? "not_found"
          : error instanceof AccessError && error.status === 429
            ? "rate_limited"
            : "service_unavailable";
  const status = error instanceof AccessError ? error.status : 503;
  return Response.json(
    {
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "error",
      error: { code },
      requestId: randomUUID(),
    },
    { status, headers },
  );
}
export async function mobileHandler(request: Request) {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\/mobile\/v1\/?/, "");
  try {
    if (path === "auth/start" && request.method === "GET") {
      if (
        url.searchParams.size !== 1 ||
        url.searchParams.getAll("intent").length !== 1
      )
        throw new AccessError(400, "invalid_request");
      const result = await startMobileIntent(
        url.searchParams.get("intent") ?? "",
      );
      return new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location: result.url,
          "Set-Cookie": attemptCookie(result.cookie, 300),
        },
      });
    }
    if (path === "auth/callback" && request.method === "GET") {
      const token = cookie(request, MOBILE_ATTEMPT_COOKIE);
      if (!validToken(token)) throw new AccessError(401, "invalid_callback");
      try {
        const target = await completeMobileCallback(token, url);
        return new Response(null, {
          status: 303,
          headers: {
            ...headers,
            Location: target,
            "Set-Cookie": attemptCookie("", 0),
          },
        });
      } catch (error) {
        const response = mobileError(error);
        response.headers.set("Set-Cookie", attemptCookie("", 0));
        return response;
      }
    }
    // Native transport never borrows a browser session or client-selected identity.
    if (hasSessionCookie(request)) throw new AccessError(401, "unauthorized");
    if (
      path === "me/request-photos" &&
      ["GET", "POST"].includes(request.method)
    ) {
      const keys = [...url.searchParams.keys()],
        allowed =
          request.method === "POST" ? ["request_id", "photo_id"] : ["photo_id"];
      if (
        keys.length !== allowed.length ||
        new Set(keys).size !== keys.length ||
        keys.some((k) => !allowed.includes(k))
      )
        throw new AccessError(400, "invalid_request");
      return await withNativeTracking(bearer(request), (db, a) =>
        requestPhotoAction(request, db, a),
      );
    }
    if (request.method === "GET" && path === "releases" && !url.search)
      return successMvp(await readReleases());
    if (request.method === "GET" && path === "info" && !url.search)
      return successMvp(await readCustomerInfo());
    if (request.method === "GET" && path === "catalog") {
      const keys = [...url.searchParams.keys()];
      if (new Set(keys).size !== keys.length)
        throw new AccessError(400, "invalid_request");
      const catalogInput = input(
        catalogInputSchema,
        Object.fromEntries(url.searchParams),
      );
      if (nativeScanCartSelected()) {
        nativeScanCartGate();
        return successMvp(await readNativeCatalog(catalogInput));
      }
      return successMvp(await readCatalog(catalogInput));
    }
    const productHandle = path.match(/^catalog\/([a-z0-9-]{1,150})$/);
    if (request.method === "GET" && productHandle) {
      if (
        [...url.searchParams.keys()].some((k) => k !== "after") ||
        url.searchParams.getAll("after").length > 1
      )
        throw new AccessError(400, "invalid_request");
      const query = input(
        catalogInputSchema,
        Object.fromEntries(url.searchParams),
      );
      if (nativeScanCartSelected()) {
        nativeScanCartGate();
        return successMvp(
          await readNativeProduct(productHandle[1], query.after),
        );
      }
      return successMvp(await readProduct(productHandle[1], query.after));
    }
    if (request.method === "POST") {
      if (url.search) throw new AccessError(400, "invalid_request");
      const body = await mobileJson(request);
      if (path === "me/service-requests") {
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new AccessError(400, "invalid_request");
        const b = body as Record<string, unknown>;
        return successMvp(
          await withNativeTracking<unknown>(bearer(request), async (db, a) => {
            if (b.action === "claim") return requestClaim(db, a, b);
            if (
              b.action !== "submit" ||
              !["ios", "android"].includes(String(b.platform))
            )
              throw new AccessError(400, "invalid_request");
            return submitRequest(
              db,
              a,
              b.input,
              b.platform === "ios" ? "native_ios" : "native_android",
            );
          }),
        );
      }
      if (path === "shopping") return mobileShoppingHandler(request, body);
      if (path === "me/tracking/terms")
        return successMvp(await acceptNativeTerms(bearer(request), body));
      if (path === "scan") {
        const scan = input(scanInputSchema, body);
        if (nativeScanCartSelected()) {
          nativeScanCartGate();
          try {
            return successMvp(await approvedNativeScan(scan.code, scan.format));
          } catch (error) {
            if (
              !(error instanceof AccessError) ||
              error.code !== "unsupported_qr"
            )
              throw error;
          }
        }
        return successMvp(await readScannedProduct(scan.code, scan.format));
      }
      if (path === "me/deletion-request") {
        input(deletionInputSchema, body);
        return successMvp(await customerPrivacy(bearer(request), true));
      }
      if (path === "auth/intents")
        return success(
          await createMobileIntent(input(mobileIntentRequestSchema, body)),
        );
      if (path === "auth/exchange")
        return success(
          await exchangeMobile(input(mobileExchangeRequestSchema, body)),
        );
      if (path === "auth/renew")
        return success(
          await renewMobile(input(mobileRenewRequestSchema, body).renewalToken),
        );
      if (path === "auth/logout")
        return success(
          await logoutMobile(
            input(mobileRenewRequestSchema, body).renewalToken,
          ),
        );
    }
    if (request.method === "GET") {
      const token = bearer(request);
      if (path === "me/service-requests" && !url.search)
        return successMvp(
          await withNativeTracking(token, (db, a) => listRequests(db, a)),
        );
      if (path === "me/service-requests/config" && !url.search)
        return successMvp(
          await withNativeTracking(token, (db, a) => requestConfig(db, a)),
        );
      const tracking = path.match(
        /^me\/tracking\/(grading|consignment)(?:\/([a-f0-9-]{36})(?:\/photos\/([a-f0-9-]{36}))?)?$/i,
      );
      if (tracking && !url.search) {
        const service = tracking[1] as "grading" | "consignment";
        if (tracking[3])
          return await readNativeTrackingPhoto(
            token,
            service,
            tracking[2],
            tracking[3],
          );
        return successMvp(
          await readNativeTracking(token, service, tracking[2]),
        );
      }
      if (!url.search && path === "me/wallet")
        return successMvp(await readCustomerWallet(token));
      if (!url.search && path === "me/breaks")
        return successMvp(await readCustomerBreaks(token));
      if (!url.search && path === "me/deletion-request")
        return successMvp(await customerPrivacy(token));
      if (path === "me" && !url.search)
        return success(await readNativeAccount(token, false));
      if (path === "me/orders") {
        if (
          [...url.searchParams.keys()].some((k) => k !== "after") ||
          url.searchParams.getAll("after").length > 1
        )
          throw new AccessError(400, "invalid_request");
        return success(
          await readNativeAccount(
            token,
            true,
            url.searchParams.get("after") ?? undefined,
          ),
        );
      }
      const match = path.match(
        /^me\/(cards|consignments)(?:\/([a-f0-9-]{36}))?$/i,
      );
      if (match && !url.search)
        return success(
          await readNativeServices(
            token,
            match[1] as "cards" | "consignments",
            match[2],
          ),
        );
    }
    throw new AccessError(404, "not_found");
  } catch (error) {
    return mobileError(error);
  }
}
