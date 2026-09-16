"use client";
import Link from "next/link";
import { useState } from "react";
import type { CartView, Merchandise } from "@/lib/commerce";
import { formatMoney } from "@/lib/commerce";
import { publicFlags } from "@/lib/policy.mjs";
const messages: Record<string, string> = {
  purchases_disabled: "Purchases are not open yet.",
  quantity_unavailable:
    "That quantity is no longer available. Review your cart.",
  cart_expired: "Your cart expired. Start a new cart to continue.",
  cart_owner_mismatch:
    "This cart belongs to a different account. Start a new cart.",
  cart_changed_review_required:
    "Shopify updated your cart. Refresh it and review quantities and totals before continuing.",
  sign_in_required:
    "Sign in again, or start a new guest cart after signing out.",
  invalid_quantity: "Enter a whole quantity from 1 to 99.",
};
async function requestCart(body?: object) {
  const r = await fetch("/api/commerce/cart", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      messages[data.error] ||
        "Shopify is unavailable. Refresh your cart before trying again; the last change may have reached Shopify.",
    );
  return data;
}
export function ProductControls({ product }: { product: Merchandise }) {
  const [selected, setSelected] = useState(product.variants.nodes[0]?.id || ""),
    [n, setN] = useState(1),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const variant = product.variants.nodes.find((v) => v.id === selected);
  const available =
    !!variant?.availableForSale &&
    !variant.currentlyNotInStock &&
    (variant.quantityAvailable || 0) >= n;
  return (
    <>
      <p className="price">
        {variant ? formatMoney(variant.price) : "Variant unavailable"}
      </p>
      <label>
        Variant
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setNotice("");
          }}
        >
          {product.variants.nodes.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
              {!v.availableForSale || !v.quantityAvailable
                ? " · Unavailable"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input
          type="number"
          min={1}
          max={99}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
        />
      </label>
      <p>
        {available
          ? "Available online · checked again before checkout"
          : "This selection is unavailable in the requested quantity."}
      </p>
      <button
        className="button"
        disabled={!publicFlags.purchases || !available || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await requestCart({
              action: "add",
              variantId: selected,
              quantity: n,
            });
            setNotice("Added to your cart.");
          } catch (e) {
            setNotice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {publicFlags.purchases
          ? busy
            ? "Adding…"
            : "Add to cart"
          : "Purchases not open yet"}
      </button>
      <p role="status">{notice}</p>
      <Link className="back" href="/cart" prefetch={false}>
        View cart →
      </Link>
      <p className="fine">
        Adding an item does not reserve it. Pickup is unavailable.
      </p>
    </>
  );
}
export function LiveCart() {
  const [cart, setCart] = useState<CartView | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function act(body?: object) {
    setBusy(true);
    setNotice("");
    try {
      const result = await requestCart(body);
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
      else if (result.reset) {
        setCart(null);
        setNotice("Cart cleared. Choose an item from the shop.");
      } else setCart(result);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="intro">
        <p className="eyebrow">YOUR BAG</p>
        <h1>Your cart</h1>
        <p>
          Shopify confirms prices, discounts and availability. Shipping and tax
          are finalized at checkout.
        </p>
      </div>
      {!publicFlags.purchases ? (
        <div className="empty">
          <h2>Purchases are not open yet</h2>
          <p>Real checkout testing and store setup are still pending.</p>
        </div>
      ) : (
        <>
          <button className="button" disabled={busy} onClick={() => act()}>
            Load / refresh cart
          </button>
          <button
            className="plain"
            disabled={busy}
            onClick={() => act({ action: "reset" })}
          >
            Start a new cart
          </button>
          {cart && (
            <>
              {!cart.lines.nodes.length && <p>Your cart is empty.</p>}
              {cart.lines.nodes.map((line) => (
                <div className="cart-row" key={line.id}>
                  <div>
                    <Link href={`/shop/${line.merchandise.product.handle}`}>
                      {line.merchandise.product.title}
                    </Link>
                    <p>
                      {line.merchandise.title} ·{" "}
                      {formatMoney(line.cost.totalAmount)}
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      act({
                        action: "update",
                        lineId: line.id,
                        quantity: Number(d.get("quantity")),
                      });
                    }}
                  >
                    <label>
                      Quantity
                      <input
                        key={line.quantity}
                        name="quantity"
                        type="number"
                        min="1"
                        max="99"
                        defaultValue={line.quantity}
                        required
                      />
                    </label>
                    <button disabled={busy}>Update</button>
                  </form>
                  <button
                    className="plain"
                    disabled={busy}
                    onClick={() =>
                      act({ action: "update", lineId: line.id, quantity: 0 })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="cart-total">
                <h2>
                  {cart.cost.totalAmountEstimated ? "Estimated total" : "Total"}{" "}
                  {formatMoney(cart.cost.totalAmount)}
                </h2>
                <p>Shopify subtotal: {formatMoney(cart.cost.subtotalAmount)}</p>
                {cart.discountCodes.map((d) => (
                  <p key={d.code}>
                    {d.code}:{" "}
                    {d.applicable
                      ? "Applicable"
                      : "Not applicable to this cart"}
                  </p>
                ))}
                <button
                  className="button"
                  disabled={busy || !cart.totalQuantity}
                  onClick={() => act({ action: "checkout" })}
                >
                  Continue to Shopify checkout
                </button>
              </div>
            </>
          )}
        </>
      )}
      <p role="status">{notice}</p>
      <Link className="back" href="/shop">
        Continue browsing →
      </Link>
    </>
  );
}
