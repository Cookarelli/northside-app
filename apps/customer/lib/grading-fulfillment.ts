import type { GradingCard, GradingData } from "./grading";
import type { ExamPhoto } from "./exam";
export const scanMethods = ["camera", "image", "scanner", "manual"] as const;
export type ScanMethod = (typeof scanMethods)[number];
export function gradingLabel(cardId: string) {
  return `NSCARD:${cardId}`;
}
export function parseGradingLabel(value: string) {
  const id = value
    .trim()
    .replace(/^NSCARD:/i, "")
    .toLowerCase();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw Error(
      "Use a Northside card label or its complete card ID. Product barcodes and website links are not card labels.",
    );
  return id;
}
export type ScannedCard = GradingCard & {
  collector_name: string;
  collector_id: string;
  approval_current: boolean;
};
export type OperationsData = GradingData & {
  withdrawals: {
    id: string;
    card_id: string;
    customer_id: string;
    created_at: string;
    resolution: string;
  }[];
  notices: {
    id: string;
    channel: string;
    state: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
  }[];
  pickups: {
    id: string;
    customer_id: string;
    recipient_name: string;
    recipient_kind: string;
    staff_id: string;
    created_at: string;
    card_ids: string[];
  }[];
  status_imports: {
    id: string;
    source: string;
    status: string;
    created_at: string;
  }[];
};
export type BatchWorkspace = {
  batch: GradingData["batches"][number];
  cards: (ScannedCard & {
    scan_id: string | null;
    scan_method: string | null;
  })[];
  dispatch: {
    reference: string;
    provider: string;
    service: string;
    carrier: string;
    tracking: string;
    staff_id: string;
    reason: string;
    source: string;
    dispatched_at: string;
  } | null;
  manifest: {
    card_id: string;
    customer_id: string;
    description: string;
    card_version: number;
    approval_request_id: string;
    quote_id: string;
    exam_revision_id: string;
  }[];
};
export type OperationsCard = {
  card: ScannedCard;
  photos: ExamPhoto[];
  outcomes: {
    revision: number;
    kind: "graded" | "no_grade";
    result: string;
    certificate: string;
    staff_id: string;
    source: string;
    reason: string;
    created_at: string;
  }[];
  audit: {
    action: string;
    staff_id: string | null;
    customer_actor_id: string | null;
    reason: string;
    source: string;
    created_at: string;
  }[];
};
export const statusImportFields = [
  "external_id",
  "card_id",
  "status_key",
  "result_kind",
  "result",
  "certificate",
  "reason",
] as const;
export type StatusImportRow = {
  line: number;
  external_id: string;
  state: "ready" | "duplicate" | "error";
  message: string;
  input?: Record<string, unknown>;
  fingerprint?: string;
  card_version?: number;
  previous_status?: string;
  description?: string;
};
export type StatusImportPreview = {
  id: string;
  source: string;
  mapping: Record<string, string>;
  rows: StatusImportRow[];
  status?: string;
};
