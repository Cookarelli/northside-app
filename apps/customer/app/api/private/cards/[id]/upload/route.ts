import { privateRoute } from "@/lib/server/http";
import { requireRole } from "@/lib/server/db";
import { readCard } from "@/lib/server/records";
import { uploadCardFile } from "@/lib/server/card-files";
import { AccessError } from "@/lib/server/security";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return privateRoute(request, async (db, a) => {
    requireRole(a, ["owner", "admin", "operations"]);
    await readCard(db, a, id);
    if (Number(request.headers.get("content-length") || 0) > 5242880)
      throw new AccessError(413, "file_too_large");
    const reader = request.body?.getReader();
    if (!reader) throw new AccessError(400, "file_required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5242880) throw new AccessError(413, "file_too_large");
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    return uploadCardFile(
      db,
      a,
      id,
      Buffer.concat(chunks),
      request.headers.get("content-type")?.split(";")[0] || "",
    );
  });
}
