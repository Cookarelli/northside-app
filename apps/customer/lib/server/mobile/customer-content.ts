import "server-only";
import { transaction, withSession, type Sql, type Actor } from "../db";
import { AccessError, appOrigin } from "../security";
import { liveOnly, TENANT } from "../providers";
import { wallet } from "../loyalty";
import { myBreaks } from "../breaks";
import { nativeParent } from "./service";
import type { LoyaltyWallet } from "../../loyalty";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import {
  mobileInfoSchema,
  mobileWalletSchema,
  mobileBreaksSchema,
} from "../../../../../packages/customer-contracts/src/mvp";
import { approvedCollection } from "./catalog";

export async function readCustomerInfo() {
  liveOnly();
  const origin = appOrigin();
  const safeLink = (value: unknown) => {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new AccessError(503, "not_configured");
    const url = new URL(value);
    if (
      ![
        new URL(origin).hostname,
        "www.northsidecollectibles.com",
        "northsidecollectibles.com",
      ].includes(url.hostname)
    )
      throw new AccessError(503, "not_configured");
    return value;
  };
  const raw = process.env.NORTHSIDE_MOBILE_STORE_INFO_JSON
    ? (JSON.parse(process.env.NORTHSIDE_MOBILE_STORE_INFO_JSON) as {
        address?: string;
        hours?: string[];
        phone?: string;
      })
    : {};
  let events: unknown = { status: "unavailable" };
  try {
    const rows = await transaction(
      "engagement",
      async (db) =>
        (
          await db.query<{
            id: string;
            title: string;
            description: string;
            starts_at: Date | string | null;
            location: string | null;
          }>(
            "select id,title,description,starts_at,location from ns.show_events where tenant_id=$1 and published and fixture=false and brand='northside' and (starts_at is null or starts_at>=now()) order by starts_at asc nulls last limit 10",
            [TENANT],
          )
        ).rows,
    );
    events = {
      status: "ready",
      items: rows.map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.starts_at
          ? new Date(event.starts_at).toISOString()
          : null,
        location: event.location,
      })),
    };
  } catch {}
  let scan = false;
  try {
    approvedCollection();
    scan =
      process.env.NORTHSIDE_MOBILE_SCAN_READS_APPROVED === "true" &&
      !!process.env.NORTHSIDE_QR_ORIGIN;
  } catch {}
  return mobileInfoSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "customer-info",
    store: {
      name: "Northside Collectibles",
      website: "https://www.northsidecollectibles.com/",
      address: raw.address ?? null,
      hours: raw.hours ?? [],
      phone: raw.phone ?? null,
    },
    links: {
      privacy: safeLink(process.env.NORTHSIDE_MOBILE_PRIVACY_URL),
      deletion: safeLink(process.env.NORTHSIDE_MOBILE_DELETION_URL),
      support: safeLink(process.env.NORTHSIDE_MOBILE_SUPPORT_URL),
    },
    events,
    scanLookupConfigured: scan,
  });
}
export function projectWallet(value: LoyaltyWallet) {
  if (value.state !== "ready")
    return mobileWalletSchema.parse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "wallet",
      status: "unavailable",
      reason: value.state,
    });
  return mobileWalletSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "wallet",
    status: "ready",
    balance: value.balance,
    held: value.held,
    available: value.spendable,
    tier: value.tier?.label ?? null,
    rewards: value.rewards.map((r) => ({
      id: r.id,
      title: r.title,
      pointsCost: r.points_cost,
    })),
    observedAt: new Date().toISOString(),
  });
}
async function owned<T>(
  token: string,
  fn: (db: Sql, actor: Actor) => Promise<T>,
) {
  const context = await nativeParent(token);
  return withSession(context.parent.parentToken, (db, actor) => {
    if (
      actor.customer_id !== context.parent.customerId ||
      actor.staff_id !== null ||
      actor.staff_role !== null
    )
      throw new AccessError(401, "unauthorized");
    return fn(db, actor);
  });
}
export function readCustomerWallet(token: string) {
  return owned(token, async (db, actor) =>
    projectWallet(await wallet(db, actor, "live")),
  );
}
export function readCustomerBreaks(token: string) {
  return owned(token, async (db, actor) => {
    const data = await myBreaks(db, actor);
    return mobileBreaksSchema.parse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "customer-breaks",
      items: data.purchases.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.event_status + " · " + p.status,
        source: p.source,
        quantity: p.current_quantity,
      })),
    });
  });
}
