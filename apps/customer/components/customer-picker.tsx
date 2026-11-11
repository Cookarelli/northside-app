"use client";
import { useEffect, useState } from "react";
type Customer = { id: string; display_name: string; verified: boolean };
export function CustomerPicker({
  customers,
  verifiedOnly = false,
  fixture = false,
}: {
  customers: Customer[];
  verifiedOnly?: boolean;
  fixture?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [remote, setRemote] = useState<{ key: string; rows: Customer[] } | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(
        `${fixture ? "/api/preview/card-tracking?actor=staff&" : "/api/private/card-tracking?"}customers=1&q=${encodeURIComponent(query.trim())}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (r) => {
          if (!r.ok) throw Error();
          return r.json();
        })
        .then((v) => {
          if (active) {
            setRemote({ key: query, rows: v.customers });
            setError("");
          }
        })
        .catch(() => {
          if (active)
            setError(
              "Customer search unavailable. Select an already loaded exact record or retry.",
            );
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, fixture]);
  const rows = (
    remote?.key === query
      ? remote.rows
      : customers.filter((c) =>
          `${c.display_name} ${c.id}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
  ).filter((c) => !verifiedOnly || c.verified);
  return (
    <>
      <label>
        Find customer by name or exact customer ID
        <input
          value={query}
          maxLength={100}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected("");
            setError("");
          }}
          type="search"
          autoComplete="off"
        />
      </label>
      <label>
        Exact customer record
        <select
          name="customer_id"
          required
          value={rows.some((c) => c.id === selected) ? selected : ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="" disabled>
            Select {verifiedOnly ? "verified " : ""}customer
          </option>
          {rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name} · {c.id.slice(-8)} ·{" "}
              {c.verified ? "verified account" : "receipt claim required"}
            </option>
          ))}
        </select>
      </label>
      <p className="fine">
        Confirm the exact record with the customer. Search never merges
        identities or grants a receipt claim.
      </p>
      {error && <p role="status">{error}</p>}
    </>
  );
}
