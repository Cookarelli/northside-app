"use client";
import { useState } from "react";

export function CheckoutTest() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        setUrl(null);
        try {
          const response = await fetch("/api/private/commerce/checkout-test", {
            method: "POST",
            credentials: "same-origin",
            redirect: "error",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              variantId: data.get("variant"),
              quantity: Number(data.get("quantity")),
            }),
          });
          const result = await response.json();
          if (!response.ok) {
            setMessage(result.error || "Test checkout unavailable.");
            return;
          }
          setUrl(result.checkoutUrl);
          setMessage(
            `Development-store checkout prepared for ${result.shop}. No order has been placed.`,
          );
        } catch {
          setMessage(
            "The request did not complete. No payment was submitted. Review before retrying.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label>
        Development-store variant ID
        <input
          name="variant"
          required
          maxLength={100}
          placeholder="gid://shopify/ProductVariant/…"
        />
      </label>
      <label>
        Quantity
        <input
          name="quantity"
          type="number"
          min={1}
          max={5}
          defaultValue={1}
          required
        />
      </label>
      <button className="button" disabled={pending}>
        {pending ? "Checking development store…" : "Prepare test checkout"}
      </button>
      <p role="status">{message}</p>
      {url && (
        <a className="button" href={url} rel="noreferrer">
          Open development-store checkout
        </a>
      )}
    </form>
  );
}
