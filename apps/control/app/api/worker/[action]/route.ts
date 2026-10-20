import { getStore, apiError } from "@northside/data";
import { ControlPlane } from "@northside/agent-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (!["poll", "claim", "heartbeat", "report"].includes(action))
      return Response.json({ error: "Not found" }, { status: 404 });
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer "))
      return Response.json(
        { error: "Worker credential required" },
        { status: 401 },
      );
    const text = await req.text();
    if (text.length > 128_000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    let input: unknown;
    try {
      input = text ? JSON.parse(text) : {};
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const result = await new ControlPlane(getStore()).workerAction(
      action as "poll" | "claim" | "heartbeat" | "report",
      auth.slice(7),
      input,
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
