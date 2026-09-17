import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, Actor } from "./db";
import { requireRole } from "./db";
import { AccessError, uuid } from "./security";
import {
  gradingWriter,
  lockGradingCustody,
  text,
  integer,
  audit,
  gradingCard,
  updateGradingCard,
} from "./grading";
export async function contact(
  db: Sql,
  actor: Actor,
  b: Record<string, unknown>,
) {
  gradingWriter(actor);
  const id = randomUUID(),
    name = text(b.display_name, 120, true);
  await db.query(
    "insert into ns.customers(tenant_id,id,display_name) values($1,$2,$3)",
    [actor.tenant_id, id, name],
  );
  await audit(
    db,
    actor,
    id,
    "intake.contact_created",
    text(b.reason, 1000, true),
  );
  return { id };
}
export async function settings(
  db: Sql,
  actor: Actor,
  b: Record<string, unknown>,
) {
  requireRole(actor, ["owner", "admin"]);
  const why = text(b.reason, 1000, true);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    actor.tenant_id + ":grading-settings",
  ]);
  if (b.kind === "rate") {
    const result = await db.query(
      "update ns.grading_settings set examination_cents=$2,version=version+1 where tenant_id=$1 and version=$3 returning version",
      [
        actor.tenant_id,
        integer(b.examination_cents, 0, 100000),
        integer(b.version, 1, 100000000),
      ],
    );
    if (!result.rows.length)
      throw new AccessError(409, "settings_changed_refresh_required");
  } else if (b.kind === "state") {
    const key = text(b.key, 40, true);
    if (typeof b.enabled !== "boolean")
      throw new AccessError(400, "enabled_required");
    const r = await db.query(
      "update ns.grading_states set label=$3,enabled=$4 where tenant_id=$1 and key=$2 returning key",
      [actor.tenant_id, key, text(b.label, 80, true), b.enabled],
    );
    if (!r.rows.length) throw new AccessError(404, "state_not_found");
  } else throw new AccessError(400, "invalid_setting");
  await audit(db, actor, actor.tenant_id, "settings.changed", why, {
    kind: b.kind,
    examination_cents: b.examination_cents,
    previous_version: b.version,
    key: b.key,
    label: b.label,
    enabled: b.enabled,
  });
  return { updated: true };
}
export async function batch(db: Sql, actor: Actor, b: Record<string, unknown>) {
  gradingWriter(actor);
  await lockGradingCustody(db, actor);
  const why = text(b.reason, 1000, true),
    id = b.id ? uuid(text(b.id, 36, true)) : randomUUID();
  if (b.operation === "create") {
    const provider = text(b.provider, 40, true);
    if (
      !(
        await db.query(
          "select key from ns.grading_providers where tenant_id=$1 and key=$2",
          [actor.tenant_id, provider],
        )
      ).rows.length
    )
      throw new AccessError(400, "unknown_provider");
    await db.query(
      "insert into ns.grading_batches(tenant_id,id,reference,provider,carrier,tracking,service) values($1,$2,$3,$4,$5,$6,$7)",
      [
        actor.tenant_id,
        id,
        text(b.reference, 120, true),
        provider,
        text(b.carrier ?? "", 80),
        text(b.tracking ?? "", 150),
        text(b.service ?? "", 120),
      ],
    );
    await audit(db, actor, id, "batch.created", why);
    return { id };
  }
  const found = (
    await db.query<{ version: number; service: string }>(
      "select version,service from ns.grading_batches where tenant_id=$1 and id=$2 for update",
      [actor.tenant_id, id],
    )
  ).rows[0];
  if (!found || found.version !== integer(b.version, 1, 100000000))
    throw new AccessError(409, "batch_changed_refresh_required");
  if (b.operation === "tracking") {
    try {
      await db.query(
        "update ns.grading_batches set reference=$3,carrier=$4,tracking=$5,service=$6,version=version+1 where tenant_id=$1 and id=$2",
        [
          actor.tenant_id,
          id,
          text(b.reference, 120, true),
          text(b.carrier ?? "", 80),
          text(b.tracking ?? "", 150),
          text(b.service ?? found.service, 120),
        ],
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("after dispatch"))
        throw new AccessError(
          409,
          "batch_service_locked_after_dispatch_create_new_batch",
        );
      throw e;
    }
  } else if (b.operation === "cards") {
    if (!Array.isArray(b.cards) || !b.cards.length || b.cards.length > 100)
      throw new AccessError(400, "select_up_to_100_cards");
    const seen = new Set<string>();
    for (const value of b.cards) {
      if (!value || typeof value !== "object")
        throw new AccessError(400, "invalid_card_selection");
      const item = value as Record<string, unknown>,
        cardId = uuid(text(item.card_id, 36, true));
      if (seen.has(cardId))
        throw new AccessError(400, "duplicate_card_selection");
      seen.add(cardId);
      const card = await gradingCard(db, actor, cardId, true);
      if (card.batch_id && card.batch_id !== id)
        throw new AccessError(409, "card_already_in_another_batch");
      if (b.assign !== true && card.batch_id !== id)
        throw new AccessError(409, "card_not_in_selected_batch");
      if (b.assign === true)
        await db.query(
          "update ns.card_items set batch_id=$3 where tenant_id=$1 and id=$2",
          [actor.tenant_id, cardId, id],
        );
      await updateGradingCard(db, actor, cardId, {
        version: item.version,
        status_key: b.status_key,
        reason: why,
      });
    }
    await db.query(
      "update ns.grading_batches set version=version+1 where tenant_id=$1 and id=$2",
      [actor.tenant_id, id],
    );
  } else throw new AccessError(400, "invalid_batch_operation");
  await audit(db, actor, id, "batch." + b.operation, why, {
    cards: b.cards ?? null,
  });
  return { updated: true };
}
