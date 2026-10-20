import "server-only";
import { type Sql, type Actor, requireRole } from "./db";
import { AccessError, privateHeaders } from "./security";
import { boundedJson } from "./grading-api";
import { integer, uuid, shortText } from "./loyalty";
import {
  storeStaff,
  saveAisle,
  saveNode,
  saveEdge,
  saveLocation,
  saveProduct,
  saveVariant,
  assignLocation,
  saveQR,
  pickupRehearsal,
  resolveScan,
  searchStore,
  type StoreMode,
} from "./store";
import { storeLabel } from "./store-label";
export async function storeApi(
  request: Request,
  db: Sql,
  a: Actor,
  mode: StoreMode = "live",
) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.has("label"))
      return storeLabel(
        db,
        a,
        url.searchParams.get("label")!,
        url.searchParams.get("format") || "svg",
        mode,
      );
    return Response.json(await storeStaff(db, a, mode), {
      headers: privateHeaders(),
    });
  }
  const b = await boundedJson(request);
  let result: unknown;
  if (b.action === "resolve") result = await resolveScan(db, b.code, mode);
  else if (b.action === "search")
    result = await searchStore(db, a, b.query, mode);
  else {
    const id = uuid(b.id),
      version = b.version === null ? null : integer(b.version, 1),
      reason = shortText(b.reason),
      v = b.input;
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new AccessError(400, "input_required");
    const input = v as Record<string, unknown>;
    switch (b.action) {
      case "aisle":
        if (version === null)
          throw new AccessError(400, "choose_existing_aisle");
        result = await saveAisle(db, a, id, version, input, reason);
        break;
      case "node":
        result = await saveNode(db, a, id, version, input, reason);
        break;
      case "edge":
        result = await saveEdge(
          db,
          a,
          uuid(input.from_node),
          uuid(input.to_node),
          input.active === true,
          reason,
        );
        break;
      case "location":
        result = await saveLocation(db, a, id, version, input, reason);
        break;
      case "product":
        result = await saveProduct(db, a, id, version, input, reason, mode);
        break;
      case "variant":
        result = await saveVariant(db, a, id, version, input, reason, mode);
        break;
      case "assignment":
        result = await assignLocation(
          db,
          a,
          id,
          version,
          uuid(input.variant_id),
          uuid(input.location_id),
          reason,
        );
        break;
      case "qr":
        result = await saveQR(db, a, id, version, input, reason);
        break;
      case "pickup":
        result = await pickupRehearsal(db, a, id, version, input, reason, mode);
        break;
      default:
        throw new AccessError(400, "unknown_store_action");
    }
  }
  return Response.json(result, { headers: privateHeaders() });
}
