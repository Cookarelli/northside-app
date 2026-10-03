import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { openPreviewDatabase } from "../../lib/server/grading-preview";
import { gradingCard, updateGradingCard } from "../../lib/server/grading";
import {
  prepareExamPhoto,
  completeExamPhoto,
  saveExamDraft,
  examWorkspace,
  publishExam,
} from "../../lib/server/exam";
import { photoHash, type PhotoStore } from "../../lib/server/exam-storage";
import {
  saveQuote,
  portalData,
  recordPortalDecision,
} from "../../lib/server/grading-portal";
import { decisionSelection } from "../../lib/grading-portal";
type GradingTestFixture = Pick<
  Awaited<ReturnType<typeof openPreviewDatabase>>,
  "run"
>;
export const sampleService = "SAMPLE reviewed PSA service";
export const sampleQuote = {
  provider: "psa",
  service: sampleService,
  grading_cents: 2500,
  shipping_cents: 500,
  insurance_cents: 200,
  other_cents: 0,
  other_label: "",
  terms: "SAMPLE quoted charges. No payment is taken.",
  reason: "SAMPLE configured quote",
};
export function memoryPhotoStore() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    put: async (k: string, b: Uint8Array) => {
      if (!files.has(k)) files.set(k, b);
    },
    read: async (k: string) => {
      const b = files.get(k);
      if (!b) throw Error("Missing");
      return b;
    },
  };
}
export async function prepareExam(
  f: GradingTestFixture,
  id: string,
  store: PhotoStore,
) {
  const photo = await sharp({
    create: { width: 80, height: 120, channels: 3, background: "#e2e8ef" },
  })
    .png()
    .toBuffer();
  for (const kind of ["front", "back"]) {
    const p = await f.run("staff", (db, a) =>
      prepareExamPhoto(db, a, id, {
        kind,
        source_hash: photoHash(photo),
        request_id: randomUUID(),
      }),
    );
    await f.run("staff", (db, a) =>
      completeExamPhoto(db, a, id, p.id, photo, "image/png", store),
    );
  }
  const draft = (await f.run("staff", (db, a) => examWorkspace(db, a, id)))
    .draft!;
  const saved = await f.run("staff", (db, a) =>
    saveExamDraft(db, a, id, {
      version: draft.version,
      fields: {
        centering: 8,
        surface: 7,
        edges: 6,
        corners: 8,
        notes: "SAMPLE public findings",
        projected_grade: "SAMPLE manual estimate 7",
        unable_to_estimate: false,
      },
      internal_notes: "PRIVATE EXAM INTERNAL NOTES",
    }),
  );
  await f.run("staff", (db, a) =>
    publishExam(
      db,
      a,
      id,
      {
        version: saved.version,
        signoff: true,
        reason: "SAMPLE exam publication",
      },
      store,
    ),
  );
  const card = await f.run("staff", (db, a) => gradingCard(db, a, id));
  await f.run("staff", (db, a) =>
    updateGradingCard(db, a, id, {
      version: card.version,
      status_key: "awaiting_decision",
      reason: "SAMPLE collector review",
    }),
  );
}
export async function approveForTest(
  f: GradingTestFixture,
  ids: string[],
  who: string,
  store: PhotoStore = memoryPhotoStore(),
) {
  for (const id of ids) {
    await prepareExam(f, id, store);
    await f.run("staff", (db, a) =>
      saveQuote(db, a, {
        ...sampleQuote,
        card_id: id,
        request_id: randomUUID(),
        previous_id: null,
      }),
    );
  }
  const cards = (await f.run(who, portalData)).cards.filter((c) =>
    ids.includes(c.card_id),
  );
  await f.run(who, (db, a) =>
    recordPortalDecision(db, a, {
      choice: "submit",
      cards: decisionSelection(cards),
      request_id: randomUUID(),
      confirmed: true,
    }),
  );
}

export async function dispatchForTest(
  f: GradingTestFixture,
  batchId: string,
  ids: string[],
) {
  const { operationsAction, batchWorkspace } =
    await import("../../lib/server/grading-fulfillment");
  const { batch } = await import("../../lib/server/grading-operations");
  const store = memoryPhotoStore();
  let w = await f.run("staff", (db, a) => batchWorkspace(db, a, batchId));
  if (!w.batch.carrier || !w.batch.tracking)
    await f.run("staff", (db, a) =>
      batch(db, a, {
        operation: "tracking",
        id: batchId,
        version: w.batch.version,
        reference: w.batch.reference,
        carrier: "SAMPLE carrier",
        tracking: "SAMPLE tracking",
        reason: "SAMPLE physical dispatch evidence",
      }),
    );
  for (const id of ids) {
    w = await f.run("staff", (db, a) => batchWorkspace(db, a, batchId));
    await f.run("staff", (db, a) =>
      operationsAction(
        db,
        a,
        {
          action: "scan_batch",
          request_id: randomUUID(),
          batch_id: batchId,
          batch_version: w.batch.version,
          code: id,
          method: "manual",
          reason: "SAMPLE physical label verified",
        },
        store,
      ),
    );
  }
  w = await f.run("staff", (db, a) => batchWorkspace(db, a, batchId));
  await f.run("staff", (db, a) =>
    operationsAction(
      db,
      a,
      {
        action: "dispatch",
        request_id: randomUUID(),
        batch_id: batchId,
        batch_version: w.batch.version,
        cards: w.cards.map((c) => ({ card_id: c.card_id, version: c.version })),
        confirmed: true,
        reason: "SAMPLE actual carrier handoff",
      },
      store,
    ),
  );
}
