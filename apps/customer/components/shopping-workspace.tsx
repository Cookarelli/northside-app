"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { StoreScanner } from "./store-scanner";
import { CartQuantityControls } from "./commerce-controls";
import type { ShoppingResponse } from "@/lib/shopping";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const messages: Record<string, string> = {
  cart_changed_reload:
    "Your cart changed in another tab. Reload it before trying again.",
  shopping_session_expired:
    "Your shopping session expired. Start a new list to continue.",
  cart_owner_mismatch:
    "This list belongs to another account. Start a new list to continue.",
  scan_price_changed_review_required:
    "A price changed. Remove the item, scan it again and review its current price.",
  quantity_unavailable:
    "That quantity is unavailable. Reduce the quantity or remove the item.",
  cancel_handoff_before_editing: "Cancel the handoff before editing your cart.",
  handoff_expired_cancel_and_retry:
    "This handoff expired. Cancel it and select Ready to Pay again.",
  staff_sign_in_required:
    "Staff sign-in is required. Use the existing staff sign-in, then try again.",
  handoff_not_found: "This handoff is canceled, invalid or unavailable.",
  handoff_expired:
    "This handoff expired. Ask the customer to generate a new one.",
};
async function request(
  body?: object,
  method = body ? "POST" : "GET",
): Promise<ShoppingResponse> {
  const r = await fetch("/api/shopping", {
    method,
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      messages[data.error] ||
        "The request could not be completed. Reload your cart before retrying.",
    );
  return data;
}
let opening: Promise<ShoppingResponse> | undefined;
function openList() {
  // React development remounts must not race two cookie-creating requests.
  opening ??= request({ action: "start" }).finally(() => {
    opening = undefined;
  });
  return opening;
}
export function ShoppingWorkspace({
  sample,
  scanner = false,
}: {
  sample: boolean;
  scanner?: boolean;
}) {
  const [cart, setCart] = useState<ShoppingResponse | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(0),
    [quantityRevision, setQuantityRevision] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    let gone = false;
    openList()
      .then((c) => {
        if (!gone) setCart(c);
      })
      .catch((e) => {
        if (!gone) setError(e.message);
      });
    return () => {
      gone = true;
    };
  }, []);
  useEffect(() => {
    if (!cart?.handoff) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cart?.handoff]);
  async function action(body?: object) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      setCart(await request(body));
      setQuantityRevision((revision) => revision + 1);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const locked = !cart || busy || cart.phase !== "shopping";
  return (
    <div className="page-stack ns-shopping-workspace">
      <div className="page-heading">
        <span className="eyebrow">
          In-store shopping{sample ? " · SAMPLE rehearsal" : ""}
        </span>
        <h1>{scanner ? "Scan and shop" : "Your in-store cart"}</h1>
        <p>
          Scan, review and bring your unpaid list to the register. Items are not
          reserved. Payment happens with staff.
        </p>
      </div>
      <div className="actions ns-workspace-links">
        <Link className="button secondary" href="/scan" prefetch={false}>
          Scan Product
        </Link>
        <Link
          className="button secondary"
          href="/cart?inStore=1"
          prefetch={false}
        >
          View complete cart
        </Link>
      </div>
      {scanner && (
        <StoreScanner
          endpoint="/api/shopping"
          fixture={sample}
          shopping={{
            locked,
            add: async (code, variantId, reviewedPriceCents) => {
              if (!cart) return;
              await action({
                action: "add",
                code,
                variantId,
                reviewedPriceCents,
                version: cart.version,
              });
            },
          }}
        />
      )}
      {error && (
        <p role="alert" className="loyalty-notice">
          {error}
        </p>
      )}
      <section
        className="loyalty-card ns-list-card"
        aria-label="In-store cart"
        aria-busy={busy}
      >
        <h2>Complete cart</h2>
        {!cart ? (
          <p role="status">
            {error ? "Your list could not be loaded." : "Loading your list…"}
          </p>
        ) : (
          <>
            {!cart.lines.length && (
              <div className="empty">
                <h3>Your next find starts with a scan.</h3>
                <p>Your cart is empty. Open Scan Product to add an item.</p>
                <Link className="button" href="/scan" prefetch={false}>
                  Scan Product
                </Link>
              </div>
            )}
            <ul className="shopping-lines">
              {cart.lines.map((line) => (
                <li key={line.variantId}>
                  {line.image && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={line.image.url}
                        alt={line.image.altText || line.title}
                        width={96}
                        height={72}
                        style={{ objectFit: "contain" }}
                      />
                    </>
                  )}
                  <div>
                    <h3>{line.title}</h3>
                    <p>
                      {line.variantTitle} · {money(line.priceCents)} each
                    </p>
                    <CartQuantityControls
                      quantity={line.quantity}
                      resetRevision={quantityRevision}
                      title={line.title}
                      busy={locked}
                      onChange={(quantity) =>
                        void action({
                          action: "set",
                          variantId: line.variantId,
                          quantity,
                          version: cart.version,
                        }).catch(() => {})
                      }
                    />
                    <p>
                      Line subtotal: {money(line.quantity * line.priceCents)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="price">
              Subtotal: {money(cart.subtotalCents)}
              {sample ? " · SAMPLE" : ""}
            </p>
            <p>
              USD · Before tax, discounts or register adjustments. Staff confirm
              the final total.
            </p>
            {!cart.handoff && (
              <button
                className="button"
                disabled={locked || !cart.lines.length}
                onClick={() =>
                  void action({ action: "ready", version: cart.version }).catch(
                    () => {},
                  )
                }
              >
                Ready to Pay
              </button>
            )}
            {cart.handoff && (
              <section
                className="ns-register-handoff"
                aria-label="Unpaid staff handoff"
              >
                <h3>
                  {now >= cart.handoff.expiresAt
                    ? "Handoff expired"
                    : "Show this to staff"}
                </h3>
                <p>
                  <strong className="ns-unpaid">
                    UNPAID — payment has not been completed.
                  </strong>
                </p>
                <p>
                  Staff use this summary to enter and verify items at the
                  register. Automatic Shopify POS import is unavailable.
                </p>
                {now < cart.handoff.expiresAt && cart.qr && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cart.qr}
                      alt="Unpaid staff handoff QR"
                      width={288}
                      height={288}
                      style={{ maxWidth: "100%", height: "auto" }}
                    />
                  </>
                )}
                <label>
                  Staff handoff reference
                  <input
                    readOnly
                    value={cart.handoff.reference}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                <p>
                  Expires{" "}
                  {new Date(cart.handoff.expiresAt).toLocaleTimeString(
                    "en-US",
                    { timeZone: "America/Chicago" },
                  )}{" "}
                  Chicago time.
                </p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: "cancel",
                      version: cart.version,
                    }).catch(() => {})
                  }
                >
                  Cancel handoff and keep shopping
                </button>
              </section>
            )}
          </>
        )}
        <div className="actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void action().catch(() => {})}
          >
            Reload cart
          </button>
          {!cart && error && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                try {
                  await request(undefined, "DELETE");
                  setCart(await request({ action: "start" }));
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
            >
              Start a new list
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function StaffShoppingHandoff({ sample }: { sample: boolean }) {
  const [reference, setReference] = useState(""),
    [cart, setCart] = useState<ShoppingResponse | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cart?.handoff) return;
    const timer = setTimeout(
      () => {
        setCart(null);
        setError(messages.handoff_expired);
      },
      Math.max(0, cart.handoff.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [cart]);
  return (
    <div className="page-stack ns-shopping-workspace">
      <div className="page-heading">
        <h1>Register handoff{sample ? " · SAMPLE" : ""}</h1>
        <p>
          Staff assistance: verify the physical items, current stock, price and
          tax at the register before taking payment.
        </p>
      </div>
      <Link href={sample ? "/in-store/staff" : "/staff/login"} prefetch={false}>
        Staff sign-in
      </Link>
      <form
        className="loyalty-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          setCart(null);
          try {
            setCart(
              await request({
                action: "inspect",
                reference: reference
                  .trim()
                  .replace(/^northside-handoff:v1:/, ""),
              }),
            );
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Scan or paste the handoff reference
          <input
            required
            maxLength={80}
            disabled={busy}
            value={reference}
            onChange={(e) => {
              setReference(e.target.value);
              setCart(null);
            }}
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Looking up…" : "Look up unpaid summary"}
        </button>
      </form>
      {busy && <p role="status">Looking up the unpaid summary…</p>}
      {error && <p role="alert">{error}</p>}
      {cart && (
        <section className="loyalty-card ns-register-handoff">
          <h2>UNPAID shopping summary</h2>
          <p>
            Recheck this reference immediately before use. Canceled or expired
            references cannot be retrieved.
          </p>
          <ul>
            {cart.lines.map((line) => (
              <li key={line.variantId}>
                {line.title} · {line.variantTitle} · Quantity {line.quantity} ·{" "}
                {money(line.quantity * line.priceCents)}
                <p className="small">Shopify variant: {line.variantId}</p>
              </li>
            ))}
          </ul>
          <p>Subtotal: {money(cart.subtotalCents)} USD</p>
          <p>
            No POS import or payment confirmation is performed. Enter and verify
            these items using the register’s normal workflow.
          </p>
        </section>
      )}
    </div>
  );
}
