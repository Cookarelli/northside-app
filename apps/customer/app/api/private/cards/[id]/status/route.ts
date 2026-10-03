import { privateRoute, jsonBody } from "@/lib/server/http";
import { appendStatus } from "@/lib/server/records";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return privateRoute(request, async (db, actor) =>
    appendStatus(db, actor, id, await jsonBody(request)),
  );
}
