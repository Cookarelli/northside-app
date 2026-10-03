import Link from "next/link";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { privateRequest } from "@/lib/server/http";
import { requireRole } from "@/lib/server/db";
import { integrationHealth } from "@/lib/server/integration-health";
export default async function Page() {
  const fixture = fixturesAllowed(process.env);
  const state = fixture
    ? { jobs: [], receipts: [] }
    : await privateRequest(async (db, actor) => {
        requireRole(actor, ["owner", "admin", "operations", "read_only"]);
        return {
          jobs: (
            await db.query<{ state: string; count: string }>(
              "select state,count(*) from ns.order_jobs where tenant_id=$1 group by state",
              [actor.tenant_id],
            )
          ).rows,
          receipts: (
            await db.query<{
              last_received: string | null;
              last_processed: string | null;
            }>(
              "select max(received_at) as last_received,max(processed_at) as last_processed from ns.webhook_receipts where tenant_id=$1 and provider='shopify'",
              [actor.tenant_id],
            )
          ).rows,
        };
      }).catch(() => null);
  if (!state)
    return (
      <div className="empty">
        <h1>Integration health</h1>
        <p>
          Sign in as an authorized staff member. Database setup is required.
        </p>
        <Link href="/staff/login">Staff sign-in</Link>
      </div>
    );
  const rows = fixture
    ? [
        ["Shopify catalog", "Disconnected · sample products only"],
        ["Customer accounts", "Disconnected · sample sign-in only"],
        ["Order webhooks", "Disconnected · local contract tests only"],
        ["Checkout", "Disabled · no payment or stock reservation"],
        ["Inventory routing", "Unverified · three distinct pools unchanged"],
      ]
    : await integrationHealth();
  rows.push(
    [
      "Staff login & private files",
      fixture
        ? "Disconnected · sample actors and illustrations only. Steve must configure invited staff and verify private uploads and expiring downloads in Supabase."
        : "Staff session accepted for this request. Supabase invitations, private uploads and download expiry need separate staging verification.",
    ],
    [
      "Grading providers",
      "Staff-recorded milestones only. Operations must confirm the second provider described as BGP; external grading and shipping fees remain unquoted.",
    ],
    [
      "Fanatics Collect",
      "Disconnected. Steve and the partner must confirm connector identity, consignor matching and sale/fee/payout coverage. Manual consignment records remain usable.",
    ],
    [
      "Custom Northside loyalty",
      "Live earning and redemption disabled. Joey must approve economics; Shopify discount ownership and checkout checks remain pending. No paid loyalty plugin.",
    ],
    [
      "Break streams & spot sales",
      "Purchases disabled. Operations must supply actual stream links, exact variants, terms and a verified last-spot checkout result.",
    ],
    [
      "Notification delivery",
      fixture || process.env.NOTIFICATION_DELIVERY_ENABLED !== "true"
        ? "Email and push disabled · UNSENT. Steve must configure verified sender/push settings and authorize a delivery test. In-app notices remain available."
        : "Delivery enabled by configuration; inspect job outcomes. Provider acceptance is not proof of device delivery.",
    ],
    [
      "Marketing Hub",
      "Export contracts prepared; no live connection. Steve must agree the receiving schema, reporting periods and consent policy.",
    ],
    [
      "Store & phone readiness",
      "Customer scanner, aisle guidance and pickup disabled. Operations must verify the floor plan and fulfillment; Steve must arrange physical iPhone/Android testing.",
    ],
  );
  return (
    <>
      <div className="intro">
        <p className="eyebrow">{fixture ? "FIXTURE PREVIEW" : "STAFF"}</p>
        <h1>Integration health</h1>
        <p>
          {fixture
            ? "No live provider requests are made in this preview."
            : "Read-only checks made when this page loads. Configuration alone does not verify checkout."}
        </p>
      </div>
      <div className="health-list">
        {rows.map(([label, status]) => (
          <section className="panel" key={label}>
            <h2>{label}</h2>
            <p>{status}</p>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>Order processing</h2>
        {state.jobs.length ? (
          state.jobs.map((j) => (
            <p key={j.state}>
              {j.state}: {j.count}
            </p>
          ))
        ) : (
          <p>No recorded jobs{fixture ? " in this fixture view" : " yet"}.</p>
        )}
        {state.receipts.map((r, i) => (
          <p key={i}>
            Last received:{" "}
            {r.last_received
              ? new Date(r.last_received).toISOString()
              : "Never"}
            <br />
            Last processed:{" "}
            {r.last_processed
              ? new Date(r.last_processed).toISOString()
              : "Never"}
          </p>
        ))}
        <p>
          Failed jobs need configuration review and a deliberate retry. A
          checkout return is never marked as a paid order.
        </p>
      </section>
      <Link className="back" href="/staff">
        ← Staff workspace
      </Link>
    </>
  );
}
