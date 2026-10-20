export const gradingFields = [
  "external_id",
  "customer_id",
  "description",
  "quantity",
  "sport",
  "year",
  "manufacturer",
  "card_set",
  "card_number",
  "parallel",
] as const;
export type IntakeInput = {
  customer_id: string;
  description: string;
  quantity: number;
  sport: string;
  year: string;
  manufacturer: string;
  card_set: string;
  card_number: string;
  parallel: string;
};
export type GradingCard = {
  card_id: string;
  case_id: string;
  customer_id: string;
  description: string;
  batch_id: string | null;
  status_key: string;
  custody: "northside" | "grader" | "released";
  last_milestone: string;
  result_kind: "graded" | "no_grade" | null;
  label: string;
  sport: string;
  year: string;
  manufacturer: string;
  card_set: string;
  card_number: string;
  parallel: string;
  findings: string;
  customer_notes: string;
  result: string;
  certificate: string;
  version: number;
  updated_at: string;
  examination_cents: number;
  voided_at: string | null;
  photos_complete: boolean;
};
export type ImportRow = {
  line: number;
  external_id: string;
  input?: IntakeInput;
  fingerprint?: string;
  state: "ready" | "duplicate" | "error";
  message: string;
};
export type ImportPreview = {
  id: string;
  source: string;
  rows: ImportRow[];
  examination_cents: number;
  settings_version: number;
  card_count: number;
  subtotal_cents: number;
};
export type GradingData = {
  mode: "staff" | "customer";
  role: string | null;
  cards: GradingCard[];
  settings: { examination_cents: number; version: number };
  states: { key: string; label: string; enabled: boolean }[];
  providers: { key: string; label: string; confirmed: boolean }[];
  customers: { id: string; display_name: string; verified: boolean }[];
  batches: {
    id: string;
    reference: string;
    provider: string;
    service: string;
    phase: "draft" | "dispatched" | "legacy_dispatched" | "cancelled";
    carrier: string;
    tracking: string;
    version: number;
  }[];
  imports: { id: string; source: string; status: string; created_at: string }[];
  claims: {
    id: string;
    case_id: string;
    verified_customer_id: string;
    status: string;
  }[];
};
export type GradingDetail = {
  card: GradingCard;
  intake_card_count: number;
  events: { id: string; label: string; source: string; created_at: string }[];
  files: { id: string; mime_type: string }[];
  payments: {
    id: string;
    source: string;
    recorded_date: string;
    amount_cents: number | null;
    reference?: string;
  }[];
};
export const examMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
