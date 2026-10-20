"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  breakTime,
  countdown,
  chicagoLocal,
  chicagoToUtc,
  breakStatuses,
  type BreakEvent,
  type PublicBreak,
} from "@/lib/breaks";
import { publicFlags } from "@/lib/policy.mjs";
import type { staffBreaks, myBreaks } from "@/lib/server/breaks";
type Staff = Awaited<ReturnType<typeof staffBreaks>>;
type Mine = Awaited<ReturnType<typeof myBreaks>>;
type Post = (body: Record<string, unknown>) => Promise<boolean>;
const value = (f: FormData, k: string) => String(f.get(k) || "");
const number = (f: FormData, k: string) => Number(f.get(k));
const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return new FormData(e.currentTarget);
};
const money = (v: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(v) / 100,
  );
const friendlyError = (message: string) =>
  ({
    database_not_configured:
      "The break schedule isn’t connected yet. Please check back soon.",
    sign_in_required: "Sign in to continue.",
    session_expired: "Your session has ended. Sign in again.",
    staff_permission_required:
      "Your staff account doesn’t have permission for this action.",
    reason_or_value_required:
      "Complete the required fields and add a reason before saving.",
  })[message] || message.replaceAll("_", " ");
const labels = {
  format_and_terms: "Selling format, named spots and customer terms confirmed",
  physical_fulfillment: "Physical card shipping and fulfillment confirmed",
  separate_inventory_pools:
    "Retail, breaker and excess inventory pools reconciled separately",
  legacy_reconciled:
    "All external paid spots recorded and excluded from Shopify sale inventory",
  concurrent_checkout_test:
    "Two competing Shopify checkouts tested against the last spot",
};
function Reason() {
  return (
    <label>
      Private reason / evidence reference
      <input name="reason" required maxLength={1000} />
    </label>
  );
}
function TimeLabel({ event }: { event: BreakEvent }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <p>{breakTime(event.starts_at)}</p>
      <p className="small">
        {event.status === "live"
          ? "Live status recorded by staff"
          : event.status === "complete"
            ? "This break is complete"
            : event.status === "canceled"
              ? "This break is canceled"
              : now
                ? countdown(event.starts_at, now)
                : "Schedule recorded by staff"}
      </p>
    </>
  );
}
const publicEndpoint = (fixture: boolean, id?: string) =>
  (fixture ? "/api/preview/breaks?public=1" : "/api/breaks?") +
  (id ? "&id=" + encodeURIComponent(id) : "");
