"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  serviceTermsSchema,
  trackingListSchema,
  type ServiceTerms,
  type TrackingList,
  type TrackingService,
} from "../../../packages/customer-contracts/src/tracking";
const when = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));
export function ServiceTermsPanel({
  service,
  fixture,
  actor = "a",
  staff = false,
}: {
  service: TrackingService;
  fixture: boolean;
  actor?: string;
  staff?: boolean;
}) {
  const endpoint = fixture
    ? `/api/preview/card-tracking?actor=${actor}`
    : "/api/private/card-tracking?";
  const query = `${endpoint}${endpoint.endsWith("?") ? "" : "&"}service=${service}${staff ? "&terms=1" : ""}`;
  const [state, setState] = useState<{
      key: string;
      terms: ServiceTerms;
      cards: TrackingList["cards"];
    } | null>(null),
    [error, setError] = useState(""),
    [busyKey, setBusyKey] = useState<{
      key: string;
      abort: AbortController;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [revision, setRevision] = useState(0);
  const key = `${query}:${revision}`;
  const scope = useRef({ epoch: 0, mutation: null as AbortController | null });
  useLayoutEffect(() => {
    const boundary = scope.current;
    boundary.epoch++;
    return () => {
      boundary.epoch++;
      boundary.mutation?.abort();
    };
  }, [key]);
  const busy = busyKey?.key === key && !busyKey.abort.signal.aborted;
  const reload = useCallback(() => {
    setState(null);
    setConfirmed(false);
    setRevision((n) => n + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch(query, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok)
          throw Error(
            r.status === 401
              ? "Sign in to review your service terms."
              : "Service terms are unavailable. Please try again.",
          );
        const parsed = staff
          ? { terms: serviceTermsSchema.parse(value), cards: [] }
          : trackingListSchema.parse(value);
        if (active) {
          setState({ key, terms: parsed.terms, cards: parsed.cards });
          setError("");
          setConfirmed(false);
        }
      })
      .catch(() => {
        if (active) {
          setState(null);
          setError(
            "Service terms could not be loaded. Refresh when connected.",
          );
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [query, key, staff]);
  const current = state?.key === key ? state : null;
  async function send(body: Record<string, unknown>) {
    const sentScope = scope.current.epoch,
      abort = new AbortController();
    scope.current.mutation = abort;
    setBusyKey({ key, abort });
    setError("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: abort.signal,
      });
      if (!r.ok) throw Error();
      if (scope.current.epoch === sentScope) reload();
    } catch {
      if (scope.current.epoch !== sentScope) return;
      setConfirmed(false);
      setState(null);
      setError(
        "The terms or account may have changed. Reload and review before trying again.",
      );
    } finally {
      if (scope.current.epoch === sentScope) setBusyKey(null);
    }
  }
  return (
    <section className="panel" aria-label={`${service} service terms`}>
      <h2>{service === "grading" ? "Grading" : "Consignment"} service terms</h2>
      {error && <p role="alert">{error}</p>}
      {!current && !error && <p role="status">Loading service terms…</p>}
      {current?.terms.current ? (
        <>
          <h3>{current.terms.current.title}</h3>
          <p>
            Version {current.terms.current.version} · Posted{" "}
            {when(current.terms.current.publishedAt)}
          </p>
          <p className="preserve-lines">{current.terms.current.body}</p>
          {!staff &&
            (current.terms.acceptedAt ? (
              <p role="status">
                Accepted {when(current.terms.acceptedAt)}. This unchanged
                version does not need another acceptance.
              </p>
            ) : (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I have read and accept this version of the {service} service
                  terms.
                </label>
                <button
                  className="button"
                  disabled={busy || !confirmed || !current.cards.length}
                  onClick={() => {
                    void send({
                      action: "accept-terms",
                      service,
                      terms_id: current.terms.current!.id,
                      card_id: current.cards[0].cardId,
                      confirmed: true,
                    });
                  }}
                >
                  Record my acceptance
                </button>
                {!current.cards.length && (
                  <p>
                    No linked {service} card is available for this acceptance
                    yet.
                  </p>
                )}
              </>
            ))}
        </>
      ) : (
        current && (
          <p>
            Service terms have not been configured. No acceptance has been
            recorded for an unavailable document.
          </p>
        )
      )}
      <p className="fine">
        Service terms are separate from approval of a particular grading quote
        and exam. This action does not submit cards, authorize a payment or
        confirm a provider update.
      </p>
      <button className="plain" disabled={busy} onClick={reload}>
        Reload service terms
      </button>
      {staff && (
        <details>
          <summary>
            Configure an approved terms version — owner/admin only
          </summary>
          <p>
            Use the exact approved text and version supplied by Brody and Nick.
            No legal terms are generated here. Existing versions and acceptances
            cannot be edited.
          </p>
          <form
            className="grading-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                action: "publish-terms",
                service,
                previous_id: current?.terms.current?.id ?? null,
                version: String(f.get("version")),
                title: String(f.get("title")),
                body: String(f.get("body")),
                approval_reference: String(f.get("approval_reference")),
              });
            }}
          >
            <label>
              Version
              <input name="version" maxLength={80} required disabled={busy} />
            </label>
            <label>
              Document title
              <input name="title" maxLength={200} required disabled={busy} />
            </label>
            <label>
              Approved customer-visible text
              <textarea
                name="body"
                maxLength={16000}
                required
                disabled={busy}
              />
            </label>
            <label>
              Business approval reference — staff only
              <input
                name="approval_reference"
                maxLength={1000}
                required
                disabled={busy}
              />
            </label>
            <label>
              <input type="checkbox" required disabled={busy} />I checked the
              supplied text, version and service.
            </label>
            <button className="button" disabled={busy || !current}>
              Save new terms version
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
