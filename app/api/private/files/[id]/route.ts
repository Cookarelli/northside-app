import { privateRoute } from "@/lib/server/http";
import { authorizedFile } from "@/lib/server/records";
import { supabase } from "@/lib/server/providers";
import { AccessError } from "@/lib/server/security";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return privateRoute(request, async (db, actor) => {
    const file = await authorizedFile(db, actor, id);
    const result = await supabase(true)
      .storage.from("northside-private")
      .createSignedUrl(file.object_key, 60);
    if (result.error) throw new AccessError(503, "file_unavailable");
    return { url: result.data.signedUrl, expiresIn: 60 };
  });
}
