"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  loyaltyMoney,
  type LoyaltyWallet,
  type LoyaltyRules,
  type LoyaltyRule,
  type VoucherSnapshot,
} from "@/lib/loyalty";
import type { loyaltyStaff } from "@/lib/server/loyalty-reporting";
type StaffData = Awaited<ReturnType<typeof loyaltyStaff>>;
type Post = (body: Record<string, unknown>) => Promise<boolean>;
const date = (v: string) =>
  new Date(v).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });
const number = (v: number | string) => Number(v).toLocaleString("en-US");
const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return new FormData(e.currentTarget);
};
const value = (f: FormData, k: string) => String(f.get(k) || "");
const cents = (f: FormData, k: string) => Math.round(Number(f.get(k)) * 100);
const ids = (f: FormData, k: string) =>
  value(f, k)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
function Reason({
  label = "Private reason / evidence reference",
}: {
  label?: string;
}) {
  return (
    <label>
      {label}
      <input name="reason" required maxLength={1000} />
    </label>
  );
}
function Download({ csv, name }: { csv: string; name: string }) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function LoyaltyWorkspace({
  fixture,
  staff = false,
}: {
  fixture: boolean;
  staff?: boolean;
}) {
  const [actor, setActor] = useState("a"),
    [section, setSection] = useState("overview"),
    [data, setData] = useState<{
      endpoint: string;
      body: LoyaltyWallet | StaffData;
    } | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [range, setRange] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const endpoint =
    (fixture
      ? `/api/preview/loyalty?actor=${staff ? "staff" : actor}`
      : "/api/private/loyalty?") +
    (staff ? "&staff=1" : "") +
    range;
  const load = useCallback(async () => {
    const r = await fetch(endpoint, { cache: "no-store" });
    const body = await r.json();
    if (!r.ok)
      throw Error(body.error || "Rewards are temporarily unavailable.");
    return { endpoint, body };
  }, [endpoint]);
  useEffect(() => {
    let keep = true;
    load()
      .then((r) => {
        if (keep) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (keep) setError(e.message);
      });
    return () => {
      keep = false;
    };
  }, [load]);
  const post: Post = async (body) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error || "Could not save. Try again.");
      setData(await load());
      setMessage(
        result.message ||
          (fixture ? "Saved in the local sample workspace." : "Saved."),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Temporarily unavailable.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function download() {
    setBusy(true);
    try {
      const r = await fetch(endpoint + "&export=1", { cache: "no-store" }),
        result = await r.json();
      if (!r.ok) throw Error(result.error);
      Download({ csv: result.csv, name: "northside-loyalty-cohorts.csv" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export unavailable");
    } finally {
      setBusy(false);
    }
  }
  const current = data?.endpoint === endpoint ? data.body : null;
  const w = !staff ? (current as LoyaltyWallet | null) : null,
    s = staff ? (current as StaffData | null) : null;
  return (
    <div className="loyalty-workspace">
      <div className="page-heading">
        <p className="eyebrow">
          {staff ? "NORTHSIDE OPERATIONS" : "NORTHSIDE REWARDS"}
        </p>
        <h1>{staff ? "Rewards desk" : "A little more for your collection."}</h1>
        <p>
          {staff
            ? "Review the program, protect the ledger and follow each reward exchange."
            : "Your points, your progress, and rewards for a future purchase."}
        </p>
      </div>
      {fixture ? (
        <aside className="fixture-callout">
          <strong>LOCAL SAMPLE WORKSPACE</strong>
          <p>
            Fictional points, purchases and vouchers saved on this Mac. Sample
            codes have no value and cannot be used in Shopify. These rules are
            not Joey’s actual approval.
          </p>
          {!staff && (
            <label>
              Sample account
              <select
                value={actor}
                onChange={(e) => {
                  setActor(e.target.value);
                  setMessage("");
                  setError("");
                }}
                disabled={busy}
              >
                <option value="a">Sample collector A</option>
                <option value="b">Sample collector B</option>
              </select>
            </label>
          )}
          <Link href={staff ? "/rewards" : "/staff/rewards"}>
            {staff ? "Open customer sample →" : "Open staff sample →"}
          </Link>
        </aside>
      ) : (
        <aside className="loyalty-notice">
          <strong>Program not launched</strong>
          <p>
            Earning and reward exchange remain inactive until the rules are
            approved and checkout is verified.
          </p>
        </aside>
      )}
      {message && (
        <p className="loyalty-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <div role="alert" className="loyalty-notice">
          <p>{error.replaceAll("_", " ")}</p>
          <div className="loyalty-retry-actions">
            <Link href={staff ? "/staff/login" : "/account"}>
              Open {staff ? "staff sign-in" : "account"}
            </Link>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                load()
                  .then((r) => {
                    setData(r);
                    setError("");
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Trying again…" : "Try again"}
            </button>
          </div>
        </div>
      )}
      {!current && !error && <p role="status">Loading saved rewards…</p>}
      {w && (
        <>
          {w.state === "not_enrolled" ? (
            <section className="loyalty-card">
              <h2>Join Northside Rewards</h2>
              <p>
                {fixture
                  ? "Enroll this fictional account to try a real zero-point wallet."
                  : "Choose to enroll. Eligible purchases made after enrollment can earn points once the program opens."}
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => post({ action: "enroll" })}
              >
                {fixture ? "Enroll sample account" : "Join rewards"}
              </button>
            </section>
          ) : w.balance !== null ? (
            <>
              <section className="loyalty-balance" aria-label="Points summary">
                <div>
                  <p>
                    {fixture ? "SAMPLE SPENDABLE POINTS" : "SPENDABLE POINTS"}
                  </p>
                  <strong>{number(w.spendable)}</strong>
                  <span>Points available for reward exchanges</span>
                </div>
                <dl>
                  <div>
                    <dt>Ledger balance</dt>
                    <dd>{number(w.balance)} pts</dd>
                  </div>
                  <div>
                    <dt>Processing holds</dt>
                    <dd>{number(w.held)} pts</dd>
                  </div>
                </dl>
              </section>
              {w.negative_review && (
                <p role="status" className="loyalty-notice">
                  A purchase reversal left a negative points balance. Available
                  points are zero while Northside reviews it. Your full history
                  is preserved.
                </p>
              )}
              {w.tier && (
                <section className="loyalty-card">
                  <p className="eyebrow">
                    YOUR TIER · {fixture ? "SAMPLE RULES" : "APPROVED RULES"}
                  </p>
                  <h2>{w.tier.label}</h2>
                  <p>
                    {loyaltyMoney(w.tier.qualifying_cents)} in eligible net
                    purchases during your rolling{" "}
                    {w.rule?.parameters.qualification_days}-day window.
                  </p>
                  {w.tier.next ? (
                    <>
                      <progress
                        max={w.tier.next.threshold_cents}
                        value={Math.min(
                          w.tier.qualifying_cents,
                          w.tier.next.threshold_cents,
                        )}
                        aria-label={`Progress toward ${w.tier.next.label}`}
                      />
                      <p>
                        {loyaltyMoney(
                          w.tier.next.threshold_cents - w.tier.qualifying_cents,
                        )}{" "}
                        to {w.tier.next.label}
                      </p>
                    </>
                  ) : (
                    <p>You have reached the highest configured tier.</p>
                  )}
                  <p className="small">
                    Tier progress follows eligible spending, separate from
                    available points. Returns reduce qualifying spend in the
                    original purchase period.
                  </p>
                </section>
              )}
            </>
          ) : null}
          <section>
            <h2>Available rewards</h2>
            <div className="loyalty-grid">
              {w.rewards.map((r) => (
                <article key={r.id} className="loyalty-card">
                  <p className="eyebrow">{number(r.points_cost)} POINTS</p>
                  <h3>{r.title}</h3>
                  <p>
                    {loyaltyMoney(r.value_cents)} off eligible merchandise.
                    Minimum eligible spend {loyaltyMoney(r.minimum_cents)}.
                    Expires {r.expiry_days} days after exchange.
                  </p>
                  <p className="small">
                    One use, for this account. No product or order discount
                    stacking. Points are spent when the voucher is issued.
                  </p>
                  <button
                    className="button"
                    disabled={
                      busy || w.state !== "ready" || w.spendable < r.points_cost
                    }
                    onClick={async () => {
                      if (
                        await post({
                          action: "reserve",
                          reward_id: r.id,
                          source_id: requestId,
                        })
                      )
                        setRequestId(crypto.randomUUID());
                    }}
                  >
                    {fixture ? "Exchange sample points" : "Exchange points"}
                  </button>
                </article>
              ))}
              {!w.rewards.length && <p>No active rewards are available.</p>}
            </div>
          </section>
          {w.reservations.some((r) =>
            ["held", "review"].includes(r.status),
          ) && (
            <section className="loyalty-card">
              <h2>Processing exchanges</h2>
              {w.reservations
                .filter((r) => ["held", "review"].includes(r.status))
                .map((r) => (
                  <div key={r.id} className="loyalty-row">
                    <div>
                      <strong>{r.snapshot.title}</strong>
                      <p>
                        {number(r.points)} points reserved ·{" "}
                        {date(r.created_at)}
                      </p>
                      <p className="small">
                        An uncertain response keeps these points reserved until
                        the voucher is reconciled.
                      </p>
                    </div>
                    {fixture && (
                      <div>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            post({
                              action: "sample-process",
                              reservation_id: r.id,
                            })
                          }
                        >
                          Run sample processing
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            post({
                              action: "sample-process",
                              reservation_id: r.id,
                              timeout: true,
                            })
                          }
                        >
                          Test a sample timeout
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </section>
          )}
          <section>
            <h2>Your vouchers</h2>
            {!w.vouchers.length ? (
              <p>No vouchers issued yet.</p>
            ) : (
              <div className="loyalty-grid">
                {w.vouchers.map((v) => (
                  <article key={v.id} className="loyalty-card">
                    <p className="eyebrow">
                      {v.used_orders
                        ? "PAID USAGE RECORDED"
                        : v.status === "deactivated"
                          ? "DEACTIVATED"
                          : "ISSUED · USAGE NOT YET RECORDED"}
                    </p>
                    <h3>{v.snapshot.title}</h3>
                    <code className="loyalty-code">
                      {fixture ? "SAMPLE — " : ""}
                      {v.code}
                    </code>
                    <p>
                      {loyaltyMoney(v.snapshot.value_cents)} reward · minimum{" "}
                      {loyaltyMoney(v.snapshot.minimum_cents)} in eligible
                      items. Ends {date(v.snapshot.ends_at)}.
                    </p>
                    {v.used_orders > 0 && (
                      <p>
                        {loyaltyMoney(v.used_cents)} in recorded Shopify
                        discount allocations.
                      </p>
                    )}
                    <button
                      className="button secondary"
                      disabled={fixture || busy || v.status !== "issued"}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await fetch("/api/private/loyalty/cart", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ voucher_id: v.id }),
                            }),
                            b = await r.json();
                          if (!r.ok) throw Error(b.error);
                          setMessage(
                            b.applicable
                              ? "Reward is applicable to your Shopify cart."
                              : "This cart is not currently eligible. Your voucher remains in your wallet.",
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "Cart unavailable",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {fixture
                        ? "Sample code · checkout disabled"
                        : "Apply to my cart"}
                    </button>
                    <p className="small">
                      Abandoning a cart does not return exchanged points. Usage
                      can arrive later; Northside reviews cancellations and
                      refund restoration.
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="loyalty-card">
            <h2>Points history</h2>
            <p className="small">
              Most recent 100 entries. Purchase earnings round down per eligible
              line; refunds reverse a cumulative share of the original points
              allocation.
            </p>
            {w.ledger.map((l) => (
              <div className="loyalty-row" key={l.id}>
                <div>
                  <strong>{l.reason}</strong>
                  <p className="small">
                    {date(l.created_at)} · rule {l.rule_id.slice(-8)}
                  </p>
                  <details>
                    <summary>Question this entry</summary>
                    <form
                      onSubmit={async (e) => {
                        const f = form(e);
                        await post({
                          action: "dispute",
                          entry_id: l.id,
                          reason: value(f, "reason"),
                        });
                      }}
                    >
                      <Reason label="Tell Northside what needs review" />
                      <button className="button secondary" disabled={busy}>
                        Send for review
                      </button>
                    </form>
                  </details>
                </div>
                <strong className="loyalty-points">
                  {l.points > 0 ? "+" : ""}
                  {number(l.points)} pts
                </strong>
              </div>
            ))}
            {!w.ledger.length && (
              <p>
                No points activity yet. A zero balance is shown only after
                enrollment.
              </p>
            )}
          </section>
          {w.rule && (
            <details className="loyalty-card">
              <summary>How the current rules work</summary>
              <p>
                {w.rule.parameters.points_per_dollar} points per eligible US
                dollar, after discounts and excluding tax and shipping. Only
                approved merchandise is eligible; gift cards are excluded. No
                automatic prelaunch or Square history backfill.
              </p>
              <p>
                Rule version {w.rule.version} · effective{" "}
                {date(w.rule.effective_at!)}. Points do not expire under this
                rule. Reward expiry is shown on each voucher. Refund restoration
                is reviewed individually.
              </p>
              <p>
                Eligible product IDs:{" "}
                {w.rule.parameters.eligible_products
                  .map((p) => p.id)
                  .join(", ") || "None configured"}
                .
              </p>
            </details>
          )}
        </>
      )}
      {s && (
        <>
          <nav className="loyalty-tabs" aria-label="Rewards tools">
            {[
              ["overview", "Reports"],
              ["rules", "Rule drafts"],
              ["rewards", "Rewards"],
              ["members", "Members"],
              ["review", "Review & jobs"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={section === id}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {section === "overview" && (
            <>
              <form
                className="loyalty-filter"
                onSubmit={(e) => {
                  const f = form(e);
                  setRange(
                    `&from=${encodeURIComponent(value(f, "from") + "T00:00:00Z")}&to=${encodeURIComponent(value(f, "to") + "T00:00:00Z")}` +
                      (value(f, "valuation")
                        ? `&valuation=${Number(f.get("valuation"))}`
                        : ""),
                  );
                }}
              >
                <label>
                  From (UTC)
                  <input
                    name="from"
                    type="date"
                    required
                    defaultValue={s.report.period.start.slice(0, 10)}
                  />
                </label>
                <label>
                  To, exclusive (UTC)
                  <input
                    name="to"
                    type="date"
                    required
                    defaultValue={new Date(
                      Date.parse(s.report.period.end) + 86400000,
                    )
                      .toISOString()
                      .slice(0, 10)}
                  />
                </label>
                <label>
                  Optional assumed cents per point
                  <input
                    type="number"
                    name="valuation"
                    min="0"
                    max="100"
                    step="1"
                    placeholder="No valuation"
                  />
                </label>
                <button className="button">Update report</button>
              </form>
              <div className="loyalty-grid">
                {s.report.metrics.map((m) => (
                  <article className="loyalty-card" key={m.key}>
                    <h3>{m.label}</h3>
                    <strong className="loyalty-stat">
                      {m.unit === "USD cents"
                        ? loyaltyMoney(m.value)
                        : number(m.value)}
                    </strong>
                    <p className="small">{m.definition}</p>
                    <details>
                      <summary>Period and source</summary>
                      <p className="small">
                        {m.period}
                        <br />
                        {m.source}
                      </p>
                    </details>
                  </article>
                ))}
              </div>
              <section className="loyalty-card">
                <h2>Tier distribution</h2>
                <p>
                  Current snapshot · {date(s.report.tier_as_of)} · rule version{" "}
                  {s.report.tier_rule_version || "unapproved"}
                </p>
                <div className="loyalty-tiers">
                  {Object.entries(s.report.tiers).map(([tier, n]) => (
                    <p key={tier}>
                      <strong>{tier}</strong>
                      <br />
                      {number(n)} members
                    </p>
                  ))}
                </div>
              </section>
              {s.report.exposure && (
                <section className="loyalty-card">
                  <h2>Estimated exposure scenario</h2>
                  <strong>{loyaltyMoney(s.report.exposure.cents)}</strong>
                  <p>
                    Assumption: {s.report.exposure.cents_per_point} cents per
                    point.
                  </p>
                  <p>{s.report.exposure.definition}</p>
                </section>
              )}
              <section className="loyalty-card">
                <h2>Ledger reconciliation</h2>
                <p>
                  {s.report.reconciliation.accounts_checked} accounts checked ·{" "}
                  {s.report.reconciliation.issues.length} consistency issues ·{" "}
                  {s.report.reconciliation.negative_accounts} negative accounts
                </p>
                <p>{s.report.reconciliation.provider_verification}</p>
                {s.report.reconciliation.issues.map((i) => (
                  <p key={i.id}>
                    {i.kind} · {i.id}
                  </p>
                ))}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={download}
                >
                  Export aggregate cohort CSV
                </button>
                <p className="small">
                  Small customer cohorts are suppressed. No personal records or
                  consignment data. Comparisons do not establish incremental
                  sales; no live Marketing Hub connection is claimed.
                </p>
              </section>
            </>
          )}
          {section === "rules" && (
            <>
              <RuleDraft
                latest={s.rules[0]}
                post={post}
                busy={busy}
                canEdit={["owner", "admin"].includes(s.role || "")}
              />
              {s.rules.map((r) => (
                <article className="loyalty-card" key={r.id}>
                  <h3>
                    Version {r.version} ·{" "}
                    {r.approved_by ? "Approved version" : "Inactive draft"}
                    {r.fixture ? " · SAMPLE" : ""}
                  </h3>
                  <p>
                    {r.parameters.points_per_dollar} points / dollar · rolling{" "}
                    {r.parameters.qualification_days} days ·{" "}
                    {r.parameters.tiers
                      .map(
                        (t) => `${t.label}: ${loyaltyMoney(t.threshold_cents)}`,
                      )
                      .join(" · ")}
                  </p>
                  {r.effective_at && (
                    <p>
                      Effective {date(r.effective_at)} · approver record{" "}
                      {r.approved_by?.slice(-8)}
                    </p>
                  )}
                  {!r.approved_by &&
                    ["owner", "admin"].includes(s.role || "") && (
                      <form
                        onSubmit={(e) => {
                          const f = form(e);
                          void post({
                            action: "rule-approve",
                            rule_id: r.id,
                            effective_at: new Date(
                              value(f, "effective"),
                            ).toISOString(),
                            confirmed: f.get("confirmed") === "on",
                            reason: value(f, "reason"),
                          });
                        }}
                      >
                        <label>
                          Effective date and time
                          <input
                            type="datetime-local"
                            name="effective"
                            required
                          />
                        </label>
                        <Reason />
                        <label className="loyalty-check">
                          <input type="checkbox" name="confirmed" required />
                          {fixture
                            ? "I am activating fictional sample economics only."
                            : "Joey has approved this exact version and its effective date."}
                        </label>
                        <button className="button secondary" disabled={busy}>
                          {fixture
                            ? "Create approved SAMPLE version"
                            : "Record approved version"}
                        </button>
                      </form>
                    )}
                  <p className="small">
                    Approval records a new immutable version. Public earning and
                    exchange remain disabled in this build.
                  </p>
                </article>
              ))}
            </>
          )}
          {section === "rewards" && (
            <>
              <RewardDraft
                rules={s.rules}
                post={post}
                busy={busy}
                canEdit={["owner", "admin"].includes(s.role || "")}
              />
              {s.rewards.map((r) => (
                <article key={r.id} className="loyalty-card">
                  <h3>{r.terms.title}</h3>
                  <p>
                    {number(r.points_cost)} points →{" "}
                    {loyaltyMoney(r.value_cents)} · minimum{" "}
                    {loyaltyMoney(r.terms.minimum_cents)} ·{" "}
                    {r.active ? "Enabled definition" : "Suspended / draft"}
                  </p>
                  {["owner", "admin"].includes(s.role || "") && (
                    <form
                      onSubmit={(e) => {
                        const f = form(e);
                        void post({
                          action: "reward-active",
                          reward_id: r.id,
                          active: !r.active,
                          reason: value(f, "reason"),
                        });
                      }}
                    >
                      <Reason />
                      <button className="button secondary" disabled={busy}>
                        {r.active
                          ? "Suspend reward"
                          : fixture
                            ? "Approve SAMPLE reward"
                            : "Approve reward definition"}
                      </button>
                    </form>
                  )}
                </article>
              ))}
            </>
          )}
          {section === "members" && (
            <>
              <p>
                Up to 500 enrolled accounts. Tier qualification is independent
                of spendable points.
              </p>
              {s.accounts.map((a) => (
                <article className="loyalty-card" key={a.id}>
                  <h3>{a.display_name}</h3>
                  <p>
                    {number(a.cached_points)} ledger points · enrolled{" "}
                    {date(a.enrolled_at)}
                  </p>
                  <p className="small">Customer reference {a.customer_id}</p>
                  {["owner", "admin"].includes(s.role || "") && (
                    <Adjustment
                      customer={a.customer_id}
                      post={post}
                      busy={busy}
                    />
                  )}
                </article>
              ))}
            </>
          )}
          {section === "review" && (
            <>
              {fixture && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => post({ action: "sample-process" })}
                >
                  Run due sample jobs
                </button>
              )}
              <h2>Jobs awaiting attention</h2>
              {!s.jobs.length && <p>No pending jobs.</p>}
              {s.jobs.map((j) => (
                <article key={j.id} className="loyalty-card">
                  <h3>
                    {j.kind} · {j.state}
                  </h3>
                  <p>
                    Attempts {j.attempts} ·{" "}
                    {j.last_error?.replaceAll("_", " ") ||
                      "Waiting for processing"}
                  </p>
                  <p className="small">{j.object_id}</p>
                  {["failed", "review"].includes(j.state) &&
                    ["owner", "admin"].includes(s.role || "") && (
                      <form
                        onSubmit={(e) => {
                          const f = form(e);
                          void post({
                            action: "job-retry",
                            job_id: j.id,
                            reason: value(f, "reason"),
                          });
                        }}
                      >
                        <Reason />
                        <button className="button secondary" disabled={busy}>
                          Queue one reviewed retry
                        </button>
                      </form>
                    )}
                </article>
              ))}
              <h2>Review queue</h2>
              {!s.reviews.length && <p>No review entries.</p>}
              {s.reviews.map((r) => (
                <article className="loyalty-card" key={r.id}>
                  <h3>
                    {r.kind.replaceAll("_", " ")} · {r.state}
                  </h3>
                  <p>{r.details}</p>
                  <p className="small">
                    {r.object_id} · {date(r.created_at)}
                  </p>
                  {r.state === "open" &&
                    ["owner", "admin"].includes(s.role || "") && (
                      <form
                        onSubmit={(e) => {
                          const f = form(e);
                          void post({
                            action: "review-resolve",
                            review_id: r.id,
                            reason: value(f, "reason"),
                            rejected: f.get("rejected") === "on",
                          });
                        }}
                      >
                        <Reason />
                        <label className="loyalty-check">
                          <input name="rejected" type="checkbox" />
                          Reject the request
                        </label>
                        <button className="button secondary" disabled={busy}>
                          Record review outcome
                        </button>
                        <p className="small">
                          This does not alter the ledger or bypass a pending
                          provider check.
                        </p>
                      </form>
                    )}
                </article>
              ))}
              <h2>Voucher reconciliation</h2>
              {s.vouchers.map((v) => (
                <VoucherReview
                  key={v.id}
                  voucher={{ ...v, snapshot: v.snapshot as VoucherSnapshot }}
                  post={post}
                  busy={busy}
                  canEdit={["owner", "admin"].includes(s.role || "")}
                />
              ))}
              <details className="loyalty-card">
                <summary>Recheck a recorded Shopify order</summary>
                <form
                  onSubmit={(e) => {
                    const f = form(e);
                    void post({
                      action: "order-recheck",
                      order_id: value(f, "order_id"),
                      reason: value(f, "reason"),
                    });
                  }}
                >
                  <label>
                    Recorded Shopify order ID
                    <input name="order_id" required />
                  </label>
                  <Reason />
                  <button className="button secondary" disabled={busy}>
                    Queue provider recheck
                  </button>
                </form>
                <p className="small">
                  Local samples do not fetch real Shopify orders. Original
                  eligibility and enrollment dates still apply.
                </p>
              </details>
            </>
          )}
        </>
      )}
      <p className="loyalty-footnote">
        Points are not cash or consignment proceeds. Reward QR scanning and
        in-store redemption remain disabled. No paid loyalty plugin is used.
      </p>
    </div>
  );
}
function RuleDraft({
  latest,
  post,
  busy,
  canEdit,
}: {
  latest?: LoyaltyRule;
  post: Post;
  busy: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return null;
  const p = latest?.parameters;
  return (
    <section className="loyalty-card">
      <h2>Create an inactive rule draft</h2>
      <form
        onSubmit={async (e) => {
          const f = form(e);
          const kinds = ["retail", "grading", "consignment", "break"] as const;
          const parameters: LoyaltyRules = {
            points_per_dollar: Number(f.get("rate")),
            qualification_days: Number(f.get("days")),
            tiers: [0, 1, 2, 3].map((i) => ({
              label: value(f, `label${i}`),
              threshold_cents: cents(f, `tier${i}`),
            })),
            eligible_products: kinds.flatMap((kind) =>
              ids(f, kind).map((id) => ({ id, kind })),
            ),
            approved_service_kinds: (
              ["grading", "consignment", "break"] as const
            ).filter((k) => f.get("include_" + k) === "on"),
            excluded_product_ids: ids(f, "excluded"),
            points_expiry: "none",
            rounding: "floor_per_line_cumulative",
            tier_returns: "reduce_original_period",
            refund_restoration: "manual_review",
          };
          await post({
            action: "rule-draft",
            parameters,
            reason: value(f, "reason"),
          });
        }}
      >
        <div className="loyalty-form-grid">
          <label>
            Points per eligible dollar
            <input
              name="rate"
              type="number"
              min="1"
              max="1000"
              required
              defaultValue={p?.points_per_dollar}
            />
          </label>
          <label>
            Rolling qualification days
            <input
              name="days"
              type="number"
              min="1"
              max="3650"
              required
              defaultValue={p?.qualification_days}
            />
          </label>
          {["Rookie", "Vet", "HOF", "GOAT"].map((label, i) => (
            <div key={i}>
              <label>
                Tier {i + 1} label
                <input
                  name={`label${i}`}
                  required
                  defaultValue={p?.tiers[i]?.label || label}
                />
              </label>
              <label>
                Qualifying spend (USD)
                <input
                  name={`tier${i}`}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={(p?.tiers[i]?.threshold_cents || 0) / 100}
                />
              </label>
            </div>
          ))}
        </div>
        <details>
          <summary>Eligible products and exclusions</summary>
          <p>
            Use exact Shopify product IDs, one per line. Unknown merchandise
            does not earn points. Each service category needs explicit approval.
          </p>
          {(["retail", "grading", "consignment", "break"] as const).map((k) => (
            <div key={k}>
              <label>
                {k} product IDs
                <textarea
                  name={k}
                  rows={2}
                  defaultValue={p?.eligible_products
                    .filter((x) => x.kind === k)
                    .map((x) => x.id)
                    .join("\n")}
                />
              </label>
              {k !== "retail" && (
                <label className="loyalty-check">
                  <input
                    type="checkbox"
                    name={"include_" + k}
                    defaultChecked={p?.approved_service_kinds.includes(k)}
                  />
                  Explicitly include {k} in this draft
                </label>
              )}
            </div>
          ))}
          <label>
            Excluded product IDs
            <textarea
              name="excluded"
              rows={2}
              defaultValue={p?.excluded_product_ids.join("\n")}
            />
          </label>
        </details>
        <p className="small">
          Implemented policy: points do not expire; refunds reduce the original
          qualifying spend; reward-point restoration requires manual review. New
          policy types require implementation and verification.
        </p>
        <Reason />
        <button className="button" disabled={busy}>
          Save new draft version
        </button>
      </form>
    </section>
  );
}
function RewardDraft({
  rules,
  post,
  busy,
  canEdit,
}: {
  rules: LoyaltyRule[];
  post: Post;
  busy: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return null;
  return (
    <section className="loyalty-card">
      <h2>Create a fixed amount reward draft</h2>
      <form
        onSubmit={(e) => {
          const f = form(e);
          void post({
            action: "reward-create",
            rule_id: value(f, "rule"),
            points_cost: Number(f.get("points")),
            value_cents: cents(f, "amount"),
            terms: {
              title: value(f, "title"),
              minimum_cents: cents(f, "minimum"),
              product_ids: ids(f, "products"),
              collection_ids: ids(f, "collections"),
              expiry_days: Number(f.get("expiry")),
              combines: {
                orderDiscounts: false,
                productDiscounts: false,
                shippingDiscounts: f.get("shipping") === "on",
              },
            },
            reason: value(f, "reason"),
          });
        }}
      >
        <label>
          Rule version
          <select name="rule" required>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                Version {r.version} · {r.approved_by ? "Approved" : "Draft"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reward name
          <input name="title" required maxLength={100} />
        </label>
        <div className="loyalty-form-grid">
          <label>
            Points cost
            <input name="points" type="number" min="1" required />
          </label>
          <label>
            Fixed value (USD)
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label>
            Minimum eligible spend (USD)
            <input
              name="minimum"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label>
            Expiry after exchange (days)
            <input name="expiry" type="number" min="1" max="365" required />
          </label>
        </div>
        <label>
          Eligible product IDs
          <textarea name="products" rows={2} />
        </label>
        <label>
          Or eligible collection IDs
          <textarea name="collections" rows={2} />
        </label>
        <label className="loyalty-check">
          <input name="shipping" type="checkbox" />
          Allow shipping discount combinations
        </label>
        <p className="small">
          Choose products or collections. Minimum spend must cover the whole
          reward. Product/order stacking remains unsupported; other checkout
          modes require external verification.
        </p>
        <Reason />
        <button className="button" disabled={busy}>
          Save inactive reward
        </button>
      </form>
    </section>
  );
}
function Adjustment({
  customer,
  post,
  busy,
}: {
  customer: string;
  post: Post;
  busy: boolean;
}) {
  const [id, setId] = useState(() => crypto.randomUUID());
  return (
    <details>
      <summary>Reasoned points correction</summary>
      <form
        onSubmit={async (e) => {
          const f = form(e);
          if (
            await post({
              action: "adjust",
              customer_id: customer,
              points: Number(f.get("points")),
              source_id: id,
              reason: value(f, "reason"),
            })
          )
            setId(crypto.randomUUID());
        }}
      >
        <label>
          Signed points adjustment
          <input
            type="number"
            name="points"
            min="-1000000"
            max="1000000"
            required
          />
        </label>
        <Reason />
        <button className="button secondary" disabled={busy}>
          Append correction
        </button>
      </form>
    </details>
  );
}
function VoucherReview({
  voucher: v,
  post,
  busy,
  canEdit,
}: {
  voucher: {
    id: string;
    customer_id: string;
    status: string;
    snapshot: VoucherSnapshot;
  };
  post: Post;
  busy: boolean;
  canEdit: boolean;
}) {
  const [id, setId] = useState(() => crypto.randomUUID());
  return (
    <article className="loyalty-card">
      <h3>
        {v.snapshot.title} · {v.status}
      </h3>
      <p className="small">
        Voucher {v.id}
        <br />
        Customer {v.customer_id}
      </p>
      {canEdit && (
        <>
          <form
            onSubmit={(e) => {
              const f = form(e);
              void post({
                action: "deactivate",
                voucher_id: v.id,
                reason: value(f, "reason"),
              });
            }}
          >
            <Reason />
            <button
              className="button secondary"
              disabled={busy || v.status === "deactivated"}
            >
              Request confirmed deactivation
            </button>
          </form>
          <details>
            <summary>Review points restoration</summary>
            <form
              onSubmit={async (e) => {
                const f = form(e);
                if (
                  await post({
                    action: "restore",
                    voucher_id: v.id,
                    points: Number(f.get("points")),
                    source_id: id,
                    kind: value(f, "kind"),
                    reason: value(f, "reason"),
                    clearance_reference: value(f, "clearance"),
                    confirmed: f.get("confirmed") === "on",
                  })
                )
                  setId(crypto.randomUUID());
              }}
            >
              <label>
                Restoration reason
                <select name="kind">
                  <option value="used_reward_refund">
                    Used reward after verified refund
                  </option>
                  <option value="unused_cancelled">
                    Unused, confirmed cancelled voucher
                  </option>
                </select>
              </label>
              <label>
                Points to restore (maximum original {v.snapshot.points_cost})
                <input
                  type="number"
                  name="points"
                  min="1"
                  max={v.snapshot.points_cost}
                  required
                />
              </label>
              <Reason />
              <label>
                Pending / paid checkout reconciliation reference
                <input name="clearance" />
              </label>
              <label className="loyalty-check">
                <input name="confirmed" type="checkbox" required />I verified
                the original exchange, refund or deactivation, pending checkouts
                and paid usage. No unresolved race remains.
              </label>
              <button className="button secondary" disabled={busy}>
                Append reviewed restoration
              </button>
            </form>
            <p className="small">
              The original redemption cap includes previous restorations. An
              unresolved race stays in review. This is separate from reversing
              purchase earnings.
            </p>
          </details>
        </>
      )}
    </article>
  );
}
