import { LogoutControl } from "./logout";
import Link from "next/link";
import { StaffInvite } from "./staff-invite";
import { privateRequest } from "@/lib/server/http";
import { authReadiness } from "@/lib/server/providers";
import { consignmentItems } from "@/lib/server/consignment";
import { consignmentStates } from "@/lib/consignment";
import { ConsignmentWorkspace } from "./consignment-workspace";
import { requireRole, requireCustomer } from "@/lib/server/db";
import { loadCustomerAccount } from "@/lib/server/customer-commerce";
export function SignOut() {
  return <LogoutControl />;
}
export async function LiveAccount() {
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
              <SignOut />
            </>
          ) : (
            <>
              <p>
                {ready.customer
                  ? "Use your Northside Shopify customer account."
                  : "Shopify customer sign-in is awaiting configuration. No real login has been verified."}
              </p>
              <form action="/api/auth/shopify/login" method="post">
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
  if (!state)
    return (
      <div className="empty">
        <h1>Staff workspace</h1>
        <p>An active invited staff membership is required.</p>
        <Link className="button" href="/staff/login">
          Staff sign-in
        </Link>
      </div>
    );
  return (
    <>
      <div className="intro">
        <p className="eyebrow">INVITED STAFF WORKSPACE</p>
        <h1>Northside operations</h1>
        <p>
          Signed in as {state.role?.replaceAll("_", " ")}. Permissions are
          checked by the server and database.
        </p>
        <SignOut />
        <Link className="button" href="/staff/grading">
          Open grading desk →
        </Link>
        <Link className="button secondary" href="/staff/consignment">
          Open consignment desk →
        </Link>
        <Link className="button secondary" href="/staff/store">
          Open store workspace →
        </Link>
        <Link className="button secondary" href="/staff/breaks">
          Open break desk →
        </Link>
        <Link className="button secondary" href="/staff/rewards">
          Open rewards desk →
        </Link>
      </div>
      {["owner", "admin"].includes(state.role || "") && (
        <StaffInvite owner={state.role === "owner"} />
      )}
      {state.cards.map((card) => (
        <article className="case" key={card.id}>
          <h2>{card.description}</h2>
          <p>
            {card.kind} · {card.status}
          </p>
        </article>
      ))}
      {!state.cards.length && (
        <div className="empty">
          <h2>No operational records to display</h2>
          <p>
            Grading and consignment intake are available in their saved
            workspaces.
          </p>
        </div>
      )}
      <p className="fine">
        Public purchases, loyalty earning/redemption, scanning, aisle navigation
        and pickup remain disabled.
      </p>
      <Link className="back" href="/staff/integrations" prefetch={false}>
        Integration health →
      </Link>
    </>
  );
}
