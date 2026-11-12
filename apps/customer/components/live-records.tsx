import { LogoutControl } from "./logout";
import Link from "next/link";
import { StaffInvite } from "./staff-invite";
import { StaffHome, StaffSignedOut } from "./staff-home";
import { privateRequest } from "@/lib/server/http";
import { authReadiness } from "@/lib/server/providers";
import { consignmentItems } from "@/lib/server/consignment";
import { consignmentStates } from "@/lib/consignment";
import { ConsignmentWorkspace } from "./consignment-workspace";
import { requireRole, requireCustomer } from "@/lib/server/db";
import { loadCustomerAccount } from "@/lib/server/customer-commerce";
export function SignOut({
  providerLogout = false,
}: {
  providerLogout?: boolean;
}) {
  return <LogoutControl providerLogout={providerLogout} />;
}
export async function LiveAccount({
  returnTo = "/account",
}: { returnTo?: string } = {}) {
  const signed = await privateRequest(async (_db, actor) => {
    requireCustomer(actor);
    return true;
  }).catch(() => false);
  const customer = signed
    ? await loadCustomerAccount().catch(() => null)
    : null;
  const ready = authReadiness();
  return (
    <>
      <div className="intro">
        <p className="eyebrow">YOUR NORTHSIDE</p>
        <h1>Your account</h1>
      </div>
      <div className="account-grid">
        <section className="panel">
          <h2>{signed ? "You’re signed in" : "Customer sign-in"}</h2>
          {signed ? (
            <>
              <p>
                {customer
                  ? `Welcome${customer.firstName ? `, ${customer.firstName}` : ""}.`
                  : "You’re signed in. Your Shopify profile is temporarily unavailable."}
              </p>
              {customer?.emailAddress?.emailAddress && (
                <p>{customer.emailAddress.emailAddress}</p>
              )}
              <Link
                className="button secondary"
                prefetch={false}
                href={returnTo === "/account" ? "/my-cards/grading" : returnTo}
              >
                Continue to your cards →
              </Link>
              <SignOut providerLogout />
            </>
          ) : (
            <>
              <p>
                {ready.customer
                  ? "Use your Northside Shopify customer account."
                  : "Shopify customer sign-in is awaiting configuration. No real login has been verified."}
              </p>
              <form action="/api/auth/shopify/login" method="post">
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="button" disabled={!ready.customer}>
                  Sign in with Shopify
                </button>
              </form>
            </>
          )}
        </section>
        <section className="panel">
          <Link
            className="account-link"
            href="/account/orders"
            prefetch={false}
          >
            Your Shopify orders →
          </Link>
          <Link className="account-link" href="/my-cards" prefetch={false}>
            Grading & consignment →
          </Link>
          <Link className="account-link" href="/rewards" prefetch={false}>
            Northside Rewards →
          </Link>
          <Link className="account-link" href="/staff/login" prefetch={false}>
            Invited staff sign-in →
          </Link>
          <form action="/api/commerce/campaign" method="post">
            <input type="hidden" name="consent" value="no" />
            <button
              className="plain"
              disabled={
                !process.env.COMMERCE_DATABASE_URL || !process.env.APP_ORIGIN
              }
            >
              Forget remembered campaign
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
export function LiveCards() {
  return <ConsignmentWorkspace fixture={false} staff={false} />;
}
export async function StaffWorkspace() {
  const state = await privateRequest(async (db, actor) => {
    requireRole(actor, [
      "owner",
      "admin",
      "operations",
      "content_editor",
      "read_only",
    ]);
    const cards =
      actor.staff_role === "content_editor"
        ? []
        : (await consignmentItems(db, actor)).map((c) => ({
            id: c.id,
            description: c.description,
            kind: "consignment",
            status: consignmentStates[c.state_key],
          }));
    return { role: actor.staff_role, cards };
  }).catch(() => null);
  if (!state) return <StaffSignedOut />;
  return (
    <StaffHome
      role={state.role ?? ""}
      cards={state.cards}
      signOut={<SignOut />}
      adminTools={
        ["owner", "admin"].includes(state.role || "")
          ? <StaffInvite owner={state.role === "owner"} />
          : undefined
      }
    />
  );
}
