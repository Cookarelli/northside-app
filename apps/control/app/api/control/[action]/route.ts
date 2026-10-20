import {
  getStore,
  requireRole,
  assertSameOrigin,
  login,
  logout,
  apiError,
} from "@northside/data";
import { ControlPlane } from "@northside/agent-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const plane = () => new ControlPlane(getStore());
async function body(req: Request) {
  const text = await req.text();
  if (text.length > 24_000)
    throw Object.assign(new Error("Request too large"), { status: 413 });
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    await requireRole(req, "operator");
    if ((await params).action !== "snapshot")
      return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await plane().snapshot(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (action === "login") return await login(req, "operator");
    assertSameOrigin(req);
    const identity = await requireRole(req, "operator");
    if (action === "logout") return await logout(req, "operator");
    const input = await body(req);
    const control = plane();
    let result: unknown;
    if (action === "tasks")
      result = await control.createTask(input, identity.id);
    else if (action === "commands")
      result = await control.command(input, identity.id);
    else if (action === "register-worker") {
      if (
        typeof input.name !== "string" ||
        input.name.length < 2 ||
        input.name.length > 80
      )
        throw Object.assign(
          new Error("Provide a worker name between 2 and 80 characters"),
          { status: 400 },
        );
      result = await control.registerWorker(input.name, identity.id);
    } else if (action === "revoke-worker") {
      if (typeof input.id !== "string")
        throw Object.assign(new Error("Worker id required"), { status: 400 });
      await control.revokeWorker(input.id, identity.id);
      result = { ok: true };
    } else return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
