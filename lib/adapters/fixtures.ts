import "server-only";
import type { Services, CardCase } from "../contracts";
const timeline = (name: string, consignment = false): CardCase => ({
  id: consignment ? "DEMO-C102" : "DEMO-G101",
  name,
  status: consignment ? "Processing with partner" : "Examination complete",
  events: [
    {
      label: "Received by Northside",
      at: "2026-09-08T16:00:00Z",
      source: "staff fixture",
      complete: true,
    },
    {
      label: consignment ? "Submitted to partner" : "Examination complete",
      at: "2026-09-10T18:30:00Z",
      source: "staff fixture",
      complete: true,
    },
    {
      label: consignment ? "Listing review" : "Awaiting customer decision",
      at: null,
      source: "staff fixture",
      complete: false,
    },
    {
      label: consignment ? "Sale and settlement" : "Sent to grader",
      at: null,
      source: "staff fixture",
      complete: false,
    },
  ],
});
const blocked = async (): Promise<never> => {
  throw new Error("Not available: preview cannot purchase or issue rewards.");
};
export const fixtureServices: Services = {
  commerce: {
    catalog: async () => [
      {
        id: "sample-baseball",
        name: "Baseball hobby box",
        category: "Baseball",
        priceCents: 12500,
        accent: "green",
        description:
          "An illustrative sealed hobby box for exploring the shopping experience. This is not a real listing or an inventory promise.",
      },
      {
        id: "sample-basketball",
        name: "Basketball collector box",
        category: "Basketball",
        priceCents: 8500,
        accent: "orange",
        description:
          "A sample basketball product. Set details, contents and price are illustrative only.",
      },
      {
        id: "sample-football",
        name: "Football hobby pack",
        category: "Football",
        priceCents: 1500,
        accent: "blue",
        description:
          "An example pack for testing browsing and a local demo cart.",
      },
      {
        id: "sample-supplies",
        name: "Card protection bundle",
        category: "Supplies",
        priceCents: 1200,
        accent: "purple",
        description:
          "A sample supply bundle. No actual Northside product is represented.",
      },
    ],
    checkout: blocked,
  },
  customer: {
    previewIdentity: async () => ({
      name: "Alex • sample collector",
      fixture: true,
    }),
  },
  grading: { cases: async () => [timeline("Sample rookie autograph card")] },
  consignment: {
    cases: async () => [timeline("Sample vintage baseball card", true)],
    capabilities: { providerFeed: false, payouts: false },
  },
  breaks: {
    schedule: async () => [
      {
        id: "sample-break",
        title: "Friday night baseball",
        startsAt: "2026-10-17T00:00:00Z",
        status: "scheduled",
        format: "Example format • details to be confirmed",
      },
    ],
  },
  loyalty: {
    wallet: async () => ({
      points: 750,
      held: 0,
      tier: "Rookie",
      rulesActive: false,
      tiers: [
        { name: "Rookie", threshold: 0 },
        { name: "Vet", threshold: 1000 },
        { name: "HOF", threshold: 5000 },
        { name: "GOAT", threshold: 10000 },
      ],
    }),
    redeem: blocked,
  },
};
