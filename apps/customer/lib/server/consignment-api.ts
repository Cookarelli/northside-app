import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, Actor } from "./db";
import { uuid, AccessError } from "./security";
import { boundedJson } from "./grading-api";
import { text } from "./grading";
import { authorizedFile } from "./records";
import { supabase } from "./providers";
import {
  consignmentDashboard,
  consignmentDetail,
  createConsignment,
  updateConsignment,
  recordSettlement,
  consignmentExport,
  consignmentItem,
  consignmentWriter,
  consignmentAudit,
} from "./consignment";
import {
  readConsignmentImport,
  previewConsignmentImport,
  resolveConsignmentImport,
  commitConsignmentImport,
} from "./consignment-import";
export async function consignmentApi(
  request: Request,
  db: Sql,
  a: Actor,
  fixture = false,
) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    if (u.searchParams.has("item"))
      return consignmentDetail(db, a, uuid(u.searchParams.get("item")!));
    if (u.searchParams.has("import"))
      return readConsignmentImport(db, a, uuid(u.searchParams.get("import")!));
    if (u.searchParams.has("export"))
      return { csv: await consignmentExport(db, a) };
    if (u.searchParams.has("file")) {
      const file = await authorizedFile(
        db,
        a,
        uuid(u.searchParams.get("file")!),
      );
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
    return consignmentDashboard(db, a);
  }
  const b = await boundedJson(request);
  switch (b.action) {
    case "intake":
      return createConsignment(db, a, b);
    case "update":
      return updateConsignment(db, a, uuid(text(b.item_id, 36, true)), b);
    case "settlement":
      return recordSettlement(db, a, b);
    case "import-preview":
      return previewConsignmentImport(db, a, b);
    case "import-resolve":
      return resolveConsignmentImport(db, a, b);
    case "import-commit":
      return commitConsignmentImport(db, a, b);
    case "sample-image": {
      if (!fixture) throw new AccessError(404, "not_found");
      consignmentWriter(a);
      const item = await consignmentItem(
          db,
          a,
          uuid(text(b.item_id, 36, true)),
          true,
        ),
        id = randomUUID();
      await db.query(
        "insert into ns.file_objects(tenant_id,id,card_id,customer_id,object_key,mime_type,ready) values($1,$2,$3,$4,$5,'image/svg+xml',true)",
        [
          a.tenant_id,
          id,
          item.card_id,
          item.customer_id,
          `${a.tenant_id}/${item.customer_id}/${id}/fixture-card.svg`,
        ],
      );
      await consignmentAudit(
        db,
        a,
        item.id,
        "sample.image_attached",
        "Labeled sample illustration",
      );
      return { id };
    }
    default:
      throw new AccessError(400, "unknown_action");
  }
}
