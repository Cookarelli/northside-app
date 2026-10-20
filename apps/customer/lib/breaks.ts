export const breakStatuses = [
  "draft",
  "scheduled",
  "delayed",
  "live",
  "complete",
  "canceled",
] as const;
export type BreakEvent = {
  id: string;
  title: string;
  products: string[];
  starts_at: string | null;
  status: (typeof breakStatuses)[number];
  host: string;
  description: string;
  image_url: string | null;
  format: "unconfirmed" | "named" | "identical";
  capacity: number | null;
  terms: string;
  stream_url: string | null;
  replay_url: string | null;
  duration_minutes: number;
  published: boolean;
  fixture: boolean;
  version: number;
  sale_open: boolean;
  started_at: string | null;
  updated_at: string;
};
export type BreakMapping = {
  id: string;
  event_id: string;
  variant_id: string;
  product_id: string;
  sku: string;
  spot_key: string;
  capacity: number;
  active: boolean;
  created_at: string;
};
export type PublicBreak = BreakEvent & {
  spots: { id: string; spot_key: string; capacity: number; occupied: number }[];
  participants: { display_name: string; spot_key: string; quantity: number }[];
};
export type BreakPurchase = {
  id: string;
  event_id: string;
  mapping_id: string;
  customer_id: string | null;
  source: "shopify" | "legacy";
  source_order: string;
  source_line: string;
  quantity: number;
  current_quantity: number;
  status: string;
  paid_at: string;
  amount_cents: string;
  currency: "USD";
  updated_at: string;
};
export function breakTime(iso: string | null) {
  return iso
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)) + " Chicago time"
    : "Date to be confirmed";
}
export function countdown(iso: string | null, now: number) {
  if (!iso) return "Date to be confirmed";
  const diff = Date.parse(iso) - now;
  if (diff <= 0) return "Scheduled time reached · waiting for a staff update";
  const minutes = Math.ceil(diff / 60000);
  return minutes >= 1440
    ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h to scheduled start`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m to scheduled start`;
}
export function chicagoLocal(iso: string | null) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = (k: string) => parts.find((p) => p.type === k)?.value;
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}
export function chicagoToUtc(local: string, offset: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ||
    !["-05:00", "-06:00"].includes(offset)
  )
    throw Error("Choose a valid Chicago date, time and clock setting.");
  const date = new Date(local + ":00" + offset);
  if (
    !Number.isFinite(date.getTime()) ||
    chicagoLocal(date.toISOString()) !== local
  )
    throw Error(
      "That Chicago time and clock setting do not match. Check daylight saving time.",
    );
  return date.toISOString();
}
