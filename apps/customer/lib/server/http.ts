import { setMeasurementContext } from "./measurement";
import "server-only";
import { cookies } from "next/headers";
import { type Actor, type Sql, withSession } from "./db";
import { ensureFresh } from "./sessions";
import {
  SESSION_COOKIE,
  sameOrigin,
  privateHeaders,
  errorResponse,
  AccessError,
} from "./security";
import { liveOnly } from "./providers";
export async function currentToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
export async function privateRequest<T>(
  fn: (db: Sql, actor: Actor) => Promise<T>,
) {
  liveOnly();
  const token = await currentToken();
  await ensureFresh(token);
  const touch = (await cookies()).get("__Host-ns_campaign")?.value;
  return withSession(token, async (db, a) => {
    await setMeasurementContext(db, touch);
    return fn(db, a);
  });
}
export async function privateRoute(
  request: Request,
  fn: (db: Sql, actor: Actor) => Promise<unknown>,
  options: { csv?: boolean } = {},
) {
  try {
    if (request.method !== "GET") sameOrigin(request);
    const data = await privateRequest(fn);
    if (options.csv)
      return new Response(String(data), {
        headers: {
          ...privateHeaders(),
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="my-cards.csv"',
        },
      });
    return Response.json(data, { headers: privateHeaders() });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AccessError(415, "json_required");
  const text = await request.text();
  if (text.length > 10000) throw new AccessError(413, "request_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new AccessError(400, "invalid_json");
  }
}
