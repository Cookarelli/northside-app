import "server-only";
import { parse } from "csv-parse/sync";
import { randomUUID, createHash } from "node:crypto";
import type { Actor, Sql } from "./db";
import type { ImportPreview, ImportRow } from "../grading";
import { gradingFields } from "../grading";
import { AccessError, uuid } from "./security";
import {
  text,
  intakeInput,
  customerExists,
  gradingWriter,
  gradingSettings,
  createIntake,
  audit,
  updateGradingCard,
} from "./grading";
export function csvRows(csv: unknown): string[][] {
  if (typeof csv !== "string" || Buffer.byteLength(csv) > 262144)
    throw new AccessError(413, "csv_limit_256_kib");
  try {
    const rows = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 10000,
    }) as string[][];
    if (
      rows.length < 2 ||
      rows.length > 101 ||
      rows[0].length > 30 ||
      new Set(rows[0]).size !== rows[0].length
    )
      throw Error();
    return rows;
  } catch {
    throw new AccessError(400, "csv_needs_unique_headers_and_1_to_100_rows");
  }
}
const fingerprint = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function previewImport(
  db: Sql,
  actor: Actor,
  b: Record<string, unknown>,
): Promise<ImportPreview> {
  gradingWriter(actor);
  const rows = csvRows(b.csv),
    source = text(b.source, 80, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(source))
    throw new AccessError(
      400,
      "source_needs_letters_numbers_underscore_or_dash",
    );
  if (!b.mapping || typeof b.mapping !== "object")
    throw new AccessError(400, "column_mapping_required");
  const mapping = b.mapping as Record<string, unknown>,
    headers = rows.shift()!,
    seen = new Set<string>(),
    result: ImportRow[] = [];
  for (const [index, row] of rows.entries()) {
    let external = "";
    try {
      const v: Record<string, unknown> = {};
      for (const field of gradingFields) {
        const header = mapping[field];
        if (typeof header !== "string" || (header && !headers.includes(header)))
          throw new AccessError(400, "mapped_header_missing");
        v[field] = header ? row[headers.indexOf(header)] : "";
      }
      external = text(v.external_id, 120, true);
      if (!/^[a-zA-Z0-9_.:-]+$/.test(external) || seen.has(external))
        throw new AccessError(400, "external_id_invalid_or_repeated_in_file");
      seen.add(external);
      if (!/^[1-9][0-9]*$/.test(String(v.quantity)))
        throw new AccessError(400, "quantity_must_be_whole_number");
      v.quantity = Number(v.quantity);
      const input = intakeInput(v);
      await customerExists(db, actor, input.customer_id);
      const hash = fingerprint(input);
      const prior = (
        await db.query<{ fingerprint: string }>(
          "select fingerprint from ns.grading_external_rows where tenant_id=$1 and source=$2 and external_id=$3",
          [actor.tenant_id, source, external],
        )
      ).rows[0];
      if (prior && prior.fingerprint !== hash)
        throw new AccessError(
          409,
          "external_id_already_used_with_different_data",
        );
      result.push({
        line: index + 2,
        external_id: external,
        input,
        fingerprint: hash,
        state: prior ? "duplicate" : "ready",
        message: prior
          ? "Already imported; no changes."
          : "New intake; exact customer ID verified.",
      });
    } catch (e) {
      result.push({
        line: index + 2,
        external_id: external,
        state: "error",
        message: e instanceof AccessError ? e.message : "Invalid row.",
      });
    }
  }
  const config = await gradingSettings(db, actor),
    count = result.reduce(
      (n, r) => n + (r.state === "ready" ? (r.input?.quantity ?? 0) : 0),
      0,
    );
  if (count > 500)
    throw new AccessError(400, "import_limit_500_physical_cards");
  const preview: ImportPreview = {
    id: randomUUID(),
    source,
    rows: result,
    examination_cents: config.examination_cents,
    settings_version: config.version,
    card_count: count,
    subtotal_cents: count * config.examination_cents,
  };
  await db.query(
    "insert into ns.imports(tenant_id,id,source,actor_id,module,preview) values($1,$2,$3,$4,'grading',$5)",
    [
      actor.tenant_id,
      preview.id,
      source,
      actor.staff_id,
      JSON.stringify(preview),
    ],
  );
  return preview;
}
export async function readImport(db: Sql, actor: Actor, id: string) {
  gradingWriter(actor);
  const row = (
    await db.query<{ preview: ImportPreview; status: string }>(
      "select preview,status from ns.imports where tenant_id=$1 and id=$2 and module='grading'",
      [actor.tenant_id, uuid(id)],
    )
  ).rows[0];
  if (!row) throw new AccessError(404, "import_not_found");
  return { ...row.preview, status: row.status };
}
export async function commitImport(
  db: Sql,
  actor: Actor,
  b: Record<string, unknown>,
) {
  gradingWriter(actor);
  const id = uuid(text(b.id, 36, true)),
    why = text(b.reason, 1000, true);
  if (b.confirm !== true)
    throw new AccessError(400, "reviewer_confirmation_required");
  // One tenant-wide import lock keeps duplicate checks and reversible commits atomic across different files.
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    actor.tenant_id + ":grading-import",
  ]);
  await db.query(
    "select id from ns.imports where tenant_id=$1 and id=$2 for update",
    [actor.tenant_id, id],
  );
  const p = await readImport(db, actor, id);
  if (p.status === "committed") return { committed: true, duplicate: true };
  if (p.status !== "review" || p.rows.some((r) => r.state === "error"))
    throw new AccessError(409, "import_not_ready");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    actor.tenant_id + ":grading-settings",
  ]);
  const config = await gradingSettings(db, actor);
  if (config.version !== p.settings_version)
    throw new AccessError(409, "rate_changed_create_new_preview");
  for (const row of p.rows) {
    if (!row.input || !row.fingerprint)
      throw new AccessError(409, "import_not_ready");
    const prior = (
      await db.query<{ fingerprint: string }>(
        "select fingerprint from ns.grading_external_rows where tenant_id=$1 and source=$2 and external_id=$3",
        [actor.tenant_id, p.source, row.external_id],
      )
    ).rows[0];
    if (prior) {
      if (prior.fingerprint !== row.fingerprint)
        throw new AccessError(409, "import_conflict_create_new_preview");
      continue;
    }
    const intake = await createIntake(
      db,
      actor,
      row.input,
      randomUUID(),
      why,
      id,
    );
    await db.query(
      "insert into ns.grading_external_rows(tenant_id,source,external_id,fingerprint,case_id) values($1,$2,$3,$4,$5)",
      [
        actor.tenant_id,
        p.source,
        row.external_id,
        row.fingerprint,
        intake.case_id,
      ],
    );
  }
  await db.query(
    "update ns.imports set status='committed',committed_at=now() where tenant_id=$1 and id=$2",
    [actor.tenant_id, id],
  );
  await audit(db, actor, id, "import.committed", why);
  return { committed: true };
}
export async function reverseImport(
  db: Sql,
  actor: Actor,
  b: Record<string, unknown>,
) {
  gradingWriter(actor);
  const id = uuid(text(b.id, 36, true)),
    why = text(b.reason, 1000, true);
  if (b.confirm !== true)
    throw new AccessError(400, "reviewer_confirmation_required");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    actor.tenant_id + ":grading-import",
  ]);
  await db.query(
    "select id from ns.imports where tenant_id=$1 and id=$2 for update",
    [actor.tenant_id, id],
  );
  const p = await readImport(db, actor, id);
  if (p.status === "reversed") return { reversed: true, duplicate: true };
  if (p.status !== "committed")
    throw new AccessError(409, "import_not_committed");
  const cards = (
    await db.query<{
      card_id: string;
      case_id: string;
      version: number;
      batch_id: string | null;
    }>(
      "select g.card_id,g.case_id,g.version,c.batch_id from ns.grading_cards g join ns.grading_intakes i on i.tenant_id=g.tenant_id and i.case_id=g.case_id join ns.card_items c on c.tenant_id=g.tenant_id and c.id=g.card_id where i.tenant_id=$1 and i.import_id=$2 order by g.card_id for update of g,i",
      [actor.tenant_id, id],
    )
  ).rows;
  for (const c of cards) {
    const activity = (
      await db.query(
        "select 1 from ns.file_objects where tenant_id=$1 and card_id=$2 union all select 1 from ns.grading_payments where tenant_id=$1 and case_id=$3 union all select 1 from ns.grading_claim_tokens where tenant_id=$1 and case_id=$3 union all select 1 from ns.grading_claim_requests where tenant_id=$1 and case_id=$3",
        [actor.tenant_id, c.card_id, c.case_id],
      )
    ).rows.length;
    if (c.version !== 1 || c.batch_id || activity)
      throw new AccessError(
        409,
        "import_has_later_activity_use_audited_card_corrections",
      );
  }
  for (const c of cards)
    await updateGradingCard(
      db,
      actor,
      c.card_id,
      { version: 1, status_key: "cancelled", reason: why },
      "import",
    );
  await db.query(
    "update ns.grading_intakes set voided_at=now() where tenant_id=$1 and import_id=$2",
    [actor.tenant_id, id],
  );
  await db.query(
    "update ns.imports set status='reversed',reversed_at=now() where tenant_id=$1 and id=$2",
    [actor.tenant_id, id],
  );
  await audit(db, actor, id, "import.reversed", why);
  return { reversed: true };
}
