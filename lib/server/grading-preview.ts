import { setMeasurementContext, measurementTokenFrom } from "./measurement";
import "server-only";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { fixturesAllowed } from "../policy.mjs";
import { AccessError, opaqueToken, hashToken } from "./security";
import { authorizeOn, type Sql, type Actor } from "./db";
import { createIntake, gradingCards, updateGradingCard } from "./grading";
import { SHOP, TENANT } from "./providers";
export const previewId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function openPreviewDatabase(directory: string) {
  await mkdir(directory, { recursive: true });
  const db = await PGlite.create(directory);
  try {
    if (
      !(
        await db.query<{ exists: boolean }>(
          "select exists(select from pg_namespace where nspname='ns') as exists",
        )
      ).rows[0].exists
    ) {
      for (const file of [
        "202609120001_identity_and_records.sql",
        "202609120003_commerce.sql",
        "202609120004_grading.sql",
      ])
        await db.exec(
          await readFile(resolve("supabase/migrations", file), "utf8"),
        );
    }
    if (
      !(
        await db.query<{ present: string | null }>(
          "select to_regclass('ns.grading_exam_drafts')::text as present",
        )
      ).rows[0].present
    )
      await db.exec(
        await readFile(
          resolve(
            "supabase/migrations/20260916174953_grading_photos_and_northside_exam.sql",
          ),
          "utf8",
        ),
      );
    if (
      !(
        await db.query<{ present: string | null }>(
          "select to_regclass('ns.grading_quotes')::text as present",
        )
      ).rows[0].present
    )
      await db.exec(
        await readFile(
          resolve(
            "supabase/migrations/20260916185139_customer_grading_quotes_and_approvals.sql",
          ),
          "utf8",
        ),
      );
    if (
      !(
        await db.query<{ present: string | null }>(
          "select to_regprocedure('ns.guard_dispatched_batch_service()')::text as present",
        )
      ).rows[0].present
    )
      await db.exec(
        await readFile(
          resolve(
            "supabase/migrations/20260916192111_grading_batch_service_setup.sql",
          ),
          "utf8",
        ),
      );
    // Load all predecessor schemas before custody/outbox extensions. Existing
    // feature initializers still own their explicitly labeled fixture seeds.
    for (const [table, file] of [
      ["consignment_events", "202609120005_consignment.sql"],
      ["break_jobs", "202609120007_breaks.sql"],
      ["notification_jobs", "202609120009_engagement.sql"],
      [
        "grading_dispatches",
        "20260916195007_grading_staff_custody_and_dispatch.sql",
      ],
    ]) {
      const present = (
        await db.query<{ present: string | null }>(
          "select to_regclass($1)::text as present",
          ["ns." + table],
        )
      ).rows[0].present;
      if (!present)
        await db.exec(
          await readFile(resolve("supabase/migrations", file), "utf8"),
        );
    }
    const tokens: Record<string, string> = {};
    for (const [name, n] of [
      ["a", 1],
      ["b", 2],
    ] as const) {
      await db.query(
        "insert into ns.customers(tenant_id,id,display_name) values($1,$2,$3) on conflict do nothing",
        [TENANT, previewId(n), `Sample collector ${name.toUpperCase()}`],
      );
      await db.query(
        "insert into ns.customer_identities(tenant_id,customer_id,shop,provider,subject) values($1,$2,$3,'shopify',$4) on conflict do nothing",
        [TENANT, previewId(n), SHOP, "LOCAL-FIXTURE-" + name],
      );
      tokens[name] = opaqueToken();
      await db.query(
        "insert into ns.sessions(token_hash,tenant_id,customer_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'shopify','LOCAL FIXTURE ONLY',now()+interval '7 days',now()+interval '7 days')",
        [hashToken(tokens[name]), TENANT, previewId(n)],
      );
    }
    for (const [name, n, role] of [
      ["staff", 10, "owner"],
      ["reader", 11, "read_only"],
      ["editor", 12, "content_editor"],
    ] as const) {
      await db.query(
        "insert into ns.staff_memberships(tenant_id,id,auth_user_id,role) values($1,$2,$3,$4) on conflict do nothing",
        [TENANT, previewId(n), previewId(n + 100), role],
      );
      tokens[name] = opaqueToken();
      await db.query(
        "insert into ns.sessions(token_hash,tenant_id,staff_id,provider,encrypted_tokens,token_expires_at,expires_at) values($1,$2,$3,'supabase','LOCAL FIXTURE ONLY',now()+interval '7 days',now()+interval '7 days')",
        [hashToken(tokens[name]), TENANT, previewId(n)],
      );
    }
    const run = <T>(who: string, fn: (sql: Sql, actor: Actor) => Promise<T>) =>
      db.transaction(async (tx) => {
        if (!tokens[who]) throw new AccessError(403, "unknown_fixture_actor");
        await tx.exec("set local role northside_runtime");
        const sql = tx as unknown as Sql;
        return fn(sql, await authorizeOn(sql, tokens[who]));
      });
    if (
      !(await db.query("select case_id from ns.grading_intakes limit 1")).rows
        .length
    ) {
      await run("staff", async (sql, actor) => {
        for (const [n, quantity, description] of [
          [1, 3, "SAMPLE — basketball examination"],
          [2, 1, "SAMPLE — baseball examination"],
        ] as const)
          await createIntake(
            sql,
            actor,
            {
              customer_id: previewId(n),
              description,
              quantity,
              sport: n === 1 ? "Basketball" : "Baseball",
              year: "2025",
              manufacturer: "Sample manufacturer",
              card_set: "Preview set",
              card_number: "EXAMPLE",
              parallel: "Base",
            },
            previewId(1000 + n),
            "Initial labeled local fixture",
          );
        const first = (await gradingCards(sql, actor)).find(
          (c) => c.customer_id === previewId(1),
        )!;
        await updateGradingCard(sql, actor, first.card_id, {
          version: first.version,
          status_key: "awaiting_decision",
          findings:
            "SAMPLE finding: visible corner wear. No grade is promised.",
          customer_notes:
            "Choose whether Northside should submit this example card or arrange its return.",
          reason: "Sample examination completed",
        });
      });
    }
    return { db, run };
  } catch (e) {
    await db.close();
    throw e;
  }
}
type PreviewDatabase = Awaited<ReturnType<typeof openPreviewDatabase>>;
const globalPreview = globalThis as unknown as {
  northsideGrading?: Promise<PreviewDatabase>;
};
export function previewActor(request: Request) {
  const url = new URL(request.url),
    host = request.headers.get("host") || url.host;
  if (!fixturesAllowed(process.env) || !/^127\.0\.0\.1(?::\d+)?$/.test(host))
    throw new AccessError(404, "not_found");
  if (
    request.method !== "GET" &&
    request.headers.get("origin") !== `http://${host}`
  )
    throw new AccessError(403, "same_origin_required");
  const actor = url.searchParams.get("actor") || "a";
  if (!["staff", "a", "b"].includes(actor))
    throw new AccessError(400, "unknown_sample_account");
  return actor;
}
export async function previewDatabase() {
  if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
  globalPreview.northsideGrading ??= openPreviewDatabase(
    resolve("work/grading-preview"),
  );
  return globalPreview.northsideGrading;
}
export async function previewTransaction<T>(
  request: Request,
  fn: (sql: Sql, actor: Actor) => Promise<T>,
) {
  const actor = previewActor(request);
  return (await previewDatabase()).run(actor, async (db, a) => {
    await setMeasurementContext(db, measurementTokenFrom(request, true));
    return fn(db, a);
  });
}
