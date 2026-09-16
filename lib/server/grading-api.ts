import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, Actor } from "./db";
import { AccessError, uuid } from "./security";
import { supabase } from "./providers";
import {
  gradingDashboard,
  gradingDetail,
  createIntake,
  updateGradingCard,
  decide,
  claimCode,
  requestClaim,
  reviewClaim,
  gradingExport,
  payment,
  gradingCard,
  text,
  gradingWriter,
  audit,
} from "./grading";
import { contact, settings, batch } from "./grading-operations";
import {
  previewImport,
  readImport,
  commitImport,
  reverseImport,
} from "./grading-import";
export async function boundedJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AccessError(415, "json_required");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "body_required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 524288) {
      await reader.cancel();
      throw new AccessError(413, "request_too_large");
    }
    chunks.push(value);
  }
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!b || typeof b !== "object" || Array.isArray(b)) throw Error();
    return b as Record<string, unknown>;
  } catch {
    throw new AccessError(400, "invalid_json");
  }
}
export async function gradingApi(
  request: Request,
  db: Sql,
  actor: Actor,
  fixture = false,
) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.has("card"))
      return gradingDetail(db, actor, uuid(url.searchParams.get("card")!));
    if (url.searchParams.has("import"))
      return readImport(db, actor, uuid(url.searchParams.get("import")!));
    if (url.searchParams.has("export"))
      return { csv: await gradingExport(db, actor) };
    if (url.searchParams.has("file")) {
      const id = uuid(url.searchParams.get("file")!);
      const file = (
        await db.query<{ card_id: string; object_key: string }>(
          "select card_id,object_key from ns.file_objects where tenant_id=$1 and id=$2 and ready",
          [actor.tenant_id, id],
        )
      ).rows[0];
      if (!file) throw new AccessError(404, "file_not_found");
      await gradingCard(db, actor, file.card_id);
      if (fixture) {
        if (!file.object_key.endsWith("/fixture-card.svg"))
          throw new AccessError(404, "no_real_fixture_files");
        return { url: "/grading-sample.svg" };
      }
      const result = await supabase(true)
        .storage.from("northside-private")
        .createSignedUrl(file.object_key, 60);
      if (result.error) throw new AccessError(503, "file_unavailable");
      return { url: result.data.signedUrl };
    }
    return gradingDashboard(db, actor);
  }
  const b = await boundedJson(request),
    why = () => text(b.reason, 1000, true);
  switch (b.action) {
    case "sample-image": {
      if (!fixture) throw new AccessError(404, "not_found");
      gradingWriter(actor);
      const c = await gradingCard(db, actor, text(b.card_id, 36, true), true);
      if (c.voided_at) throw new AccessError(409, "intake_reversed");
      const id = randomUUID();
      await db.query(
        "insert into ns.file_objects(tenant_id,id,card_id,customer_id,object_key,mime_type,ready) values($1,$2,$3,$4,$5,$6,true)",
        [
          actor.tenant_id,
          id,
          c.card_id,
          c.customer_id,
          `${actor.tenant_id}/${c.customer_id}/${id}/fixture-card.svg`,
          "image/svg+xml",
        ],
      );
      await audit(
        db,
        actor,
        c.card_id,
        "sample.image_attached",
        "Labeled local fixture illustration",
      );
      return { id };
    }
    case "intake":
      return createIntake(
        db,
        actor,
        b.input,
        text(b.request_id, 36, true),
        why(),
      );
    case "update":
      return updateGradingCard(db, actor, text(b.card_id, 36, true), b);
    case "decision":
      return decide(db, actor, text(b.card_id, 36, true), b);
    case "contact":
      return contact(db, actor, b);
    case "settings":
      return settings(db, actor, b);
    case "batch":
      return batch(db, actor, b);
    case "claim-code":
      return claimCode(db, actor, text(b.case_id, 36, true), why());
    case "claim-request":
      return requestClaim(db, actor, b.code);
    case "claim-review":
      return reviewClaim(db, actor, b);
    case "payment":
      return payment(db, actor, b);
    case "import-preview":
      return previewImport(db, actor, b);
    case "import-commit":
      return commitImport(db, actor, b);
    case "import-reverse":
      return reverseImport(db, actor, b);
    default:
      throw new AccessError(400, "unknown_action");
  }
}
