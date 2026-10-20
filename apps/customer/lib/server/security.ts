import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
export class AccessError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export const SESSION_COOKIE = "__Host-ns_session";
export const ATTEMPT_COOKIE = "__Host-ns_oauth";
export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};
export function opaqueToken() {
  return randomBytes(32).toString("base64url");
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
function key() {
  const b = Buffer.from(process.env.SESSION_ENCRYPTION_KEY || "", "base64");
  if (b.length !== 32) throw new AccessError(503, "encryption_not_configured");
  return b;
}
export function seal(value: unknown, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function unseal<T>(value: string, aad: string): T {
  try {
    const [v, iv, tag, data] = value.split(".");
    if (v !== "v1") throw Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(data, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  } catch {
    throw new AccessError(401, "invalid_session");
  }
}
export function appOrigin() {
  const value = process.env.APP_ORIGIN;
  if (!value) throw new AccessError(503, "https_origin_not_configured");
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
  )
    throw new AccessError(503, "https_origin_required");
  return u.origin;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin())
    throw new AccessError(403, "invalid_origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new AccessError(403, "cross_site_request");
}
export function safeReturn(value: unknown) {
  if (typeof value !== "string") return "/account";
  if (
    [
      "/",
      "/account",
      "/my-cards",
      "/rewards",
      "/staff",
      "/my-cards/grading",
      "/grading",
    ].includes(value)
  )
    return value;
  // Only explicit portal routes are allowed, without arbitrary query/host input.
  if (
    /^\/my-cards\/grading\/(?:card|exam)\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    return value;
  return "/account";
}
export function uuid(value: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new AccessError(400, "invalid_id");
  return value;
}
export function privateHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
}
export function errorResponse(error: unknown) {
  const e =
    error instanceof AccessError
      ? error
      : new AccessError(503, "service_unavailable");
  return Response.json(
    { error: e.code },
    { status: e.status, headers: privateHeaders() },
  );
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

export function matchesFileType(bytes: Uint8Array, mime: string) {
  const hex = Buffer.from(bytes.subarray(0, 12)).toString("hex");
  const text = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
  return mime === "image/png"
    ? hex.startsWith("89504e470d0a1a0a")
    : mime === "image/jpeg"
      ? hex.startsWith("ffd8ff")
      : mime === "image/webp"
        ? text.startsWith("RIFF") && text.substring(8, 12) === "WEBP"
        : mime === "application/pdf"
          ? text.startsWith("%PDF-")
          : false;
}
