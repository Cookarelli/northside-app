export const consignmentStates = {
  received: "Received at Northside",
  preparing: "Preparing submission",
  submitted: "Submitted to partner",
  processing: "Partner processing",
  listed: "Listed",
  sold: "Sold",
  awaiting_settlement: "Awaiting settlement",
  paid: "Settlement recorded in full",
  returned: "Returned",
  exception: "Exception",
} as const;
export type ConsignmentState = keyof typeof consignmentStates;
export type ConsignmentItem = {
  id: string;
  card_id: string;
  case_id: string;
  customer_id: string;
  description: string;
  provider_reference: string | null;
  submission_reference: string;
  listing_reference: string;
  received_date: string | null;
  channel: string;
  asking_cents: number | null;
  sale_cents: number | null;
  sale_verified_at: string | null;
  fees_cents: number | null;
  currency: "USD";
  state_key: ConsignmentState;
  payout_status: string;
  customer_notes: string;
  version: number;
  updated_at: string;
  source_updated_at: string | null;
  net_cents: number | null;
  settled_cents: number;
  settlement_count: number;
};
export type ConsignmentSettlement = {
  id: string;
  amount_cents: number;
  reference: string;
  recorded_date: string;
  currency: "USD";
  source: "northside";
  reverses_id: string | null;
  created_at: string;
};
export type ConsignmentDetail = {
  item: ConsignmentItem;
  events: { id: string; label: string; source: string; created_at: string }[];
  settlements: ConsignmentSettlement[];
  files: { id: string; mime_type: string }[];
};
export type FanaticsHealth = {
  state: "connected" | "disconnected" | "unavailable";
  message: string;
  last_success_at: string | null;
  documentation_version: string | null;
  capabilities: {
    inventory_sync: boolean;
    consignor_identity: boolean;
    submissions: boolean;
    listings: boolean;
    sales: boolean;
    fees: boolean;
    payouts: boolean;
    webhooks: boolean;
    money_transfers: false;
  };
};
export type ConsignmentData = {
  mode: "staff" | "customer";
  role: string | null;
  items: ConsignmentItem[];
  customers: { id: string; display_name: string; verified: boolean }[];
  imports: { id: string; source: string; status: string; created_at: string }[];
  review_count: number;
  integration: FanaticsHealth;
};
export const consignmentFields = [
  "external_id",
  "customer_id",
  "item_id",
  "description",
  "received_date",
  "channel",
  "state_key",
  "currency",
  "asking_cents",
  "sale_cents",
  "fees_cents",
  "provider_reference",
  "submission_reference",
  "listing_reference",
  "customer_notes",
  "source_updated_at",
] as const;
export type ConsignmentImportInput = {
  customer_id?: string;
  item_id?: string;
  description: string;
  received_date?: string;
  channel?: string;
  state_key: ConsignmentState;
  currency: "USD";
  asking_cents?: number;
  sale_cents?: number;
  fees_cents?: number;
  provider_reference?: string;
  submission_reference?: string;
  listing_reference?: string;
  customer_notes?: string;
  source_updated_at: string;
};
export type ConsignmentImportRow = {
  row_number: number;
  external_id: string;
  input: ConsignmentImportInput;
  fingerprint: string;
  state:
    | "ready"
    | "unmatched"
    | "duplicate"
    | "conflict"
    | "error"
    | "applied"
    | "rejected";
  message: string;
  target_item_id: string | null;
  customer_id: string | null;
  expected_version: number | null;
  current_snapshot?: ConsignmentItem | null;
};
export type ConsignmentImport = {
  id: string;
  source: string;
  status: string;
  rows: ConsignmentImportRow[];
};
export const consignmentMoney = (value: number | null) =>
  value === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value / 100);
