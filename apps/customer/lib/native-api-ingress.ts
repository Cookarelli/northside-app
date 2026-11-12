/** Restrictive host routing for a separately approved native API preview alias.
 * This is not authentication; route/service ownership checks still run normally.
 */
export const NORTHSIDE_NATIVE_API_PREVIEW_HOST =
  "northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app";
export function nativeIngressAllowed(
  url: string,
  method: string,
  apiHost?: string,
  requestHost?: string | null,
) {
  const target = new URL(url);
  // Host routes the Vercel request. Do not trust client-supplied forwarded-host headers.
  const hostname = requestHost
    ? requestHost.toLowerCase().replace(/:\d+$/, "")
    : target.hostname;
  // This reserved preview alias stays closed even if a future deployment omits its env setting.
  if (hostname !== NORTHSIDE_NATIVE_API_PREVIEW_HOST) return true;
  if (apiHost !== NORTHSIDE_NATIVE_API_PREVIEW_HOST) return false;
  return (
    method === "POST" &&
    !target.search &&
    ["/api/mobile/v1/scan", "/api/mobile/v1/shopping"].includes(target.pathname)
  );
}
