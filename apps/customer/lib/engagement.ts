export const metricDefinitions = {
  landing_view: "Consented view of an approved show landing.",
  install_prompt_accepted:
    "Browser prompt accepted; installation is not independently verified.",
  signup_completed:
    "Verified new Shopify identity, observed with analytics consent.",
  meaningful_activation:
    "First authenticated saved reminder, owned grading status view, or notification read.",
  product_view: "Consented app product detail view; not a purchase.",
  checkout_initiation: "Server returned an eligible Shopify checkout URL.",
  verified_purchase:
    "One server-verified paid Shopify order; repeated receipts do not add orders.",
  saved_break_reminder:
    "Authenticated collector saved an active break reminder.",
  grading_status_view:
    "Authenticated collector opened their own grading record.",
  vendor_interest_submission:
    "Consented interest submission; not a vendor booking or marketplace sale.",
} as const;
export type Metric = keyof typeof metricDefinitions;
export type Show = {
  id: string;
  slug: string;
  brand: "northside" | "hobby_key";
  title: string;
  description: string;
  starts_at: string | null;
  location: string | null;
  published: boolean;
  fixture: boolean;
  version: number;
};
export type Placement = {
  ref: string;
  event_id: string;
  placement_key: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  enabled: boolean;
};
export function campaignParams(p: Placement) {
  return new URLSearchParams({
    ref: p.ref,
    utm_source: p.utm_source,
    utm_medium: p.utm_medium,
    utm_campaign: p.utm_campaign,
    utm_content: p.utm_content,
  });
}
export function fieldToken(value: unknown) {
  return typeof value === "string" && /^[a-z0-9_]{1,80}$/.test(value);
}
