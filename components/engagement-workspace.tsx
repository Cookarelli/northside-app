"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { type Show, type Placement } from "@/lib/engagement";
import { pushCapability } from "@/lib/pwa";
const api = (sample: boolean) =>
  sample ? "/api/preview/engagement" : "/api/engagement";
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" }),
    b = await r.json();
  if (!r.ok)
    throw Error(
      String(b.error || "Connection unavailable").replaceAll("_", " "),
    );
  return b;
}
async function post(url: string, body: unknown) {
  const r = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    b = await r.json();
  if (!r.ok)
    throw Error(String(b.error || "Could not save").replaceAll("_", " "));
  return b;
}
function Sample({ sample }: { sample: boolean }) {
  return sample ? (
    <p className="notice">
      <strong>SAMPLE · Local rehearsal</strong> — fictional records. Email and
      push are UNSENT.
    </p>
  ) : null;
}
function Navigation() {
  return (
    <p className="workspace-links">
      <Link href="/account/notifications">Notifications</Link> ·{" "}
      <Link href="/install">Install Northside</Link> ·{" "}
      <Link href="/shows">Shows</Link> ·{" "}
      <Link href="/staff/engagement">Staff engagement</Link>
    </p>
  );
}
const displayDate = (s: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(s));
export function AnalyticsConsent({
  sample,
  refValue,
}: {
  sample: boolean;
  refValue?: string;
}) {
  const [allowed, setAllowed] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void get<{ consent: boolean }>(api(sample) + "?public=1")
      .then((d) => {
        if (active) setAllowed(d.consent);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sample]);
  async function save(granted: boolean) {
    setBusy(true);
    try {
      const r = await post(api(sample) + "?public=1", {
        action: "consent",
        granted,
        ref: refValue,
      });
      setAllowed(granted);
      setNotice(r.message);
      window.dispatchEvent(
        new CustomEvent("northside-consent", { detail: granted }),
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="analytics-choice">
      <h3>Help us understand what works</h3>
      <p>
        Optional analytics connects eligible show visits with app activity in
        this browser. It does not sign you up for marketing messages.
      </p>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void save(!allowed)}
      >
        {allowed ? "Turn off analytics" : "Allow analytics"}
      </button>{" "}
      <span>
        {allowed ? "Allowed in this browser" : "Off unless you choose to allow"}
      </span>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
export function MeasurementBridge({ sample }: { sample: boolean }) {
  const path = usePathname(),
    search = useSearchParams(),
    refValue = search.get("ref");
  const id = useRef("");
  useEffect(() => {
    id.current = crypto.randomUUID();
    const send = async (event: string) => {
      await post(api(sample) + "?public=1", {
        action: "view",
        event,
        ref: refValue,
        request_id: id.current,
      }).catch(() => {});
    };
    const page = () => {
      void post(api(sample), { action: "link" }).catch(() => {});
      if (path.startsWith("/shows/") || path === "/hobby-key/vendor-interest")
        void send("landing_view");
      else if (path.startsWith("/shop/")) void send("product_view");
    };
    const measure = (e: Event) => {
      if ((e as CustomEvent).detail?.event === "install_prompt_accepted")
        void send("install_prompt_accepted");
    };
    page();
    window.addEventListener("northside-consent", page);
    window.addEventListener("northside-measure", measure);
    return () => {
      window.removeEventListener("northside-consent", page);
      window.removeEventListener("northside-measure", measure);
    };
  }, [path, refValue, sample]);
  return null;
}
type Kind = "grading" | "consignment" | "break";
type Preference = {
  kind: Kind;
  in_app: boolean;
  email: boolean;
  push: boolean;
};
type Inbox = {
  preferences: Preference[];
  notifications: {
    id: string;
    kind: Kind;
    topic?: string;
    grading_card_id?: string | null;
    due_at: string;
    read_at: string | null;
  }[];
  pushConfigured: boolean;
  publicKey: string | null;
  deliveryEnabled: boolean;
};
export function NotificationsWorkspace({ sample }: { sample: boolean }) {
  const [actor, setActor] = useState("a"),
    [data, setData] = useState<Inbox | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const url = api(sample) + (sample ? "?actor=" + actor : "");
  const load = useCallback(async () => {
    try {
      setData(await get<Inbox>(url));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    let active = true;
    void get<Inbox>(url)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function action(b: unknown) {
    setBusy(true);
    try {
      const r = await post(url, b);
      setNotice(r.message);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function enablePush() {
    if (
      !("Notification" in window) ||
      !("PushManager" in window) ||
      !("serviceWorker" in navigator)
    ) {
      setNotice(pushCapability("default", false));
      return;
    }
    if (Notification.permission === "denied") {
      setNotice(pushCapability("denied", true));
      return;
    }
    if (!data?.pushConfigured) {
      setNotice(
        "Push delivery is not configured. In-app updates still work; this preview cannot send push.",
      );
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotice(pushCapability(permission, true));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const s = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: data.publicKey!,
      });
      await action({ action: "subscribe", subscription: s.toJSON() });
    } catch {
      setNotice(
        "Push could not be registered. Your in-app updates remain available.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="engagement-workspace">
      <Navigation />
      <header>
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>Updates, on your terms</h1>
        <p>Choose how to hear about your cards and saved breaks.</p>
      </header>
      <Sample sample={sample} />
      {sample && (
        <label>
          Sample collector{" "}
          <select
            value={actor}
            onChange={(e) => {
              setData(null);
              setActor(e.target.value);
              setNotice("");
            }}
          >
            <option value="a">Collector A</option>
            <option value="b">Collector B</option>
          </select>
        </label>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!data ? (
        <section className="loyalty-card">
          <p>
            {notice
              ? "Sign in to see your updates. If the connection is unavailable, try again when you are online."
              : "Loading your updates…"}
          </p>
          <Link href="/account">Open account</Link>{" "}
          <button className="button secondary" onClick={() => void load()}>
            Refresh
          </button>
        </section>
      ) : (
        <>
          <section className="loyalty-card">
            <h2>Delivery preferences</h2>
            <p>
              {data.deliveryEnabled
                ? "Provider acceptance does not confirm delivery to your device."
                : "Delivery is not connected. In-app updates work; external delivery attempts remain UNSENT."}
            </p>
            {(["grading", "consignment", "break"] as Kind[]).map((kind) => (
              <PreferenceForm
                key={actor + kind}
                kind={kind}
                value={data.preferences.find((p) => p.kind === kind)}
                busy={busy}
                save={(p) => action({ action: "preferences", ...p })}
              />
            ))}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void enablePush()}
            >
              Enable push on this browser
            </button>
            <p className="small">
              Permission is requested only when you use this button and push is
              configured. Lock-screen notices are generic and ask you to open
              your account.
            </p>
          </section>
          <section className="loyalty-card">
            <h2>In-app updates</h2>
            {data.notifications.length === 0 ? (
              <p>
                No updates are due. Saved break reminders appear at their
                scheduled time.
              </p>
            ) : (
              data.notifications.map((n) => (
                <article className="notification-row" key={n.id}>
                  <div>
                    <h3>
                      {n.topic === "decision_required"
                        ? "Your grading decision is needed"
                        : n.topic === "decision_recorded"
                          ? "Your grading decision was recorded"
                          : n.topic === "pickup_ready"
                            ? "Your cards are ready for pickup"
                            : n.topic === "pickup_completed"
                              ? "Your card pickup was recorded"
                              : n.topic === "withdrawal_review"
                                ? "Your withdrawal request is under staff review"
                                : n.kind === "break"
                                  ? "A saved break reminder"
                                  : "Your " +
                                    n.kind +
                                    " records have an update"}
                    </h3>
                    <p>
                      {displayDate(n.due_at)} · {n.read_at ? "Read" : "Unread"}
                    </p>
                  </div>
                  <Link
                    className="button secondary"
                    href={
                      n.kind === "break"
                        ? "/breaks"
                        : n.kind === "grading"
                          ? n.grading_card_id
                            ? "/my-cards/grading/card/" +
                              n.grading_card_id +
                              (sample ? "?actor=" + actor : "")
                            : "/my-cards/grading"
                          : "/my-cards/consignment"
                    }
                    onClick={() => void action({ action: "read", id: n.id })}
                  >
                    Open {n.kind === "break" ? "breaks" : "records"}
                  </Link>
                  {!n.read_at && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void action({ action: "read", id: n.id })}
                    >
                      Mark read
                    </button>
                  )}
                </article>
              ))
            )}
          </section>
        </>
      )}
      <AnalyticsConsent key={actor + String(!!data)} sample={sample} />
    </div>
  );
}
function PreferenceForm({
  kind,
  value,
  busy,
  save,
}: {
  kind: Kind;
  value?: Preference;
  busy: boolean;
  save: (v: Preference) => Promise<void>;
}) {
  const [v, setV] = useState<Preference>(
    value || { kind, in_app: true, email: false, push: false },
  );
  return (
    <form
      className="preference-row"
      onSubmit={(e) => {
        e.preventDefault();
        void save(v);
      }}
    >
      <fieldset>
        <legend>
          {kind === "break"
            ? "Saved breaks"
            : kind === "grading"
              ? "Grading"
              : "Consignment"}
        </legend>
        {(["in_app", "email", "push"] as const).map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.checked })}
            />
            {k === "in_app" ? "In-app" : k === "email" ? "Email" : "Push"}
          </label>
        ))}
      </fieldset>
      <button className="button secondary" disabled={busy}>
        Save {kind} preferences
      </button>
    </form>
  );
}
export function ShowLanding({
  show,
  placement,
  sample,
}: {
  show: Show;
  placement: Placement | null;
  sample: boolean;
}) {
  const vendor = show.brand === "hobby_key",
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    requestId = useRef("");
  return (
    <div className="engagement-workspace">
      <Navigation />
      <Sample sample={sample} />
      <section className="show-hero">
        <p className="eyebrow">
          {vendor
            ? "HOBBYKEY · VENDOR INTEREST"
            : "NORTHSIDE COLLECTIBLES · COLLECTOR SHOW"}
        </p>
        <h1>{show.title}</h1>
        <p>{show.description}</p>
        <p>
          {show.starts_at
            ? displayDate(show.starts_at)
            : "Date to be announced"}{" "}
          · {show.location || "Location to be announced"}
        </p>
        {!vendor && (
          <div className="button-row">
            <Link className="button" href="/shop">
              Browse cards
            </Link>
            <Link className="button secondary" href="/breaks">
              Explore breaks
            </Link>
            <Link className="button secondary" href="/account">
              Create or open your account
            </Link>
          </div>
        )}
      </section>
      {vendor ? (
        <section className="loyalty-card">
          <h2>Stay in the loop</h2>
          <p>
            HobbyKey interest is separate from Northside shopping. No
            marketplace, booth booking or sale is available here.
          </p>
          <form
            className="engagement-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              requestId.current ||= crypto.randomUUID();
              try {
                const r = await post(api(sample) + "?public=1", {
                  action: "interest",
                  slug: show.slug,
                  ref: placement?.ref,
                  request_id: requestId.current,
                  name: f.get("name"),
                  email: f.get("email"),
                  followup_consent: f.get("consent") === "on",
                  website: f.get("website"),
                });
                setNotice(r.message);
              } catch (error) {
                setNotice((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Your name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={sample ? "Sample vendor" : ""}
              />
            </label>
            <label>
              Email for follow-up
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                defaultValue={sample ? "sample@example.invalid" : ""}
              />
            </label>
            <label className="trap" aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <label className="check-label">
              <input name="consent" type="checkbox" required />I agree to
              follow-up about HobbyKey vendor interest. This is separate from
              optional app analytics.
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Register interest"}
            </button>
          </form>
          {notice && <p role="status">{notice}</p>}
        </section>
      ) : (
        <section className="loyalty-card">
          <h2>More than a show visit</h2>
          <p>
            Track your grading records, save a break reminder and keep Northside
            handy on your phone.
          </p>
          <Link href="/install">See installation options →</Link>
        </section>
      )}
      <AnalyticsConsent sample={sample} refValue={placement?.ref} />
      {placement && (
        <p className="small">
          Campaign: {placement.utm_campaign} · Placement:{" "}
          {placement.utm_content}. Links help measure consented visits; they are
          never identity or payment evidence.
        </p>
      )}
    </div>
  );
}
type Report = {
  legacyEvidence: {
    records: number;
    orders: number;
    recorded_cents: string;
    voided_records: number;
  };
  tenant: string;
  filters: { start: string; end: string; campaign?: string; source?: string };
  last_sync: string | null;
  attribution: string;
  events: { event: string; definition: string; count: number }[];
  orders: {
    channel: string;
    orders: number;
    gross_cents: string;
    refund_cents: string;
    net_cents: string;
    unattributed_orders: number;
  }[];
};
type StaffData = {
  report: Report;
  shows: Show[];
  placements: Placement[];
  jobs: {
    id: string;
    channel: string;
    state: string;
    attempts: number;
    available_at: string;
    due_at: string;
    last_error: string | null;
  }[];
  attempts: { outcome: string; code: string; at: string }[];
  measurementJobs: { state: string; count: number }[];
};
export function EngagementStaff({ sample }: { sample: boolean }) {
  const [data, setData] = useState<StaffData | null>(null),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const url = api(sample) + "?staff=1" + (sample ? "&actor=staff" : "") + query;
  const load = useCallback(async () => {
    try {
      setData(await get<StaffData>(url));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    let active = true;
    void get<StaffData>(url)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function action(b: unknown) {
    setBusy(true);
    try {
      const r = await post(url, b);
      setNotice(r.message || "Saved.");
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="engagement-workspace">
      <Navigation />
      <header>
        <p className="eyebrow">STAFF WORKSPACE</p>
        <h1>Engagement & show campaigns</h1>
        <p>
          Review activity, manage printed QR destinations and check notification
          jobs.
        </p>
      </header>
      <Sample sample={sample} />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!data ? (
        <p>
          {notice
            ? "Staff sign-in and a configured connection are required."
            : "Loading engagement workspace…"}{" "}
          <Link href="/staff">Open staff sign-in</Link>
        </p>
      ) : (
        <Tabs.Root defaultValue="metrics">
          <Tabs.List
            className="workspace-tabs"
            aria-label="Engagement sections"
          >
            <Tabs.Trigger value="metrics">Metrics & export</Tabs.Trigger>
            <Tabs.Trigger value="shows">Shows & QR links</Tabs.Trigger>
            <Tabs.Trigger value="jobs">Delivery jobs</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="metrics">
            <section className="loyalty-card">
              <h2>Activity report</h2>
              <form
                className="engagement-form filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    q = new URLSearchParams();
                  for (const k of ["start", "end", "campaign", "source"])
                    if (f.get(k)) q.set(k, String(f.get(k)));
                  setQuery("&" + q);
                }}
              >
                <label>
                  Start date (UTC, inclusive)
                  <input
                    type="date"
                    name="start"
                    defaultValue={data.report.filters.start}
                    required
                  />
                </label>
                <label>
                  End date (UTC, exclusive)
                  <input
                    type="date"
                    name="end"
                    defaultValue={data.report.filters.end}
                    required
                  />
                </label>
                <label>
                  Campaign
                  <input name="campaign" placeholder="All campaigns" />
                </label>
                <label>
                  Source
                  <input name="source" placeholder="All sources" />
                </label>
                <button className="button">Apply filters</button>
                <a className="button secondary" href={url + "&csv=1"}>
                  Download {sample ? "SAMPLE " : ""}CSV
                </a>
              </form>
              <p className="small">
                Tenant: {data.report.tenant} · Last order sync:{" "}
                {data.report.last_sync
                  ? displayDate(data.report.last_sync)
                  : "Never — no verified order sync"}
              </p>
              <p>
                {data.report.attribution}. Ad-platform totals are not added
                together as unique orders.
              </p>
              <div className="engagement-table">
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Count</th>
                      <th>Definition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.events.map((m) => (
                      <tr key={m.event}>
                        <td>{m.event.replaceAll("_", " ")}</td>
                        <td>{m.count}</td>
                        <td>{m.definition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Paid orders & refund adjustments</h3>
              <div className="engagement-table">
                <table>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>Unique orders</th>
                      <th>Received</th>
                      <th>Refunded</th>
                      <th>Net</th>
                      <th>Unattributed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.orders.map((o) => (
                      <tr key={o.channel}>
                        <td>{o.channel.replaceAll("_", " ")}</td>
                        <td>{o.orders}</td>
                        <td>${(Number(o.gross_cents) / 100).toFixed(2)}</td>
                        <td>${(Number(o.refund_cents) / 100).toFixed(2)}</td>
                        <td>${(Number(o.net_cents) / 100).toFixed(2)}</td>
                        <td>{o.unattributed_orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>External legacy payment evidence</h3>
              <p>
                {data.report.legacyEvidence.records} recorded lines ·{" "}
                {data.report.legacyEvidence.orders} unique external references ·
                $
                {(
                  Number(data.report.legacyEvidence.recorded_cents) / 100
                ).toFixed(2)}{" "}
                recorded · {data.report.legacyEvidence.voided_records} voided
                records. Refund amounts need separate evidence; no net payment
                total is inferred. Campaign filters exclude this unmatched
                evidence.
              </p>
              <p>
                Refunds adjust orders in their original paid-date cohort.
                External legacy evidence stays separate. Consignment payouts are
                excluded from retail revenue.
              </p>
              <p className="small">
                Export contract prepared for Marketing Hub. No live hub
                connection, automatic Shopify pixel coverage or native app-store
                attribution is claimed.
              </p>
            </section>
          </Tabs.Content>
          <Tabs.Content value="shows">
            <section className="loyalty-card">
              <h2>Reusable show records</h2>
              <p>
                Blank dates and locations remain “to be announced.” Edit a show
                or remap a QR destination without reprinting its stable URL.
              </p>
              {data.shows.map((s) => (
                <ShowForm
                  key={s.id + ":" + s.version}
                  show={s}
                  busy={busy}
                  save={action}
                />
              ))}
              <ShowForm key="new" busy={busy} save={action} />
            </section>
            <section className="loyalty-card">
              <h2>Stable placement links</h2>
              {data.placements.map((p) => (
                <article className="qr-placement" key={p.ref}>
                  <h3>{p.placement_key}</h3>
                  <p>
                    {p.utm_source} / {p.utm_medium} / {p.utm_campaign} /{" "}
                    {p.utm_content}
                  </p>
                  <p>
                    <a href={"/go/" + p.ref}>Open stable QR destination</a> ·{" "}
                    <a href={"/api/show-qr/" + p.ref}>
                      Download {sample ? "SAMPLE " : ""}QR label
                    </a>
                  </p>
                  <form
                    className="engagement-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void action({
                        action: "placement",
                        ...p,
                        event_id: f.get("event_id"),
                        enabled: f.get("enabled") === "on",
                      });
                    }}
                  >
                    <label>
                      Destination
                      <select name="event_id" defaultValue={p.event_id}>
                        {data.shows.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-label">
                      <input
                        name="enabled"
                        type="checkbox"
                        defaultChecked={p.enabled}
                      />
                      Enabled
                    </label>
                    <button className="button secondary" disabled={busy}>
                      Save QR destination
                    </button>
                  </form>
                </article>
              ))}
              <h3>New placement</h3>
              <form
                className="engagement-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action({
                    action: "placement",
                    ...Object.fromEntries(f),
                    enabled: true,
                  });
                }}
              >
                <label>
                  Show
                  <select name="event_id">
                    {data.shows.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                {[
                  ["placement_key", "Placement key", ""],
                  ["utm_source", "Source", "geneva_card_show"],
                  ["utm_medium", "Medium", "qr"],
                  ["utm_campaign", "Campaign", ""],
                  ["utm_content", "Unique placement content", ""],
                ].map(([k, l, v]) => (
                  <label key={k}>
                    {l}
                    <input
                      name={k}
                      required
                      pattern="[a-z0-9_]+"
                      maxLength={80}
                      defaultValue={v}
                    />
                  </label>
                ))}
                <button className="button" disabled={busy}>
                  Create stable QR link
                </button>
              </form>
            </section>
          </Tabs.Content>
          <Tabs.Content value="jobs">
            <section className="loyalty-card">
              <h2>Transactional delivery outbox</h2>
              <p>
                Grading and consignment changes queue generic updates. Saved
                break reminders use durable due times. Cancellation and opt-out
                are checked again before a provider request.
              </p>
              {sample && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void action({ action: "work" })}
                >
                  Run sample delivery worker
                </button>
              )}
              <div className="engagement-table">
                <table>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>State</th>
                      <th>Attempts</th>
                      <th>Scheduled (Chicago)</th>
                      <th>Result</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <tr key={j.id}>
                        <td>{j.channel}</td>
                        <td>{j.state.toUpperCase()}</td>
                        <td>{j.attempts}</td>
                        <td>{displayDate(j.due_at)}</td>
                        <td>
                          {j.last_error?.replaceAll("_", " ") ||
                            "Awaiting worker"}
                        </td>
                        <td>
                          {["unsent", "failed"].includes(j.state) && (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() =>
                                void action({ action: "retry", id: j.id })
                              }
                            >
                              Retry job
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Attempt log</h3>
              {data.attempts.length === 0 ? (
                <p>No attempts yet.</p>
              ) : (
                data.attempts.slice(0, 12).map((a, i) => (
                  <p key={i}>
                    {displayDate(a.at)} · {a.outcome.toUpperCase()} ·{" "}
                    {a.code.replaceAll("_", " ")}
                  </p>
                ))
              )}
              <h3>Order measurement jobs</h3>
              {data.measurementJobs.length ? (
                data.measurementJobs.map((j) => (
                  <p key={j.state}>
                    {j.state}: {j.count}
                  </p>
                ))
              ) : (
                <p>
                  No pending provider orders. Sample report rows are fixtures,
                  not live Shopify verification.
                </p>
              )}
            </section>
          </Tabs.Content>
        </Tabs.Root>
      )}
    </div>
  );
}
function ShowForm({
  show: s,
  busy,
  save,
}: {
  show?: Show;
  busy: boolean;
  save: (b: unknown) => Promise<void>;
}) {
  return (
    <details className="show-editor">
      <summary>{s ? s.title : "Create another show"}</summary>
      <form
        className="engagement-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({
            action: "show",
            ...Object.fromEntries(f),
            id: s?.id || crypto.randomUUID(),
            version: s?.version || null,
            published: f.get("published") === "on",
            starts_at: f.get("starts_at")
              ? new Date(String(f.get("starts_at")) + "Z").toISOString()
              : null,
          });
        }}
      >
        <label>
          Title
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={s?.title}
          />
        </label>
        <label>
          URL slug
          <input
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
            defaultValue={s?.slug}
          />
        </label>
        <label>
          Brand
          <select name="brand" defaultValue={s?.brand || "northside"}>
            <option value="northside">Northside collector show</option>
            <option value="hobby_key">HobbyKey vendor interest</option>
          </select>
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={2000}
            defaultValue={s?.description}
          />
        </label>
        <label>
          Date and time (optional, UTC)
          <input
            name="starts_at"
            type="datetime-local"
            defaultValue={s?.starts_at?.slice(0, 16) || ""}
          />
        </label>
        <label>
          Location (optional)
          <input
            name="location"
            maxLength={160}
            defaultValue={s?.location || ""}
          />
        </label>
        <label className="check-label">
          <input
            name="published"
            type="checkbox"
            defaultChecked={s?.published}
          />
          Publish this landing
        </label>
        <button className="button secondary" disabled={busy}>
          Save show
        </button>
      </form>
      {s && (
        <Link
          href={
            s.brand === "hobby_key"
              ? "/hobby-key/vendor-interest?show=" + s.slug
              : "/shows/" + s.slug
          }
        >
          View landing
        </Link>
      )}
    </details>
  );
}
