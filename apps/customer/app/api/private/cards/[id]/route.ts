import { privateRoute } from "@/lib/server/http";
import { readCard } from "@/lib/server/records";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return privateRoute(request, (db, actor) => readCard(db, actor, id));
}
