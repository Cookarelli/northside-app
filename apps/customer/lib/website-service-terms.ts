import type { TrackingService } from "../../../packages/customer-contracts/src/tracking";

// Existing public website terms identified by the owner on November 14, 2026.
// These are draft form values only; publication still requires the real staff session.
export const websiteServiceTerms = {
  grading: {
    version: "site-2026-11-14",
    title: "Card Grading Submission Terms & Agreement",
    body: "By submitting your cards for grading, you agree to the following terms:\n\nAccurate Information: You certify that all information provided in the submission form is accurate and complete. Any discrepancies may result in delays or rejection of your submission.\nNon-Refundable Fees: All grading fees are non-refundable, regardless of the final grade assigned to your card(s).\nUpcharges: If the declared value of your card is determined to be higher by PSA, any upcharges assessed will be your responsibility.\nSubmission Requirements: You must complete this form once to be entered into our system. If submitting under a different name or on behalf of another party, a new form with updated information will be required.\nFinal Grade Acceptance: All grading results are final. Reconsideration or resubmission is subject to additional fees and approval.\nOwnership Verification: You confirm that you are the legal owner of all submitted cards and have the authority to request grading services.\nCompliance: You agree to abide by all applicable laws and regulations in submitting your cards for grading.\n\nBy signing or submitting this form, you acknowledge and accept these terms.",
    approvalReference:
      "Current public Northside grading terms: https://www.northsidecollectibles.com/grading-service . Publishing owner/admin confirms review of the source, text, service and version.",
    source: "https://www.northsidecollectibles.com/grading-service",
  },
  consignment: {
    version: "site-2026-11-14",
    title: "Consignment Terms and Agreement",
    body: "Northside Collectibles (“Northside”) offers consignment services for trading cards through Fanatics Collect.\n\nBy submitting items for consignment, you (“Consignor”) agree to the terms below.\n\nHow the Process Works\n\n● Cards are submitted to Northside for review and acceptance\n● Accepted items are prepared and listed through Fanatics Collect (auction or marketplace)\n● Raw cards may be submitted for authentication by on-site CGC at Collect\n● Auctions typically run on a set schedule and are driven by market demand\n● Payment is issued after the item sells and funds are received from the platform\n\nFees & Payouts\n\n● Platform fees, authentication fees, and shipping costs will all be covered by Northside Collectibles\n● Collect applies a buyer’s premium, which is paid by the buyer, and not passed along to the Consignor\n\nConsignors receive 100% of the hammer price (final sale price), no fees attached\n\n● Northside does not take a % of the hammer price outside of adding any % during an active promotion\n● Any promotional pricing or adjusted terms will be clearly communicated in advance\n\nPricing & Listing Authority\n\nNorthside retains full discretion over:\n\n● Listing format (auction vs. buy now)\n● Pricing strategy and starting bids\n● Timing of listing\n\nAll sales are subject to market conditions, and final prices are not guaranteed.\n\nSales Are Final\n\n● All sales are final once listed and completed\n● Listings will not be canceled once live\n● Northside is not responsible for final sale outcomes\n\nPayment Timing\n\n● Payment will be issued after:\n● Buyer payment is received\n● Platform processing is completed\n\nTiming may vary depending on auction cycles and platform processing delays.\n\nRisk & Liability\n\nNorthside will take reasonable care in handling items. However, Northside is not responsible for:\n● Market fluctuations\n● Platform performance\n● Third-party delays (grading, shipping, processing)\n\nConsignor Responsibilities\n\nBy submitting items, you confirm that:\n● You own the items and they are authentic\n● You have disclosed any known defects or alterations\n● You understand all pricing and outcomes are market-driven\n\nRight to Refuse\n\nNorthside reserves the right to:\n● Accept or decline any item\n● Adjust listing strategy\n● Remove items if necessary\n\nAgreement\n\nBy submitting your items through this form, you acknowledge that you have read and agree to these terms.",
    approvalReference:
      "Current public Northside consignment terms: https://www.northsidecollectibles.com/consignment-service . Publishing owner/admin confirms review of the source, text, service and version.",
    source: "https://www.northsidecollectibles.com/consignment-service",
  },
} as const satisfies Record<
  TrackingService,
  {
    version: string;
    title: string;
    body: string;
    approvalReference: string;
    source: string;
  }
>;
