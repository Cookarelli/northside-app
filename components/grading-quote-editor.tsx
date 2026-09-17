"use client";
import { useEffect, useState } from "react";
import {
  quoteCharges,
  quoteLabels,
  type GradingQuote,
} from "@/lib/grading-portal";
import { QuoteSummary } from "./grading-portal";
export function GradingQuoteEditor({
  cardId,
  endpoint,
  providers,
  writer,
}: {
  cardId: string;
  endpoint: string;
  providers: { key: string; label: string; confirmed: boolean }[];
  writer: boolean;
}) {
  const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}quote=${cardId}`;
  const [data, setData] = useState<{
      quotes: GradingQuote[];
      examination_cents: number;
      approval_current: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw Error(String(v.error).replaceAll("_", " "));
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [url, reload]);
  const q = data?.quotes[0] ?? null;
  return (
    <section className="quote-editor">
      <h3>Submission quote & approval</h3>
      {data && (
        <>
          <p className="grading-notice">
            {data.approval_current
              ? "Current collector approval is recorded. Dispatch must also match this quote’s provider and service."
              : "Dispatch blocked: current collector approval is required."}
          </p>
          <QuoteSummary quote={q} examination={data.examination_cents} />
          {writer && (
            <details>
              <summary>Configure a new quote revision</summary>
              <p>
                All external charges start unset. Enter confirmed amounts in
                USD; type 0.00 only when that charge is explicitly zero.
                Shipping and insurance are this card’s allocated share. A new
                quote requires renewed collector approval.
              </p>
              <form
                key={q?.id ?? "new"}
                className="grading-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError("");
                  setMessage("");
                  const v = Object.fromEntries(new FormData(e.currentTarget));
                  let body: Record<string, unknown>;
                  try {
                    body = pending ?? {
                      ...v,
                      action: "quote",
                      card_id: cardId,
                      previous_id: q?.id ?? null,
                      request_id: crypto.randomUUID(),
                      ...Object.fromEntries(
                        quoteCharges.map((k) => {
                          const raw = String(v[k]).trim();
                          if (raw && !/^\d+(?:\.\d{1,2})?$/.test(raw))
                            throw Error(
                              "Enter charges in dollars with at most two decimal places, or leave blank.",
                            );
                          return [
                            k,
                            raw ? Math.round(Number(raw) * 100) : null,
                          ];
                        }),
                      ),
                    };
                  } catch (e) {
                    setError((e as Error).message);
                    return;
                  }
                  setPending(body);
                  setBusy(true);
                  try {
                    const r = await fetch(endpoint, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    const out = await r.json();
                    if (!r.ok)
                      throw Error(
                        String(out.error ?? "Quote not confirmed").replaceAll(
                          "_",
                          " ",
                        ),
                      );
                    setPending(null);
                    setMessage(
                      "Quote revision saved. The collector must approve this revision before dispatch.",
                    );
                    setReload((n) => n + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <fieldset
                  disabled={busy || !!pending}
                  className="grading-controls"
                >
                  <label>
                    Grading provider
                    <select name="provider" defaultValue={q?.provider ?? "psa"}>
                      {providers
                        .filter((p) => p.confirmed)
                        .map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Configured grading service
                    <input
                      name="service"
                      maxLength={120}
                      defaultValue={q?.service ?? ""}
                      placeholder="Not configured"
                    />
                  </label>
                  {quoteCharges.map((k) => (
                    <label key={k}>
                      {quoteLabels[k]} (USD)
                      <input
                        name={k}
                        inputMode="decimal"
                        defaultValue={
                          q?.[k] == null ? "" : (q[k]! / 100).toFixed(2)
                        }
                        placeholder="Not yet quoted"
                      />
                    </label>
                  ))}
                  <label>
                    Describe other charges
                    <input
                      name="other_label"
                      maxLength={160}
                      defaultValue={q?.other_label ?? ""}
                    />
                  </label>
                  <label>
                    Customer-visible quote terms
                    <textarea
                      name="terms"
                      maxLength={3000}
                      defaultValue={q?.terms ?? ""}
                    />
                  </label>
                  <label>
                    Reason for this quote revision (staff only)
                    <input name="reason" required maxLength={1000} />
                  </label>
                </fieldset>
                <button className="button" disabled={busy}>
                  {pending ? "Retry same quote" : "Save quote revision"}
                </button>
                {pending && (
                  <button
                    className="plain"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPending(null);
                      setReload((n) => n + 1);
                    }}
                  >
                    Review latest quote
                  </button>
                )}
              </form>
            </details>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p role="status">{busy ? "Saving quote…" : message}</p>
    </section>
  );
}
