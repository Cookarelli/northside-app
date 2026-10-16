import { consignmentAudit } from "@/lib/server/consignment";
import { privateRoute } from "@/lib/server/http";
import { gradingCard, audit } from "@/lib/server/grading";
import { prepareUpload } from "@/lib/server/records";
import { supabase } from "@/lib/server/providers";
import { AccessError, matchesFileType } from "@/lib/server/security";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return privateRoute(request, async (db, actor) => {
    if (Number(request.headers.get("content-length") || 0) > 5242880)
      throw new AccessError(413, "file_too_large");
    const mime = request.headers.get("content-type")?.split(";")[0] || "";
    const file = await prepareUpload(db, actor, id, mime);
    const grading = (
      await db.query(
        "select card_id from ns.grading_cards where tenant_id=$1 and card_id=$2",
        [actor.tenant_id, id],
      )
    ).rows[0];
    if (grading && (await gradingCard(db, actor, id, true)).voided_at)
      throw new AccessError(409, "intake_reversed");
    const reader = request.body?.getReader();
    if (!reader) throw new AccessError(400, "file_required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5242880) {
        await reader.cancel();
        throw new AccessError(413, "file_too_large");
      }
      chunks.push(value);
    }
    if (!size) throw new AccessError(400, "file_required");
    const bytes = Buffer.concat(chunks);
    if (!matchesFileType(bytes, mime))
      throw new AccessError(400, "file_type_mismatch");
    const result = await supabase(true)
      .storage.from("northside-private")
      .upload(file.key, new Blob(chunks as BlobPart[]), {
        contentType: mime,
        upsert: false,
        cacheControl: "0",
      });
    if (result.error) throw new AccessError(503, "upload_failed");
    await db.query(
      "update ns.file_objects set ready=true where tenant_id=$1 and id=$2",
      [actor.tenant_id, file.id],
    );
    if (grading)
      await audit(
        db,
        actor,
        id,
        "card.image_uploaded",
        "Staff uploaded a validated private card image",
        { file_id: file.id },
      );
    const consignment = (
      await db.query<{ id: string }>(
        "select id from ns.consignment_items where tenant_id=$1 and card_id=$2",
        [actor.tenant_id, id],
      )
    ).rows[0];
    if (consignment)
      await consignmentAudit(
        db,
        actor,
        consignment.id,
        "image.uploaded",
        "Staff uploaded a validated private card image",
        { file_id: file.id },
      );
    return { id: file.id };
  });
}
