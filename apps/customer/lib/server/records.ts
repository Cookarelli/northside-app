import "server-only";
import { randomUUID } from "node:crypto";
import { type Actor, type Sql, requireRole } from "./db";
import { AccessError, csvCell, uuid } from "./security";
export type VisibleCard = {
  id: string;
  customer_id: string;
  description: string;
  kind: string;
  status: string;
};
export async function listCards(db: Sql, actor: Actor) {
  if (!actor.customer_id)
    requireRole(actor, ["owner", "admin", "operations", "read_only"]);
  return (
    await db.query<VisibleCard>(
      `select c.id,c.customer_id,c.description,s.kind,s.status from ns.card_items c join ns.service_cases s on s.tenant_id=c.tenant_id and s.id=c.case_id where c.tenant_id=$1 ${actor.customer_id ? "and c.customer_id=$2" : ""} order by c.created_at,c.id`,
      actor.customer_id
        ? [actor.tenant_id, actor.customer_id]
        : [actor.tenant_id],
    )
  ).rows;
}
export async function readCard(db: Sql, actor: Actor, id: string) {
  uuid(id);
  if (!actor.customer_id)
    requireRole(actor, ["owner", "admin", "operations", "read_only"]);
  const card = (
    await db.query<VisibleCard>(
      `select c.id,c.customer_id,c.description,s.kind,s.status from ns.card_items c join ns.service_cases s on s.tenant_id=c.tenant_id and s.id=c.case_id where c.tenant_id=$1 and c.id=$2 ${actor.customer_id ? "and c.customer_id=$3" : ""}`,
      actor.customer_id
        ? [actor.tenant_id, id, actor.customer_id]
        : [actor.tenant_id, id],
    )
  ).rows[0];
  if (!card) throw new AccessError(404, "card_not_found");
  const events = (
    await db.query(
      "select id,label,created_at,source from ns.status_events where tenant_id=$1 and card_id=$2 order by created_at",
      [actor.tenant_id, id],
    )
  ).rows;
  const files = (
    await db.query(
      "select id,mime_type from ns.file_objects where tenant_id=$1 and card_id=$2 and ready",
      [actor.tenant_id, id],
    )
  ).rows;
  return { ...card, events, files };
}
export async function appendStatus(
  db: Sql,
  actor: Actor,
  id: string,
  input: unknown,
) {
  requireRole(actor, ["owner", "admin", "operations"]);
  const card = await readCard(db, actor, id);
  const body = input as Record<string, unknown>;
  if (
    !body ||
    typeof body.label !== "string" ||
    !body.label.trim() ||
    body.label.length > 100 ||
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.length > 1000
  )
    throw new AccessError(400, "label_and_reason_required");
  const result = await db.query(
    "insert into ns.status_events(tenant_id,card_id,customer_id,label,reason,source,actor_id) values($1,$2,$3,$4,$5,'staff',$6) returning id,created_at",
    [
      actor.tenant_id,
      id,
      card.customer_id,
      body.label.trim(),
      body.reason.trim(),
      actor.staff_id,
    ],
  );
  return result.rows[0];
}
export async function exportCards(db: Sql, actor: Actor) {
  const cards = await listCards(db, actor);
  return (
    [
      "card_id,description,service,status",
      ...cards.map((c) =>
        [c.id, c.description, c.kind, c.status].map(csvCell).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export async function authorizedFile(db: Sql, actor: Actor, id: string) {
  uuid(id);
  if (!actor.customer_id)
    requireRole(actor, ["owner", "admin", "operations", "read_only"]);
  const file = (
    await db.query<{ object_key: string; mime_type: string }>(
      "select object_key,mime_type from ns.file_objects where tenant_id=$1 and id=$2 and ready" +
        (actor.customer_id ? " and customer_id=$3" : ""),
      actor.customer_id
        ? [actor.tenant_id, id, actor.customer_id]
        : [actor.tenant_id, id],
    )
  ).rows[0];
  if (!file) throw new AccessError(404, "file_not_found");
  return file;
}
export async function prepareUpload(
  db: Sql,
  actor: Actor,
  cardId: string,
  mime: string,
) {
  requireRole(actor, ["owner", "admin", "operations"]);
  const card = await readCard(db, actor, cardId);
  if (
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)
  )
    throw new AccessError(400, "unsupported_file");
  const id = randomUUID();
  const key = `${actor.tenant_id}/${card.customer_id}/${id}`;
  await db.query(
    "insert into ns.file_objects(tenant_id,id,card_id,customer_id,object_key,mime_type) values($1,$2,$3,$4,$5,$6)",
    [actor.tenant_id, id, cardId, card.customer_id, key, mime],
  );
  return { id, key };
}