export function NextBreak({ fixture }: { fixture: boolean }) {
  const [state, setState] = useState<{
    event: PublicBreak | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    let keep = true;
    fetch(publicEndpoint(fixture), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((body) => {
        if (keep)
          setState({
            event:
              body.events.find((e: PublicBreak) =>
                ["scheduled", "delayed", "live"].includes(e.status),
              ) || null,
            error: false,
          });
      })
      .catch(() => {
        if (keep) setState({ event: null, error: true });
      });
    return () => {
      keep = false;
    };
  }, [fixture]);
  return (
    <div className="break-feature">
      <p className="eyebrow">
        NEXT AT THE BREAK TABLE{fixture ? " · SAMPLE" : ""}
      </p>
      <h2>{state?.event?.title || "See what’s coming."}</h2>
      {state?.event ? (
        <>
          <span className="badge">{state.event.status}</span>
          <TimeLabel event={state.event} />
        </>
      ) : (
        <p>
          {!state
            ? "Loading the schedule…"
            : state.error
              ? "The schedule is temporarily unavailable."
              : "No confirmed upcoming breaks yet."}
        </p>
      )}
      <Link href={state?.event ? "/breaks/" + state.event.id : "/breaks"}>
        Explore breaks →
      </Link>
    </div>
  );
}
export function BreakWorkspace({
  fixture,
  staff = false,
  id,
  personal = false,
}: {
  fixture: boolean;
  staff?: boolean;
  id?: string;
  personal?: boolean;
}) {
  const [actor, setActor] = useState("a"),
    [state, setState] = useState<{
      key: string;
      events: PublicBreak[];
      staff: Staff | null;
    } | null>(null),
    [mine, setMine] = useState<{ key: string; body: Mine } | null>(null),
    [error, setError] = useState(""),
    [privateError, setPrivateError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const endpoint =
    (fixture
      ? `/api/preview/breaks?actor=${staff ? "staff" : actor}`
      : "/api/private/breaks?") + (staff ? "&staff=1" : "");
  const key = `${fixture}/${staff}/${id || ""}`;
  const load = useCallback(async () => {
    const r = await fetch(staff ? endpoint : publicEndpoint(fixture, id), {
        cache: "no-store",
      }),
      b = await r.json();
    if (!r.ok) throw Error(b.error || "Schedule temporarily unavailable");
    return { key, events: staff ? [] : b.events, staff: staff ? b : null };
  }, [endpoint, fixture, id, key, staff]);
  const loadMine = useCallback(async () => {
    const r = await fetch(endpoint, { cache: "no-store" }),
      b = await r.json();
    if (!r.ok) throw Error(b.error || "Sign in to view saved breaks");
    return { key: endpoint, body: b };
  }, [endpoint]);
  useEffect(() => {
    let keep = true;
    load()
      .then((x) => {
        if (keep) {
          setState(x);
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
  useEffect(() => {
    if (staff) return;
    let keep = true;
    loadMine()
      .then((x) => {
        if (keep) {
          setMine(x);
          setPrivateError("");
        }
      })
      .catch((e) => {
        if (keep) setPrivateError(e.message);
      });
    return () => {
      keep = false;
    };
  }, [loadMine, staff]);
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
        b = await r.json();
      if (!r.ok) throw Error(b.error || "Could not save");
      setState(await load());
      if (!staff) {
        setMine(await loadMine());
        setPrivateError("");
      }
      setMessage(
        b.message ||
          (b.state === "review"
            ? "Saved for staff review. No conflicting spot was granted."
            : fixture
              ? "Saved in this local sample workspace."
              : "Saved."),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Temporarily unavailable");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const current = state?.key === key ? state : null,
    own = mine?.key === endpoint ? mine.body : null;
  return (
    <div className="loyalty-workspace break-workspace">
      <div className="page-heading">
        <p className="eyebrow">
          {staff ? "NORTHSIDE OPERATIONS" : "THE BREAK TABLE"}
        </p>
        <h1>
          {staff
            ? "Break desk"
            : personal
              ? "My breaks"
              : id
                ? current?.events[0]?.title || "Break details"
                : "Be part of the next break."}
        </h1>
        <p>
          {staff
            ? "Manage the schedule, map paid spots and review every exception."
            : "Follow the schedule, save a reminder and keep track of your purchased spots."}
        </p>
      </div>
      {fixture && (
        <aside className="fixture-callout">
          <strong>LOCAL SAMPLE WORKSPACE</strong>
          <p>
            Fictional dates, products and purchases saved on this Mac. No real
            event, payment or Shopify inventory change is represented.
          </p>
          {!staff && (
            <label>
              Sample account
              <select
                value={actor}
                disabled={busy}
                onChange={(e) => {
                  setActor(e.target.value);
                  setMessage("");
                  setPrivateError("");
                }}
              >
                <option value="a">Sample collector A</option>
                <option value="b">Sample collector B</option>
              </select>
            </label>
          )}
          <Link href={staff ? "/breaks" : "/staff/breaks"}>
            {staff ? "Open customer sample →" : "Open staff sample →"}
          </Link>
        </aside>
      )}
      <nav className="actions">
        <Link href="/breaks">Schedule</Link>
        <Link href="/account/breaks">My breaks & reminders</Link>
        {staff && <Link href="/staff">Staff home</Link>}
      </nav>
      {message && (
        <p className="loyalty-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <div className="loyalty-notice" role="alert">
          <p>{friendlyError(error)}</p>
          <button
            className="button secondary"
            onClick={() =>
              load()
                .then((x) => {
                  setState(x);
                  setError("");
                })
                .catch((e) => setError(e.message))
            }
          >
            Reload schedule
          </button>
        </div>
      )}
      {!current && !error && <p role="status">Loading saved breaks…</p>}
      {current?.staff && (
        <StaffDesk
          data={current.staff}
          fixture={fixture}
          busy={busy}
          post={post}
        />
      )}
      {!staff && current && (
        <>
          {!personal &&
            (!current.events.length ? (
              <div className="empty">
                <h2>{id ? "Break unavailable" : "No confirmed breaks yet"}</h2>
                <p>
                  {id
                    ? "This break may be unpublished. Your saved purchases remain in My breaks."
                    : "The next event will appear when Northside publishes its schedule."}
                </p>
              </div>
            ) : (
              <>
                <div className={id ? "" : "break-list"}>
                  {current.events.map((e) => (
                    <BreakCard
                      key={e.id}
                      event={e}
                      detail={!!id}
                      fixture={fixture}
                      mine={own}
                      post={post}
                      busy={busy}
                    />
                  ))}
                </div>
              </>
            ))}
          {(personal || id) && (
            <MyBreaks data={own} error={privateError} post={post} busy={busy} />
          )}
        </>
      )}
      <p className="loyalty-footnote">
        Purchases remain disabled pending live Shopify verification. Carts do
        not reserve spots. Reminders appear in this app only; email and push
        delivery are planned for a later stage.
      </p>
    </div>
  );
}
function BreakCard({
  event: e,
  detail,
  fixture,
  mine,
  post,
  busy,
}: {
  event: PublicBreak;
  detail: boolean;
  fixture: boolean;
  mine: Mine | null;
  post: Post;
  busy: boolean;
}) {
  const pref = mine?.preferences.find((p) => p.event_id === e.id),
    reminder = mine?.reminders.find((r) => r.event_id === e.id);
  const ended = ["complete", "canceled"].includes(e.status);
  const [cartMessage, setCartMessage] = useState("");
  return (
    <article className="loyalty-card break-card">
      {e.image_url && (
        <Image
          src={e.image_url}
          alt={fixture ? "Sample card break illustration" : "Break event image"}
          width={800}
          height={400}
          unoptimized
          className="break-image"
        />
      )}
      <span className="badge">
        {e.status}
        {fixture ? " · sample" : ""}
      </span>
      {!detail && (
        <h2>
          <Link href={"/breaks/" + e.id}>{e.title}</Link>
        </h2>
      )}
      <TimeLabel event={e} />
      <p>Hosted by {e.host || "Northside — host to be confirmed"}</p>
      <p>{e.description}</p>
      {!detail ? (
        <Link className="button" href={"/breaks/" + e.id}>
          View break →
        </Link>
      ) : (
        <>
          <h2>At the table</h2>
          <ul>
            {e.products.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <p>
            Format:{" "}
            {e.format === "named"
              ? "Named exclusive spots"
              : e.format === "identical"
                ? "Identical pooled spots"
                : "To be confirmed"}{" "}
            · Capacity: {e.capacity ?? "Unconfirmed"}
          </p>
          <h3>Break terms</h3>
          <p className="break-copy">
            {e.terms || "Terms must be confirmed before any sale."}
          </p>
          <div className="actions">
            {e.stream_url ? (
              <a
                className="button"
                href={e.stream_url}
                target="_blank"
                rel="noreferrer"
              >
                {e.status === "live"
                  ? "Watch live on stream provider"
                  : "Open stream destination"}{" "}
                ↗
              </a>
            ) : (
              <button disabled className="button secondary">
                Watch link unconfirmed
              </button>
            )}
            {e.replay_url && (
              <a
                className="button secondary"
                href={e.replay_url}
                target="_blank"
                rel="noreferrer"
              >
                Watch replay ↗
              </a>
            )}
            {e.starts_at ? (
              <a
                className="button secondary"
                href={publicEndpoint(fixture, e.id) + "&calendar=1"}
              >
                Add to calendar (.ics)
              </a>
            ) : (
              <button disabled className="button secondary">
                Calendar date unconfirmed
              </button>
            )}
          </div>
          <p className="small">
            Calendar downloads contain the saved schedule. Download again after
            a time change; they are not a live calendar subscription.
          </p>
          <h2>Spots</h2>
          {!e.spots.length && <p>Spot details are being confirmed.</p>}
          {e.spots.map((s) => (
            <div className="loyalty-row" key={s.id}>
              <div>
                <h3>{s.spot_key}</h3>
                <p>
                  {s.occupied} of {s.capacity} held ·{" "}
                  {Math.max(0, s.capacity - s.occupied)} remaining in app
                  records
                </p>
              </div>
              <button
                className="button"
                disabled={
                  fixture ||
                  !publicFlags.purchases ||
                  !e.sale_open ||
                  ended ||
                  s.occupied >= s.capacity ||
                  busy
                }
                onClick={async () => {
                  try {
                    const r = await fetch("/api/private/breaks/cart", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mapping_id: s.id, quantity: 1 }),
                      }),
                      b = await r.json();
                    if (!r.ok) throw Error(b.error);
                    setCartMessage(
                      "Added to cart. Checkout must complete before a spot is yours.",
                    );
                  } catch (err) {
                    setCartMessage(
                      err instanceof Error ? err.message : "Cart unavailable",
                    );
                  }
                }}
              >
                {s.occupied >= s.capacity
                  ? "Sold out / held"
                  : !publicFlags.purchases || fixture
                    ? "Spot purchases disabled"
                    : "Add one spot to cart"}
              </button>
            </div>
          ))}
          {cartMessage && (
            <p role="status">
              {cartMessage.replaceAll("_", " ")}{" "}
              <Link href="/cart">Open cart</Link>
            </p>
          )}
          <p className="small">
            Shopify confirms availability at checkout. An expired or failed
            checkout grants no spot. Refunded capacity remains held until staff
            reviews it.
          </p>
          <h2>Follow this break</h2>
          {mine ? (
            <>
              <form
                onSubmit={async (ev) => {
                  const f = form(ev);
                  await post({
                    action: "reminder",
                    event_id: e.id,
                    lead_minutes: number(f, "lead"),
                    active: true,
                  });
                }}
              >
                <label>
                  In-app reminder
                  <select
                    name="lead"
                    defaultValue={String(reminder?.lead_minutes ?? 15)}
                  >
                    <option value="0">At scheduled start</option>
                    <option value="5">5 minutes before</option>
                    <option value="15">15 minutes before</option>
                    <option value="30">30 minutes before</option>
                    <option value="60">1 hour before</option>
                    <option value="1440">1 day before</option>
                  </select>
                </label>
                <button className="button" disabled={busy || ended}>
                  {reminder?.active ? "Update saved reminder" : "Save reminder"}
                </button>
              </form>
              <form
                key={`${pref?.display_name}/${pref?.consented}`}
                onSubmit={async (ev) => {
                  const f = form(ev);
                  await post({
                    action: "alias",
                    event_id: e.id,
                    display_name: value(f, "alias"),
                    consented: f.has("consent"),
                  });
                }}
              >
                <label>
                  Public display name (optional)
                  <input
                    name="alias"
                    maxLength={60}
                    defaultValue={String(pref?.display_name || "")}
                    required
                  />
                </label>
                <label className="loyalty-check">
                  <input
                    name="consent"
                    type="checkbox"
                    defaultChecked={pref?.consented === true}
                  />
                  I agree to show this name beside my confirmed spots. My
                  account name and email stay private.
                </label>
                <button className="button secondary" disabled={busy}>
                  Save display preference
                </button>
              </form>
            </>
          ) : (
            <p>
              <Link href="/account">Sign in</Link> to save a reminder or choose
              a public participant name.
            </p>
          )}
          <h3>Participants who chose to be shown</h3>
          {e.participants.length ? (
            <ul>
              {e.participants.map((p, i) => (
                <li key={i}>
                  {p.display_name} · {p.spot_key} ({p.quantity})
                </li>
              ))}
            </ul>
          ) : (
            <p>No participant names shared.</p>
          )}
        </>
      )}
    </article>
  );
}
function MyBreaks({
  data,
  error,
  post,
  busy,
}: {
  data: Mine | null;
  error: string;
  post: Post;
  busy: boolean;
}) {
  return (
    <section className="loyalty-card">
      <h2>My saved breaks</h2>
      {!data ? (
        <p>
          {error
            ? "Sign in to see your own reminders and purchased spots."
            : "Loading your saved breaks…"}{" "}
          <Link href="/account">Open account</Link>
        </p>
      ) : (
        <>
          <p>{data.delivery}</p>
          <h3>Reminders</h3>
          {!data.reminders.length && (
            <p>No reminders saved yet. Open a break to save one.</p>
          )}
          {data.reminders.map((r) => (
            <div className="loyalty-row" key={String(r.event_id)}>
              <div>
                <h3>
                  <Link href={"/breaks/" + r.event_id}>{String(r.title)}</Link>
                </h3>
                <p>
                  {String(r.status)} · {r.active ? "Saved" : "Off"}
                  {r.published ? "" : " · Unpublished"}
                </p>
                <p>
                  {r.scheduled_for
                    ? breakTime(String(r.scheduled_for))
                    : "Waiting for a confirmed date"}
                </p>
                <p className="small">
                  {["complete", "canceled"].includes(String(r.status))
                    ? "No reminder due for this event."
                    : "Time follows the latest saved schedule."}
                </p>
              </div>
              {r.active === true && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    post({
                      action: "reminder",
                      event_id: r.event_id,
                      lead_minutes: r.lead_minutes,
                      active: false,
                    })
                  }
                >
                  Turn reminder off
                </button>
              )}
            </div>
          ))}
          <details>
            <summary>My participant display permissions</summary>
            {!data.preferences.length && <p>No display permissions saved.</p>}
            {data.preferences.map((pref) => (
              <div className="loyalty-row" key={String(pref.event_id)}>
                <p>
                  {String(pref.display_name)} ·{" "}
                  {pref.consented ? "Sharing permitted" : "Private"}
                </p>
                {pref.consented === true && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      post({
                        action: "alias",
                        event_id: pref.event_id,
                        display_name: pref.display_name,
                        consented: false,
                      })
                    }
                  >
                    Withdraw display permission
                  </button>
                )}
              </div>
            ))}
          </details>
          <h3>Purchased spots</h3>
          {!data.purchases.length && (
            <p>
              No purchased spots in this account. A cart or checkout return does
              not count as a purchase.
            </p>
          )}
          {data.purchases.map((p) => (
            <article className="loyalty-row" key={String(p.id)}>
              <div>
                <h3>
                  {String(p.title)} · {String(p.spot_key)}
                </h3>
                <span className="badge">
                  {String(p.status).replaceAll("_", " ")}
                </span>
                <p>
                  {p.source === "legacy"
                    ? "External paid record · recorded by staff"
                    : "Shopify paid order · reconciled"}{" "}
                  · {money(p.amount_cents)} original line amount
                </p>
                <p>
                  {String(p.current_quantity)}{" "}
                  {p.status === "review"
                    ? "paid-line units under review"
                    : "current spots"}{" "}
                  · {String(p.held_slots)} capacity held · Event{" "}
                  {String(p.event_status)}
                </p>
                <p className="small">{breakTime(String(p.paid_at))}</p>
              </div>
            </article>
          ))}
          <details>
            <summary>Purchase history ({data.history.length})</summary>
            {data.history.map((h, i) => (
              <p key={i}>
                {breakTime(String(h.recorded_at))} ·{" "}
                {String((h.details as { status: string }).status).replaceAll(
                  "_",
                  " ",
                )}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
function EventEditor({
  event,
  post,
  busy,
}: {
  event: BreakEvent | null;
  post: Post;
  busy: boolean;
}) {
  const [issue, setIssue] = useState("");
  const [draftId] = useState(() => crypto.randomUUID());
  const local = chicagoLocal(event?.starts_at || null);
  const summer = event?.starts_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        timeZoneName: "short",
      })
        .format(new Date(event.starts_at))
        .includes("CDT")
    : true;
  return (
    <form
      key={event?.version || draftId}
      onSubmit={async (ev) => {
        const f = form(ev);
        try {
          setIssue("");
          await post({
            action: "event",
            id: event?.id || draftId,
            version: event?.version ?? null,
            reason: value(f, "reason"),
            event: {
              title: value(f, "title"),
              products: value(f, "products")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
              starts_at: value(f, "date")
                ? chicagoToUtc(value(f, "date"), value(f, "offset"))
                : null,
              status: value(f, "status"),
              host: value(f, "host"),
              description: value(f, "description"),
              image_url: value(f, "image"),
              format: value(f, "format"),
              capacity: value(f, "capacity") ? number(f, "capacity") : null,
              terms: value(f, "terms"),
              stream_url: value(f, "stream"),
              replay_url: value(f, "replay"),
              duration_minutes: number(f, "duration"),
              published: f.has("published"),
            },
          });
        } catch (e) {
          setIssue(e instanceof Error ? e.message : "Invalid date");
        }
      }}
    >
      {issue && <p role="alert">{issue}</p>}
      <label>
        Title
        <input
          name="title"
          required
          maxLength={150}
          defaultValue={event?.title}
        />
      </label>
      <label>
        Products (one description per line)
        <textarea name="products" defaultValue={event?.products.join("\n")} />
      </label>
      <div className="loyalty-form-grid">
        <label>
          Scheduled start · Chicago time
          <input name="date" type="datetime-local" defaultValue={local} />
        </label>
        <label>
          Chicago clock setting
          <select name="offset" defaultValue={summer ? "-05:00" : "-06:00"}>
            <option value="-05:00">Daylight time (CDT, UTC−5)</option>
            <option value="-06:00">Standard time (CST, UTC−6)</option>
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={event?.status || "draft"}>
            {breakStatuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Host
          <input name="host" maxLength={100} defaultValue={event?.host} />
        </label>
      </div>
      <p className="small">
        Only staff marks a break live. Passing the scheduled time never changes
        its status.
      </p>
      <label>
        Description
        <textarea
          name="description"
          required
          maxLength={4000}
          defaultValue={event?.description}
        />
      </label>
      <label>
        Event image path or Shopify CDN URL
        <input
          name="image"
          defaultValue={event?.image_url || ""}
          placeholder="/northside-logo.svg"
        />
      </label>
      <div className="loyalty-form-grid">
        <label>
          Selling format
          <select name="format" defaultValue={event?.format || "unconfirmed"}>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="named">Named exclusive spots</option>
            <option value="identical">Identical pooled spots</option>
          </select>
        </label>
        <label>
          Total spot capacity
          <input
            name="capacity"
            type="number"
            min="1"
            max="500"
            defaultValue={event?.capacity || ""}
          />
        </label>
        <label>
          Calendar duration (minutes)
          <input
            name="duration"
            type="number"
            min="15"
            max="1440"
            required
            defaultValue={event?.duration_minutes || 120}
          />
        </label>
      </div>
      <label>
        Customer terms
        <textarea name="terms" maxLength={4000} defaultValue={event?.terms} />
      </label>
      <label>
        Facebook, Instagram or YouTube stream URL
        <input
          name="stream"
          type="url"
          defaultValue={event?.stream_url || ""}
          placeholder="Unconfirmed — leave blank"
        />
      </label>
      <label>
        Replay URL
        <input
          name="replay"
          type="url"
          defaultValue={event?.replay_url || ""}
        />
      </label>
      <label className="loyalty-check">
        <input
          name="published"
          type="checkbox"
          defaultChecked={event?.published}
        />
        Publish in the schedule
      </label>
      <Reason />
      <button className="button" disabled={busy}>
        {event ? "Save schedule changes" : "Create break"}
      </button>
      <p className="small">
        Saving closes the sale review until staff reconciles it again. Existing
        purchases are retained.
      </p>
    </form>
  );
}
function StaffDesk({
  data: s,
  post,
  busy,
  fixture,
}: {
  data: Staff;
  post: Post;
  busy: boolean;
  fixture: boolean;
}) {
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState("schedule");
  const e =
    s.events.find((e) => e.id === (selected || s.events[0]?.id)) || null;
  const content = s.role === "content_editor",
    readonly = s.role === "read_only",
    mappings = s.mappings.filter((m) => m.event_id === e?.id),
    purchases = s.purchases.filter((p) => p.event_id === e?.id);
  return (
    <>
      <label>
        Selected break
        <select
          value={selected || s.events[0]?.id || "new"}
          onChange={(ev) => setSelected(ev.target.value)}
        >
          <option value="new">Create a new break</option>
          {s.events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {e.status}
            </option>
          ))}
        </select>
      </label>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="tabs break-tabs" aria-label="Break operations">
          <Tabs.Trigger value="schedule">Schedule</Tabs.Trigger>
          {!content && (
            <>
              <Tabs.Trigger value="mappings">
                Spot mappings & sale checks
              </Tabs.Trigger>
              <Tabs.Trigger value="purchases">Purchases & legacy</Tabs.Trigger>
              <Tabs.Trigger value="review">Review queue</Tabs.Trigger>
            </>
          )}
        </Tabs.List>
        <Tabs.Content value="schedule">
          <section className="loyalty-card">
            <h2>{e ? "Edit schedule" : "New break"}</h2>
            {readonly ? (
              <p>
                Read-only staff access. Select another tab to review records.
              </p>
            ) : (
              <EventEditor
                key={e?.id || "new"}
                event={e}
                post={async (body) => {
                  const ok = await post(body);
                  if (ok && body.action === "event")
                    setSelected(String(body.id));
                  return ok;
                }}
                busy={busy}
              />
            )}
          </section>
        </Tabs.Content>
        {!content && (
          <>
            <Tabs.Content value="mappings">
              <section className="loyalty-card">
                <h2>Exact Shopify spot mapping</h2>
                <p>
                  One unique variant and SKU for each named spot, or one finite
                  variant for identical pooled spots. No product or inventory
                  settings are changed here.
                </p>
                {!e ? (
                  <p>Create a schedule first.</p>
                ) : (
                  <>
                    <p>
                      Format: {e.format} · Total capacity{" "}
                      {e.capacity ?? "unconfirmed"} · Reconciliation{" "}
                      {e.sale_open ? "recorded" : "required"}
                    </p>
                    {mappings.map((m) => (
                      <div className="loyalty-row" key={String(m.id)}>
                        <div>
                          <h3>{String(m.spot_key)}</h3>
                          <p>
                            {String(m.sku)} · capacity {String(m.capacity)} ·
                            held {String(m.occupied)} ·{" "}
                            {m.active ? "active" : "inactive"}
                          </p>
                          <code className="loyalty-code">
                            {String(m.variant_id)}
                          </code>
                        </div>
                        {!readonly && (
                          <form
                            onSubmit={(ev) => {
                              const f = form(ev);
                              void post({
                                action: "mapping-active",
                                mapping_id: m.id,
                                active: !m.active,
                                reason: value(f, "reason"),
                              });
                            }}
                          >
                            <Reason />
                            <button
                              className="button secondary"
                              disabled={busy}
                            >
                              {m.active ? "Disable mapping" : "Enable mapping"}
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                    {!readonly && (
                      <>
                        <details>
                          <summary>Add a spot mapping</summary>
                          <form
                            onSubmit={(ev) => {
                              const f = form(ev);
                              void post({
                                action: "mapping",
                                event_id: e.id,
                                reason: value(f, "reason"),
                                mapping: {
                                  variant_id: value(f, "variant"),
                                  product_id: value(f, "product"),
                                  sku: value(f, "sku"),
                                  spot_key: value(f, "spot"),
                                  capacity: number(f, "capacity"),
                                },
                              });
                            }}
                          >
                            <label>
                              Shopify product ID
                              <input
                                name="product"
                                required
                                placeholder="gid://shopify/Product/…"
                              />
                            </label>
                            <label>
                              Shopify variant ID
                              <input
                                name="variant"
                                required
                                placeholder="gid://shopify/ProductVariant/…"
                              />
                            </label>
                            <label>
                              Unique SKU
                              <input name="sku" required maxLength={100} />
                            </label>
                            <label>
                              Spot label
                              <input name="spot" required maxLength={100} />
                            </label>
                            <label>
                              Variant capacity
                              <input
                                name="capacity"
                                type="number"
                                min="1"
                                max="500"
                                required
                                defaultValue="1"
                              />
                            </label>
                            <Reason />
                            <button className="button" disabled={busy}>
                              Save exact mapping
                            </button>
                          </form>
                        </details>
                        <h3>Before-sale reconciliation</h3>
                        <form
                          onSubmit={(ev) => {
                            const f = form(ev);
                            void post({
                              action: "sale-check",
                              event_id: e.id,
                              checks: Object.fromEntries(
                                Object.keys(labels).map((k) => [k, f.has(k)]),
                              ),
                              evidence: value(f, "evidence"),
                              reason: value(f, "reason"),
                            });
                          }}
                        >
                          {Object.entries(labels).map(([k, label]) => (
                            <label className="loyalty-check" key={k}>
                              <input type="checkbox" name={k} required />
                              {fixture ? "SAMPLE exercise: " : ""}
                              {label}
                            </label>
                          ))}
                          <label>
                            Private reconciliation evidence
                            <textarea
                              name="evidence"
                              required
                              maxLength={2000}
                            />
                          </label>
                          <Reason />
                          <button className="button" disabled={busy}>
                            Record {fixture ? "sample " : ""}reconciliation
                          </button>
                        </form>
                      </>
                    )}
                    <p className="small">
                      Live sales also require current Shopify inventory proof
                      and a verified competing-checkout test. The global
                      purchase gate remains disabled.
                    </p>
                    <details>
                      <summary>Recorded checks</summary>
                      {s.checks
                        .filter((c) => c.event_id === e.id)
                        .map((c) => (
                          <p key={String(c.id)}>
                            {breakTime(String(c.checked_at))} · Schedule version{" "}
                            {String(c.event_version)} · {String(c.reason)}
                          </p>
                        ))}
                    </details>
                  </>
                )}
              </section>
            </Tabs.Content>
            <Tabs.Content value="purchases">
              <section className="loyalty-card">
                <h2>Purchased spots</h2>
                <p>
                  Shopify paid orders and separately sourced external purchases.
                  These records never initiate refunds or transfers.
                </p>
                {fixture &&
                  e?.id === "00000000-0000-4000-8000-000000007001" &&
                  !readonly && (
                    <div className="loyalty-notice">
                      <h3>Sample reconciliation exercise</h3>
                      <p>
                        Both sample collectors attempt the same one-capacity
                        North spot. The second purchase must enter review.
                      </p>
                      <div className="actions">
                        {[1, 2].map((n) => (
                          <button
                            className="button secondary"
                            disabled={busy}
                            key={n}
                            onClick={() =>
                              post({ action: "sample-paid", customer: n })
                            }
                          >
                            Simulate paid order {n === 1 ? "A" : "B"}
                          </button>
                        ))}
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            post({ action: "sample-refund", customer: 1 })
                          }
                        >
                          Simulate refund A
                        </button>
                      </div>
                    </div>
                  )}
                {!purchases.length && (
                  <p>No paid spot records for this break.</p>
                )}
                {purchases.map((p) => (
                  <article className="loyalty-card" key={String(p.id)}>
                    <h3>
                      {String(
                        mappings.find((m) => m.id === p.mapping_id)?.spot_key ||
                          "Mapped spot",
                      )}{" "}
                      ·{" "}
                      {(s.customers.find((c) => c.id === p.customer_id)
                        ?.display_name as string) || "Ownership review"}
                    </h3>
                    <span className="badge">
                      {String(p.status).replaceAll("_", " ")}
                    </span>
                    <p>
                      {p.source === "legacy"
                        ? "External paid evidence · excludes Shopify revenue"
                        : "Shopify paid line"}{" "}
                      · {String(p.current_quantity)} of {String(p.quantity)}{" "}
                      current · {money(p.amount_cents)} original
                    </p>
                    <code className="loyalty-code">
                      {String(p.source_order)}
                    </code>
                    {p.source === "legacy" && (
                      <p>Private evidence: {String(p.legacy_evidence)}</p>
                    )}
                    {!readonly && (
                      <details>
                        <summary>Review refund / capacity</summary>
                        <form
                          onSubmit={(ev) => {
                            const f = form(ev);
                            void post({
                              action: value(f, "action"),
                              purchase_id: p.id,
                              quantity: number(f, "quantity"),
                              reason: value(f, "reason"),
                            });
                          }}
                        >
                          <label>
                            Review action
                            <select name="action">
                              <option value="release">
                                Release refunded capacity before start
                              </option>
                              {p.source === "legacy" && (
                                <option value="void-legacy">
                                  Record externally refunded / void legacy
                                  purchase
                                </option>
                              )}
                            </select>
                          </label>
                          <label>
                            Slots to release
                            <input
                              name="quantity"
                              type="number"
                              min="1"
                              max="500"
                              defaultValue="1"
                              required
                            />
                          </label>
                          <Reason />
                          <button className="button secondary" disabled={busy}>
                            Save reviewed correction
                          </button>
                        </form>
                        <p className="small">
                          A refund keeps capacity held by default. Started
                          breaks cannot reopen spots. Release closes sale
                          reconciliation and never changes Shopify stock.
                        </p>
                      </details>
                    )}
                  </article>
                ))}
                {e && !readonly && (
                  <details>
                    <summary>Record a verified external paid spot</summary>
                    <form
                      onSubmit={(ev) => {
                        const f = form(ev);
                        try {
                          void post({
                            action: "legacy",
                            reason: value(f, "reason"),
                            purchase: {
                              mapping_id: value(f, "mapping"),
                              customer_id: value(f, "customer"),
                              reference: value(f, "reference"),
                              evidence: value(f, "evidence"),
                              quantity: number(f, "quantity"),
                              amount_cents: Math.round(
                                number(f, "amount") * 100,
                              ),
                              paid_at: new Date(value(f, "paid")).toISOString(),
                            },
                          });
                        } catch {
                          ev.currentTarget.reportValidity();
                        }
                      }}
                    >
                      <label>
                        Mapped spot
                        <select name="mapping" required>
                          <option value="">Choose exact spot</option>
                          {mappings.map((m) => (
                            <option key={String(m.id)} value={String(m.id)}>
                              {String(m.spot_key)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Verified customer
                        <select name="customer" required>
                          <option value="">Choose verified owner</option>
                          {s.customers.map((c) => (
                            <option key={String(c.id)} value={String(c.id)}>
                              {String(c.display_name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        External payment / receipt reference
                        <input name="reference" required maxLength={120} />
                      </label>
                      <label>
                        Independent private evidence
                        <textarea name="evidence" required maxLength={2000} />
                      </label>
                      <label>
                        Paid timestamp with time zone
                        <input
                          name="paid"
                          required
                          placeholder="2026-09-12T12:00:00-05:00"
                          pattern=".*T.*(Z|[+-][0-9]{2}:[0-9]{2})"
                        />
                      </label>
                      <label>
                        Quantity
                        <input
                          name="quantity"
                          type="number"
                          min="1"
                          max="500"
                          required
                          defaultValue="1"
                        />
                      </label>
                      <label>
                        Verified original amount (USD)
                        <input
                          name="amount"
                          type="number"
                          step="0.01"
                          min="0"
                          required
                        />
                      </label>
                      <Reason />
                      <button className="button" disabled={busy}>
                        Record external paid spot
                      </button>
                    </form>
                  </details>
                )}
              </section>
            </Tabs.Content>
            <Tabs.Content value="review">
              <section className="loyalty-card">
                <h2>Reconciliation exceptions</h2>
                {!s.exceptions.length && <p>No exceptions recorded.</p>}
                {s.exceptions.map((x) => (
                  <article className="loyalty-card" key={String(x.id)}>
                    <h3>
                      {String(x.kind).replaceAll("_", " ")} · {String(x.status)}
                    </h3>
                    <p>{String(x.details)}</p>
                    {x.status === "open" && !readonly ? (
                      <form
                        onSubmit={(ev) => {
                          const f = form(ev);
                          void post({
                            action: "resolve",
                            exception_id: x.id,
                            reason: value(f, "reason"),
                          });
                        }}
                      >
                        <Reason />
                        <button className="button secondary" disabled={busy}>
                          Record resolution
                        </button>
                      </form>
                    ) : (
                      <p>{String(x.resolution || "")}</p>
                    )}
                  </article>
                ))}
                <h3>Order reconciliation jobs</h3>
                {!s.jobs.length && <p>No pending or failed jobs.</p>}
                {s.jobs.map((j) => (
                  <div className="loyalty-card" key={String(j.id)}>
                    <code className="loyalty-code">{String(j.order_id)}</code>
                    <p>
                      {String(j.state)} · attempts {String(j.attempts)} ·{" "}
                      {String(j.last_error || "")}
                    </p>
                    {!readonly && j.state !== "processing" && (
                      <form
                        onSubmit={(ev) => {
                          const f = form(ev);
                          void post({
                            action: "retry",
                            job_id: j.id,
                            reason: value(f, "reason"),
                          });
                        }}
                      >
                        <Reason />
                        <button className="button secondary" disabled={busy}>
                          Retry fresh order read
                        </button>
                      </form>
                    )}
                  </div>
                ))}
                {!readonly && (
                  <form
                    onSubmit={(ev) => {
                      const f = form(ev);
                      void post({
                        action: "recheck",
                        order_id: value(f, "order"),
                        request_id: crypto.randomUUID(),
                        reason: value(f, "reason"),
                      });
                    }}
                  >
                    <label>
                      Shopify order ID to recheck
                      <input
                        name="order"
                        required
                        placeholder="gid://shopify/Order/…"
                      />
                    </label>
                    <Reason />
                    <button className="button secondary" disabled={busy}>
                      Queue order recheck
                    </button>
                  </form>
                )}
                <details>
                  <summary>Staff audit history</summary>
                  {s.audit.map((x) => (
                    <p key={String(x.id)}>
                      {breakTime(String(x.created_at))} · {String(x.action)} ·{" "}
                      {String(x.reason)}
                    </p>
                  ))}
                </details>
              </section>
            </Tabs.Content>
          </>
        )}
      </Tabs.Root>
    </>
  );
}
