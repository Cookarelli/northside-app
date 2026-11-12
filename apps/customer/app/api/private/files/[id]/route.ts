import { privateRoute } from "@/lib/server/http";
import { authorizedFile } from "@/lib/server/records";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return privateRoute(request, async (db, actor) => {
    await authorizedFile(db, actor, id);
    return { url: `/api/private/files/${id}/content` };
  });
}
