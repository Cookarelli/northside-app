/** Restrictive host routing for a separately approved native API preview alias.
 * This is not authentication; route/service ownership checks still run normally.
 */
export const NORTHSIDE_NATIVE_API_PREVIEW_HOST =
  "northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app";

/** A temporary internal QA grant expires without relying on another deployment. */
export function nativeCustomerServicesApproved(
  environment: Record<string, string | undefined>,
  now = Date.now(),
) {
  if (
    environment.NORTHSIDE_MOBILE_ENVIRONMENT !== "staging" ||
    environment.NORTHSIDE_NATIVE_API_HOST !==
      NORTHSIDE_NATIVE_API_PREVIEW_HOST ||
    environment.NORTHSIDE_MOBILE_CUSTOMER_SERVICES_APPROVED !== "true" ||
    !Number.isFinite(now)
  )
    return false;
  const start = environment.NORTHSIDE_MOBILE_QA_APPROVED_AT;
  const end = environment.NORTHSIDE_MOBILE_QA_EXPIRES_AT;
  if (!start || !end) return false;
  const approvedAt = Date.parse(start),
    expiresAt = Date.parse(end);
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    new Date(approvedAt).toISOString() !== start ||
    new Date(expiresAt).toISOString() !== end ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > 24 * 60 * 60 * 1000
  )
    return false;
  return now >= approvedAt && now < expiresAt;
}

export function nativeIngressAllowed(
  url: string,
  method: string,
  apiHost?: string,
  requestHost?: string | null,
  customerServices = false,
) {
  const target = new URL(url);
  // Host routes the Vercel request. Do not trust client-supplied forwarded-host headers.
  const hostname = requestHost
    ? requestHost.toLowerCase().replace(/:\d+$/, "")
    : target.hostname;
  // This reserved preview alias stays closed even if a future deployment omits its env setting.
  if (hostname !== NORTHSIDE_NATIVE_API_PREVIEW_HOST) return true;
  if (apiHost !== NORTHSIDE_NATIVE_API_PREVIEW_HOST) return false;
  const path = target.pathname;
  if (
    method === "POST" &&
    !target.search &&
    ["/api/mobile/v1/scan", "/api/mobile/v1/shopping"].includes(path)
  )
    return true;
  if (
    method === "GET" &&
    (path === "/api/mobile/v1/catalog" ||
      /^\/api\/mobile\/v1\/catalog\/[a-z0-9-]{1,150}$/.test(path))
  )
    return true;
  // Existing authenticated native endpoints are exposed only by an explicit
  // staging opt-in. Their own bearer/PKCE/parent-session/RLS checks still apply.
  if (!customerServices) return false;
  const base = "/api/mobile/v1/";
  if (
    method === "POST" &&
    !target.search &&
    [
      "auth/intents",
      "auth/exchange",
      "auth/renew",
      "auth/logout",
      "me/service-requests",
      "me/tracking/terms",
      "me/deletion-request",
    ].some((p) => path === base + p)
  )
    return true;
  if (
    method === "GET" &&
    [
      "auth/start",
      "auth/callback",
      "info",
      "releases",
      "me",
      "me/orders",
      "me/wallet",
      "me/breaks",
      "me/deletion-request",
      "me/service-requests",
      "me/service-requests/config",
    ].some((p) => path === base + p)
  )
    return true;
  if (["GET", "POST"].includes(method) && path === base + "me/request-photos")
    return true;
  return (
    method === "GET" &&
    (/^\/api\/mobile\/v1\/me\/(cards|consignments)(?:\/[a-f0-9-]{36})?$/i.test(
      path,
    ) ||
      /^\/api\/mobile\/v1\/me\/tracking\/(grading|consignment)(?:\/[a-f0-9-]{36}(?:\/photos\/[a-f0-9-]{36})?)?$/i.test(
        path,
      ))
  );
}
