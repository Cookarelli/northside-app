"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PhotoView } from "./northside-exam";
import { photoLabels } from "@/lib/exam";
import { examMoney } from "@/lib/grading";
import {
  quoteCharges,
  quoteLabels,
  quoteComplete,
  decisionSelection,
  submissionReady,
  returnAvailable,
  type GradingQuote,
  type PortalCard,
  type PortalData,
  type PortalDetail,
} from "@/lib/grading-portal";
const when = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(v));
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Connection unavailable. Retry when connected.";
export function QuoteSummary({
  quote,
  examination,
}: {
  quote: GradingQuote | null;
  examination: number;
}) {
  return (
    <div className="portal-quote">
      <h3>
        Itemized submission quote {quote ? `· revision ${quote.revision}` : ""}
      </h3>
      <p>
        {quote?.provider_label ?? "PSA"} ·{" "}
        {quote?.service || "Service not configured"}
      </p>
      <dl>
        <div>
          <dt>Northside examination (intake fee)</dt>
          <dd>{examMoney(examination)}</dd>
        </div>
        {quoteCharges.map((k) => (
          <div key={k}>
            <dt>
              {quoteLabels[k]}
              {k === "other_cents" && quote?.other_label
                ? ` · ${quote.other_label}`
                : ""}
            </dt>
            <dd>
              {quote?.[k] === null || quote?.[k] === undefined
                ? "Not yet quoted"
                : examMoney(quote[k]!)}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        <strong>
          {quoteComplete(quote)
            ? `Total for this card: ${examMoney(examination + quoteCharges.reduce((sum, k) => sum + (quote![k] ?? 0), 0))}`
            : "Total pending — charges are not fully quoted."}
        </strong>
      </p>
      <p className="fine">
        The examination fee is shown once as part of this total. Approval
        records your decision; it does not take payment.
      </p>
      {quote?.terms && <p className="preserve-lines">{quote.terms}</p>}
      {quote && <small>Quoted {when(quote.created_at)}</small>}
    </div>
  );
}
function Status({ card: c }: { card: PortalCard }) {
  return (
    <>
      <span className="badge">
        {c.status_key === "ready_to_submit" && !c.approval_current
          ? "Approval needs renewal"
          : c.label}
      </span>
      {c.approval_current ? (
        <p>Current submission approval recorded.</p>
      ) : c.decision?.choice === "submit" ? (
        <p className="grading-notice">
          {returnAvailable(c)
            ? "The exam or quote has changed. Review and approve the current revisions before dispatch."
            : "A newer exam or quote is available. Your earlier approval remains in history; contact Northside about the change."}
        </p>
      ) : c.decision?.choice === "return" ? (
        <p>
          Return requested {when(c.decision.created_at)}. Northside will arrange
          the physical return.
        </p>
      ) : null}
    </>
  );
}
export function CustomerGradingPortal({
  fixture,
  actor = "a",
  cardId,
}: {
  fixture: boolean;
  actor?: string;
  cardId?: string;
}) {
  const router = useRouter();
  const base = fixture
    ? `/api/preview/grading/portal?actor=${actor}`
    : "/api/private/grading/portal?";
  const api = `${base}${base.endsWith("?") ? "" : "&"}${cardId ? `card=${cardId}` : ""}`;
  const suffix = fixture ? `?actor=${actor}` : "";
  const path = cardId
    ? `/my-cards/grading/card/${cardId}`
    : "/my-cards/grading";
  const [data, setData] = useState<PortalData | null>(null),
    [detail, setDetail] = useState<PortalDetail | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [choice, setChoice] = useState<"submit" | "return" | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [reload, setReload] = useState(0),
    [claimCode, setClaimCode] = useState("");
  const read = useCallback(async () => {
    const r = await fetch(api, { cache: "no-store" });
    const v = await r.json();
    if (!r.ok)
      throw Error(
        String(v.error ?? "Records unavailable").replaceAll("_", " "),
      );
    return v;
  }, [api]);
  useEffect(() => {
    let active = true;
    read()
      .then((v) => {
        if (active) {
          if (cardId) {
            setDetail(v);
            setData({ cards: [v.card] });
          } else setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setDetail(null);
          setError(errorText(e));
        }
      });
    return () => {
      active = false;
    };
  }, [read, cardId, reload]);
  const chosen = data?.cards.filter((c) => selected.includes(c.card_id)) ?? [];
  const examEndpoint = (id: string) =>
    `${fixture ? "/api/preview" : "/api/private"}/grading/exam?card=${id}${fixture ? `&actor=${actor}` : ""}`;
  const decide = async () => {
    if (!choice || !confirmed || !chosen.length) return;
    const body = pending ?? {
      choice,
      confirmed: true,
      request_id: crypto.randomUUID(),
      cards: decisionSelection(chosen),
    };
    setPending(body);
    setBusy(true);
    setError("");
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok)
        throw Error(
          String(v.error ?? "Decision unconfirmed").replaceAll("_", " "),
        );
      setMessage(
        `Your ${choice === "submit" ? "submission approval" : "return request"} is saved for ${chosen.length} selected ${chosen.length === 1 ? "card" : "cards"}. Reference ${v.id}.`,
      );
      setPending(null);
      setChoice(null);
      setConfirmed(false);
      setSelected([]);
      setReload((n) => n + 1);
    } catch (e) {
      setError(
        errorText(e) +
          ". Retry the same decision, or review the latest records.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="customer-grading">
      <div className="intro">
        <p className="eyebrow">MY CARDS → GRADING</p>
        <h1>{cardId ? "Your grading card" : "Track my cards"}</h1>
        <p>
          Dropped off at Northside. Photos, examinations, quotes and recorded
          progress in one place.
        </p>
        <p className="fine">
          PSA is the confirmed provider. Milestones and final results are
          recorded by Northside; no provider feed is connected.
        </p>
      </div>
      {fixture && (
        <aside className="grading-notice">
          <strong>SAMPLE CUSTOMER PORTAL · Saved local records</strong>
          <label>
            Sample collector
            <select
              value={actor}
              onChange={(e) => {
                router.push(`${path}?actor=${e.target.value}`);
              }}
            >
              <option value="a">Sample collector A</option>
              <option value="b">Sample collector B</option>
            </select>
          </label>
          <Link href="/staff/grading">Open staff sample →</Link>
        </aside>
      )}
      <div className="grading-toolbar">
        <Link href={cardId ? `/my-cards/grading${suffix}` : "/my-cards"}>
          ← {cardId ? "All grading cards" : "My Cards"}
        </Link>
        <button
          className="plain"
          disabled={busy}
          onClick={() => {
            setPending(null);
            setChoice(null);
            setConfirmed(false);
            setSelected([]);
            setData(null);
            setDetail(null);
            setReload((n) => n + 1);
          }}
        >
          Review latest records
        </button>
        {data && <a href={`${base}&export=1`}>Export my grading cards</a>}
      </div>
      {error && (
        <div className="grading-notice" role="alert">
          <p>{error}</p>
          {!fixture && !data && (
            <Link
              className="button"
              href={`/account?returnTo=${encodeURIComponent(path)}`}
            >
              Sign in with Shopify to return here
            </Link>
          )}
        </div>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Saving your decision…" : message}
      </p>
      {!data && !error && <p>Loading your saved cards…</p>}
      {data?.cards.length === 0 && (
        <section className="empty">
          <h2>No grading cards linked yet</h2>
          <p>Northside can help verify and link your intake receipt.</p>
        </section>
      )}
      {data && (
        <>
          <div className={cardId ? "" : "portal-card-grid"}>
            {data.cards.map((c) => (
              <article className="panel portal-card" key={c.card_id}>
                <Status card={c} />
                <h2>{c.description}</h2>
                <p className="fine">
                  Card {c.card_id}
                  <br />
                  Dropped off {when(c.received_at)}
                  <br />
                  Last updated {when(c.updated_at)} · America/Chicago
                </p>
                <div className="portal-photo-grid">
                  {(cardId
                    ? c.photos
                    : c.photos.filter(
                        (p) => p.kind === "front" || p.kind === "back",
                      )
                  ).map((p) => (
                    <figure key={p.id}>
                      <PhotoView photo={p} endpoint={examEndpoint(c.card_id)} />
                      <figcaption>{photoLabels[p.kind]}</figcaption>
                    </figure>
                  ))}
                </div>
                {!c.photos.length && (
                  <p>
                    Photos have not been confirmed yet. Your received card is
                    saved.
                  </p>
                )}
                {c.exam ? (
                  <p>
                    Published Northside Exam · revision {c.exam.revision} ·{" "}
                    {when(c.exam.signed_at)}{" "}
                    <Link
                      prefetch={false}
                      href={`/my-cards/grading/exam/${c.card_id}${suffix}`}
                    >
                      Read exam & printable report →
                    </Link>
                  </p>
                ) : (
                  <p>Northside Exam awaiting publication.</p>
                )}
                {cardId ? (
                  <QuoteSummary
                    quote={c.quote}
                    examination={c.examination_cents}
                  />
                ) : (
                  <>
                    <p>
                      {quoteComplete(c.quote)
                        ? `Quote revision ${c.quote!.revision} ready for review`
                        : "Submission quote incomplete — charges not yet configured"}
                    </p>
                    <Link
                      className="button secondary"
                      prefetch={false}
                      href={`/my-cards/grading/card/${c.card_id}${suffix}`}
                    >
                      View card, receipt & quote →
                    </Link>
                  </>
                )}
                {c.result && (
                  <div className="grading-notice">
                    <h3>External grader’s final result</h3>
                    <p>
                      {c.result}
                      {c.certificate ? ` · Certificate ${c.certificate}` : ""}
                    </p>
                    <small>
                      Recorded by Northside; separate from the Northside Exam
                      estimate.
                    </small>
                  </div>
                )}
                {c.custody === "grader" && (
                  <WithdrawalRequest
                    card={c}
                    endpoint={base}
                    refresh={() => setReload((n) => n + 1)}
                  />
                )}
                {returnAvailable(c) && (
                  <label className="grading-check">
                    <input
                      type="checkbox"
                      disabled={busy || !!pending}
                      checked={selected.includes(c.card_id)}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked
                            ? [...selected, c.card_id]
                            : selected.filter((id) => id !== c.card_id),
                        );
                        setChoice(null);
                        setConfirmed(false);
                      }}
                    />
                    <span>
                      Select {c.description} · {c.card_id.slice(-8)}
                    </span>
                  </label>
                )}
              </article>
            ))}
          </div>
          {!!chosen.length && (
            <section className="panel portal-decision">
              <h2>Your selected cards ({chosen.length})</h2>
              <p>
                Only these exact cards are included. Other cards in your intake
                keep their current decisions.
              </p>
              <div className="grading-toolbar">
                <button
                  className="button"
                  disabled={busy || !!pending || !chosen.every(submissionReady)}
                  onClick={() => {
                    setChoice("submit");
                    setConfirmed(false);
                  }}
                >
                  Review submission approval
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !!pending || !chosen.every(returnAvailable)}
                  onClick={() => {
                    setChoice("return");
                    setConfirmed(false);
                  }}
                >
                  Review return request
                </button>
              </div>
              {!chosen.every(submissionReady) && (
                <p>
                  Submission approval needs a published exam, a complete
                  provider/service quote, and Northside’s Awaiting customer
                  decision status for every selected card. Unset charges are not
                  free.
                </p>
              )}
              {choice && (
                <>
                  <h3>
                    {choice === "submit"
                      ? "Approve external grading"
                      : "Request return"}{" "}
                    — review before confirming
                  </h3>
                  {chosen.map((c) => (
                    <div className="portal-review-card" key={c.card_id}>
                      <h4>{c.description}</h4>
                      <p className="fine">
                        Exact card: {c.card_id}
                        <br />
                        Exam:{" "}
                        {c.exam
                          ? `revision ${c.exam.revision} · ${c.exam.id}`
                          : "Not yet published"}
                        <br />
                        Quote:{" "}
                        {c.quote
                          ? `revision ${c.quote.revision} · ${c.quote.id}`
                          : "Not yet quoted"}
                      </p>
                      {choice === "submit" ? (
                        <QuoteSummary
                          quote={c.quote}
                          examination={c.examination_cents}
                        />
                      ) : (
                        <p>
                          Return charges, if any, require a separate quote. This
                          request does not authorize unknown fees.
                        </p>
                      )}
                    </div>
                  ))}
                  <label className="grading-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || !!pending}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>
                      {choice === "submit"
                        ? "I approve external grading for exactly these cards, their current published Northside Exams, the listed provider/service and quote revisions. Changed terms require my renewed approval."
                        : "I request the return of exactly these cards. This cancels their submission approval and does not mean a physical return is complete."}
                    </span>
                  </label>
                  <button
                    className="button"
                    disabled={busy || !confirmed}
                    onClick={decide}
                  >
                    {pending
                      ? "Retry same decision"
                      : choice === "submit"
                        ? "Confirm approval for selected cards"
                        : "Confirm return request for selected cards"}
                  </button>
                </>
              )}
            </section>
          )}
          {detail && (
            <>
              <section className="panel">
                <h2>Intake receipt</h2>
                <p>
                  Receipt {detail.receipt.id}
                  <br />
                  Received {when(detail.receipt.received_at)}
                </p>
                <ul>
                  {detail.receipt.cards.map((c) => (
                    <li key={c.card_id}>
                      {c.description} · {c.card_id} ·{" "}
                      {examMoney(c.examination_cents)} examination
                    </li>
                  ))}
                </ul>
                <p>
                  <strong>
                    Examination subtotal:{" "}
                    {examMoney(detail.receipt.examination_subtotal_cents)}
                  </strong>
                </p>
                <p>
                  {detail.receipt.voided_at
                    ? "This intake was reversed."
                    : "Received-card record; not proof of payment."}{" "}
                  External grading, shipping, insurance and other charges are
                  separate until quoted.
                </p>
                <a
                  className="button secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${api}&receipt=1`}
                >
                  Print intake receipt
                </a>
              </section>
              <section className="panel">
                <h2>Dated timeline</h2>
                <ol className="timeline">
                  {detail.events.map((e) => (
                    <li key={e.id}>
                      <div>
                        <h3>{e.label}</h3>
                        <p>{when(e.created_at)}</p>
                        <small>
                          {e.source === "customer"
                            ? "Authenticated collector decision"
                            : "Northside recorded"}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
                <h3>Exam and quote history</h3>
                {detail.exams.map((e) => (
                  <p key={e.id}>
                    Exam revision {e.revision} published {when(e.signed_at)}
                  </p>
                ))}
                {detail.quotes.map((q) => (
                  <details key={q.id}>
                    <summary>
                      Quote revision {q.revision} · {when(q.created_at)}
                    </summary>
                    <QuoteSummary
                      quote={q}
                      examination={detail.card.examination_cents}
                    />
                  </details>
                ))}
                {detail.decisions.map((d) => (
                  <p className="fine" key={d.request_id}>
                    {d.choice === "submit"
                      ? "Submission approved"
                      : "Return requested"}{" "}
                    {when(d.created_at)} · decision {d.request_id}
                    <br />
                    Exam {d.exam_revision_id ?? "not yet published"} · quote{" "}
                    {d.quote_id ?? "not yet quoted"}
                  </p>
                ))}
              </section>
            </>
          )}
          {!cardId && (
            <section className="panel">
              <h2>Link an intake receipt</h2>
              <p>
                Use the private claim code on your receipt. Northside must
                independently verify the receipt and your identity before access
                is granted.
              </p>
              <form
                className="grading-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const r = await fetch(
                      fixture
                        ? `/api/preview/grading?actor=${actor}`
                        : "/api/private/grading",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "claim-request",
                          code: claimCode,
                        }),
                      },
                    );
                    const v = await r.json();
                    if (!r.ok)
                      throw Error(String(v.error).replaceAll("_", " "));
                    setMessage(
                      "Receipt review requested. Northside will verify it before linking your cards.",
                    );
                    setClaimCode("");
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Receipt claim code
                  <input
                    required
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value)}
                  />
                </label>
                <button className="button" disabled={busy}>
                  Request receipt review
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function WithdrawalRequest({
  card,
  endpoint,
  refresh,
}: {
  card: PortalCard;
  endpoint: string;
  refresh: () => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active =
    card.withdrawal &&
    !["closed", "unable_to_withdraw"].includes(card.withdrawal.resolution);
  return (
    <section className="grading-notice">
      <h3>Request withdrawal after dispatch</h3>
      <p>
        Your card is with the grader. Northside must review the request; it does
        not cancel the shipment or promise an immediate return.
      </p>
      {card.withdrawal && (
        <p>
          Latest review: {card.withdrawal.resolution.replaceAll("_", " ")} ·{" "}
          {when(card.withdrawal.created_at)}
        </p>
      )}
      {!active && (
        <>
          <label className="grading-check">
            <input
              type="checkbox"
              checked={confirm}
              disabled={busy || !!pending}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            Ask Northside staff to review withdrawal for this card.
          </label>
          <button
            className="button secondary"
            disabled={busy || !confirm}
            onClick={async () => {
              const b = pending ?? {
                choice: "withdraw",
                card_id: card.card_id,
                version: card.version,
                confirmed: true,
                request_id: crypto.randomUUID(),
              };
              setPending(b);
              setBusy(true);
              setError("");
              try {
                const r = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(b),
                  }),
                  v = await r.json();
                if (!r.ok) throw Error(String(v.error).replaceAll("_", " "));
                setPending(null);
                setConfirm(false);
                refresh();
              } catch (e) {
                setError(
                  (e instanceof Error ? e.message : "Request unconfirmed") +
                    ". Retry uses the same request.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {pending ? "Retry withdrawal request" : "Request staff review"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
