import type { ExamPhoto, ExamRevision } from "./exam";
import type { GradingCard, GradingDetail } from "./grading";
export const quoteCharges = [
  "grading_cents",
  "shipping_cents",
  "insurance_cents",
  "other_cents",
] as const;
export const quoteLabels: Record<(typeof quoteCharges)[number], string> = {
  grading_cents: "External grading",
  shipping_cents: "Shipping (this card’s allocation)",
  insurance_cents: "Insurance",
  other_cents: "Other charges",
};
export type GradingQuote = {
  id: string;
  card_id: string;
  revision: number;
  provider: string;
  provider_label: string;
  provider_confirmed: boolean;
  service: string;
  grading_cents: number | null;
  shipping_cents: number | null;
  insurance_cents: number | null;
  other_cents: number | null;
  other_label: string;
  terms: string;
  created_at: string;
};
export function quoteComplete(q: GradingQuote | null) {
  return (
    !!q &&
    q.provider_confirmed &&
    !!q.service.trim() &&
    quoteCharges.every((k) => q[k] !== null)
  );
}
export type PortalCard = Omit<GradingCard, "customer_id" | "batch_id"> & {
  received_at: string;
  photos: ExamPhoto[];
  exam: { id: string; revision: number; signed_at: string } | null;
  quote: GradingQuote | null;
  approval_current: boolean;
  withdrawal: { id: string; created_at: string; resolution: string } | null;
  decision: {
    choice: "submit" | "return";
    created_at: string;
    request_id: string;
    quote_id: string | null;
    exam_revision_id: string | null;
  } | null;
};
export type PortalData = { cards: PortalCard[]; fixture?: boolean };
export type IntakeReceipt = {
  id: string;
  received_at: string;
  cards: { card_id: string; description: string; examination_cents: number }[];
  examination_subtotal_cents: number;
  voided_at: string | null;
};
export type PortalDetail = {
  card: PortalCard;
  receipt: IntakeReceipt;
  events: GradingDetail["events"];
  exams: ExamRevision[];
  quotes: GradingQuote[];
  decisions: {
    choice: string;
    created_at: string;
    quote_id: string | null;
    exam_revision_id: string | null;
    request_id: string;
  }[];
};
export function decisionSelection(cards: PortalCard[]) {
  return cards
    .map((c) => ({
      card_id: c.card_id,
      version: c.version,
      quote_id: c.quote?.id ?? null,
      exam_revision_id: c.exam?.id ?? null,
    }))
    .sort((a, b) => a.card_id.localeCompare(b.card_id));
}
export function submissionReady(c: PortalCard) {
  return (
    !c.voided_at &&
    ["awaiting_decision", "ready_to_submit"].includes(c.status_key) &&
    !!c.exam &&
    quoteComplete(c.quote)
  );
}
export function returnAvailable(c: PortalCard) {
  return (
    !c.voided_at &&
    c.custody === "northside" &&
    [
      "received",
      "examining",
      "awaiting_decision",
      "ready_to_submit",
      "return_requested",
      "on_hold",
      "exception",
    ].includes(c.status_key)
  );
}
