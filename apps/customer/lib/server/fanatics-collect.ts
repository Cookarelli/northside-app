import "server-only";
import type { FanaticsHealth } from "../consignment";
// No partner specification has been supplied. These are Northside's adapter boundaries, not invented provider endpoints.
export type FanaticsConsignmentRecord = {
  external_id: string;
  source_updated_at: string;
  consignor_external_id: string | null;
  item_reference: string | null;
  submission_reference: string | null;
  listing_reference: string | null;
  provider_status: string | null;
  currency: string | null;
  sold_cents: number | null;
  fees_cents: number | null;
  payout_status: string | null;
  payout_reference: string | null;
};
export interface FanaticsCollectAdapter {
  health(): Promise<FanaticsHealth>;
  readConsignments(
    cursor?: string,
  ): Promise<
    | { state: "disconnected" | "unavailable"; records: null }
    | {
        state: "available";
        records: FanaticsConsignmentRecord[];
        next_cursor: string | null;
      }
  >;
}
export class DisconnectedFanaticsCollectAdapter implements FanaticsCollectAdapter {
  async health(): Promise<FanaticsHealth> {
    return {
      state: "disconnected",
      message:
        "Fanatics Collect partner data access is unverified. Northside staff records remain available.",
      last_success_at: null,
      documentation_version: null,
      capabilities: {
        inventory_sync: false,
        consignor_identity: false,
        submissions: false,
        listings: false,
        sales: false,
        fees: false,
        payouts: false,
        webhooks: false,
        money_transfers: false,
      },
    };
  }
  async readConsignments() {
    return { state: "disconnected" as const, records: null };
  }
}
export const fanaticsCollect: FanaticsCollectAdapter =
  new DisconnectedFanaticsCollectAdapter();
export async function fanaticsHealth(
  adapter: FanaticsCollectAdapter = fanaticsCollect,
): Promise<FanaticsHealth> {
  try {
    return await adapter.health();
  } catch {
    return {
      ...(await fanaticsCollect.health()),
      state: "unavailable",
      message:
        "Partner status unavailable. Saved Northside records are unchanged.",
    };
  }
}
