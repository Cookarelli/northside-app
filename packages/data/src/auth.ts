import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore, type Store } from "./index";
export type Role = "operator" | "staff";
export type Identity = { id: string; role: Role };
type Session = {
  id: string;
  role: Role;
  expires: number;
  credentialVersion: string;
};
type AuthState = {
  sessions: Record<string, Session>;
  attempts: Record<string, { count: number; until: number }>;
};
const initial = (): AuthState => ({ sessions: {}, attempts: {} });
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const fault = (message: string, status: number) =>
  Object.assign(new Error(message), { status });
function password(role: Role) {
  const value =
    process.env[role === "operator" ? "OPERATOR_PASSWORD" : "STAFF_PASSWORD"];
  if (!value || value.length < 20)
    throw fault("Authentication is not configured", 503);
  return value;
}
function cookieName(role: Role) {
  return role === "operator" ? "northside_operator" : "northside_staff";
}
function applicationOrigin(request: Request): string {
  const scope=process.env.NORTHSIDE_DATA_SCOPE;
  const configured=scope==='control'?process.env.CONTROL_ORIGIN:scope==='customer'?process.env.CUSTOMER_ORIGIN:undefined;
  if(process.env.VERCEL && !configured) throw fault("Application origin is not configured",503);
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}
export function assertSameOrigin(request: Request): void {
  const origin=request.headers.get("origin");
  if(!origin || origin!==applicationOrigin(request))throw fault("Origin not allowed",403);
}
function cookie(request: Request, role: Role) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName(role) + "="))
    ?.slice(cookieName(role).length + 1);
}
export async function requireRole(
  request: Request,
  role: Role,
  store: Store = getStore(),
): Promise<Identity> {
  const token = cookie(request, role);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw fault("Sign in required", 401);
  const data = await store.read("auth_" + role, initial);
  const s = data.sessions[digest(token)];
  if (
    !s ||
    s.role !== role ||
    s.expires <= Date.now() ||
    s.credentialVersion !== digest(password(role))
  )
    throw fault("Session expired. Sign in again", 401);
  return { id: s.id, role };
}
export async function login(
  request: Request,
  role: Role,
  store: Store = getStore(),
): Promise<Response> {
  assertSameOrigin(request);
  if (Number(request.headers.get("content-length") ?? "0") > 4096)
    throw fault("Request too large", 413);
  const body = await request.text();
  if (body.length > 4096) throw fault("Request too large", 413);
  let supplied: unknown;
  try {
    supplied = JSON.parse(body).password;
  } catch {
    throw fault("Invalid login", 400);
  }
  const expected = password(role);
  const now = Date.now();
  // Bucket for each role plus trusted edge IP on Vercel; no client-selected identities.
  const ip = process.env.VERCEL
    ? (request.headers.get("x-vercel-forwarded-for") ?? "unknown")
    : "local";
  const key = digest(role + ":" + ip);
  const token = randomBytes(32).toString("hex");
  const status = await store.transact("auth_" + role, initial, (s) => {
    for (const [k, v] of Object.entries(s.sessions))
      if (v.expires <= now) delete s.sessions[k];
    for (const [k, v] of Object.entries(s.attempts))
      if (v.until <= now) delete s.attempts[k];
    const a = s.attempts[key] ?? { count: 0, until: now + 15 * 60_000 };
    if (a.count >= 10) return 429;
    a.count++;
    s.attempts[key] = a;
    if (
      typeof supplied !== "string" ||
      !timingSafeEqual(
        Buffer.from(digest(supplied)),
        Buffer.from(digest(expected)),
      )
    )
      return 401;
    delete s.attempts[key];
    s.sessions[digest(token)] = {
      id: role === "operator" ? "steve" : "staff",
      role,
      expires: now + 8 * 3600_000,
      credentialVersion: digest(expected),
    };
    return 200;
  });
  if (status !== 200)
    throw fault(
      status === 429
        ? "Too many sign-in attempts. Try again in 15 minutes"
        : "Invalid credentials",
      status,
    );
  const secure = new URL(applicationOrigin(request)).protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { ok: true, role },
    {
      headers: {
        "set-cookie": `${cookieName(role)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`,
        "cache-control": "no-store",
      },
    },
  );
}
export async function logout(
  request: Request,
  role: Role,
  store: Store = getStore(),
): Promise<Response> {
  assertSameOrigin(request);
  const token = cookie(request, role);
  if (token)
    await store.transact("auth_" + role, initial, (s) => {
      delete s.sessions[digest(token)];
    });
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${cookieName(role)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
        "cache-control": "no-store",
      },
    },
  );
}
export function apiError(e: unknown): Response {
  const status = (e as { status?: number })?.status;
  const safe = status && status >= 400 && status < 500;
  return Response.json(
    {
      error: safe
        ? (e as Error).message
        : "Service unavailable. Check configuration or contact staff.",
    },
    { status: status ?? 500, headers: { "cache-control": "no-store" } },
  );
}
