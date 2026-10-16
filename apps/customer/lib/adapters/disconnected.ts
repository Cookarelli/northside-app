import "server-only";
import type { Services } from "../contracts";
const unavailable = async (): Promise<never> => {
  throw new Error("Provider is disconnected.");
};
export const disconnectedServices: Services = {
  commerce: { catalog: async () => [], checkout: unavailable },
  customer: { previewIdentity: async () => null },
  grading: { cases: async () => [] },
  consignment: {
    cases: async () => [],
    capabilities: { providerFeed: false, payouts: false },
  },
  breaks: { schedule: async () => [] },
  loyalty: { wallet: async () => null, redeem: unavailable },
};
