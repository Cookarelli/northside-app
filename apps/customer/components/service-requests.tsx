"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Info,
  LockKeyhole,
  MessageSquare,
  Send,
} from "lucide-react";
import { StaffNavigation } from "./staff-navigation";
import type {
  RequestConfig,
  ServiceRequestInput,
  ServiceRequestView,
} from "../../../packages/customer-contracts/src/service-requests";
import {
  requestSchema,
  requestStates,
} from "../../../packages/customer-contracts/src/service-requests";
import styles from "./service-requests.module.css";

const stateLabels: Record<string, string> = {
  new: "New",
  review: "Review",
  assigned: "Assigned",
  follow_up: "Follow-up",
  intake: "Intake recorded",
  in_progress: "In progress",
  completed: "Completed",
};
const roleLabels: Record<string, string> = {
  owner: "Store owner",
  admin: "Administrator",
  operations: "Operations staff",
};
const staffLabel = (role: string, id: string) =>
  `${roleLabels[role] ?? role} · ${id.slice(-8)}`;
function requestMessage(error: string) {
  if (["request terms changed", "request service level changed"].includes(error))
    return "Service details changed. Review the current options and terms before saving again.";
  if (error === "service unavailable")
    return "Service details are unavailable. Check your connection and try again.";
  if (error === "Failed to fetch")
    return "We couldn’t connect. Check your connection and try again.";
  if (error.includes("public service origin not configured"))
    return "Online requests aren’t ready for guest submissions. Sign in to your account, or contact Northside for help.";
  if (["sign in required", "session expired"].includes(error))
    return "Please sign in again to continue.";
  return error;
}

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code.replaceAll("_", " "));
  }
}
async function json(url: string, body?: unknown, signal?: AbortSignal) {
  const r = await fetch(url, {
    cache: "no-store",
    signal,
    credentials: url.startsWith("/api/public/") ? "omit" : "same-origin",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const v = await r.json();
  if (!r.ok)
    throw new RequestFailure(
      r.status,
      String(v.error ?? "service_unavailable"),
    );
  return v;
}
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const localDate = (value: string | null) =>
  value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export function ServiceRequestForm({
  fixture = false,
  staff = false,
}: {
  fixture?: boolean;
  staff?: boolean;
}) {
  const endpoint = fixture
    ? `/api/preview/service-requests?actor=${staff ? "staff" : "a"}`
    : "/api/private/service-requests";
  const [config, setConfig] = useState<RequestConfig | null>(null),
    [error, setError] = useState(""),
    [service, setService] = useState<"grading" | "consignment">("grading"),
    [kind, setKind] = useState("inquiry"),
    [provider, setProvider] = useState("PSA"),
    [delivery, setDelivery] = useState("planning_delivery"),
    [termsRevision, setTermsRevision] = useState(0),
    [receipt, setReceipt] = useState<{
      reference: string;
      id: string;
      next_steps: string;
      claim_code: string;
      requires_claim?: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [guest, setGuest] = useState(false),
    [frozen, setFrozen] = useState(false);
  const pending = useRef<ServiceRequestInput | null>(null),
    submitting = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    const abort = new AbortController();
    mounted.current = true;
    void json(
      endpoint + (fixture ? "&" : "?") + "config=1",
      undefined,
      abort.signal,
    )
      .catch((e) => {
        if (fixture || !(e instanceof RequestFailure) || e.status !== 401)
          throw e;
        setGuest(true);
        return json("/api/public/v1/service-requests", undefined, abort.signal);
      })
      .then((v) => {
        if (!abort.signal.aborted) setConfig(v);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [endpoint, fixture]);
  const term = config?.terms.find((t) => t.service === service);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    setError("");
    if (!pending.current) {
      const f = new FormData(e.currentTarget),
        s = (key: string) => String(f.get(key) ?? "").trim();
      const dollars = s("declared_value");
      if (dollars && !/^\d+(\.\d{1,2})?$/.test(dollars)) {
        setError(
          "Declared value must be dollars with at most two decimal places.",
        );
        return;
      }
      const cents = dollars
        ? Number(dollars.split(".")[0]) * 100 +
          Number((dollars.split(".")[1] ?? "").padEnd(2, "0"))
        : null;
      const input = {
        request_id: crypto.randomUUID(),
        claim_token: token(),
        kind,
        service,
        contact: { name: s("name"), email: s("email"), phone: s("phone") },
        details:
          kind === "inquiry"
            ? { question: s("question") }
            : service === "consignment"
              ? {
                  listing_count: Number(s("listing_count")),
                  delivery_method: delivery,
                  inbound_carrier: delivery === "shipped" ? s("carrier") : "",
                  inbound_tracking_number:
                    delivery === "shipped" ? s("tracking") : "",
                  instructions: s("instructions"),
                }
              : {
                  provider,
                  service_level_id: s("service_level") || null,
                  declared_value_cents: cents,
                  address: Object.fromEntries(
                    [
                      "line1",
                      "line2",
                      "city",
                      "region",
                      "postal_code",
                      "country",
                    ].map((k) => [k, s(k)]),
                  ),
                  instructions: s("instructions"),
                },
        terms_id: kind === "service_request" ? (term?.id ?? null) : null,
        terms_accepted: kind === "service_request" && f.get("terms") === "on",
      };
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) {
        setError(
          parsed.error.issues
            .map((i) => `${i.path.join(" ")}: ${i.message}`)
            .join(". "),
        );
        return;
      }
      pending.current = parsed.data;
      setFrozen(true);
    }
    submitting.current = true;
    setBusy(true);
    try {
      const v = await json(
        guest ? "/api/public/v1/service-requests" : endpoint,
        guest ? pending.current : { action: "submit", input: pending.current },
      );
      if (mounted.current)
        setReceipt({ ...v, claim_code: pending.current!.claim_token });
    } catch (e) {
      if (
        mounted.current &&
        e instanceof RequestFailure &&
        [400, 409].includes(e.status) &&
        ["invalid_service_request_fields", "request_terms_changed", "request_service_level_changed"].includes(e.code)
      ) {
        pending.current = null;
        setFrozen(false);
        setTermsRevision((n) => n + 1);
        setConfig(null);
        try {
          const c = await json(
            guest
              ? "/api/public/v1/service-requests"
              : endpoint + (fixture ? "&" : "?") + "config=1",
          );
          if (mounted.current) setConfig(c);
        } catch {
          /* Keep the explicit save error visible; no acknowledgment or automatic resubmission. */
        }
      }
      if (mounted.current)
        setError(
          !(e instanceof RequestFailure) || e.status >= 500 || e.code === "request_conflict"
            ? "Save unconfirmed. Retry the same request or contact Northside before starting another request."
            : e.message,
        );
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className={styles.page}>
      {staff ? (
        <StaffNavigation current="inquiry" />
      ) : (
        <Link className={styles.backLink} href="/my-cards/requests">
          <ArrowLeft size={17} aria-hidden="true" /> My service requests
        </Link>
      )}
      <div className={styles.lead}>
        <p className={styles.eyebrow}>
          {staff ? "STAFF · CUSTOMER FOLLOW-UP" : "NORTHSIDE CUSTOMER SERVICES"}
        </p>
        <h1>{staff ? "Record an inquiry" : "Let’s talk about your cards."}</h1>
        <p>
          {staff
            ? "Save a customer’s question in one place, ready for review and follow-up. Collectors submit service requests and accept terms through their own form."
            : "Ask a question or send a consignment or grading request for staff review. We’ll keep your request and its progress together."}
        </p>
      </div>
      {fixture && <p className={styles.notice}>SAMPLE local database only.</p>}
      {staff && guest && (
        <p className={styles.notice}>
          You are not signed in as staff. If guest submissions are available,
          this saves as a guest inquiry and does not verify staff identity.{" "}
          <Link href="/staff/login">
            Sign in with your invited staff account
          </Link>
          .
        </p>
      )}
      <p className={styles.inlineNotice}>
        <Info size={18} aria-hidden="true" /> Wait for Northside’s receiving
        instructions before sending cards. Do not send cards based on this form.
      </p>
      <div className={styles.formLayout}>
        <div className={styles.formMain}>
          {error && (
            <div className={styles.error} role="alert">
              <strong>Let’s check that.</strong>
              <p>{requestMessage(error)}</p>
              {guest && (
                <Link
                  href={
                    staff
                      ? "/staff/login"
                      : "/account?returnTo=%2Fservices%2Frequest"
                  }
                >
                  Continue to sign-in{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
          {receipt ? (
            <section
              className={`${styles.panel} ${styles.receipt}`}
              aria-live="polite"
            >
              <CheckCircle2 size={38} aria-hidden="true" />
              <p className={styles.eyebrow}>SAVED FOR NORTHSIDE REVIEW</p>
              <h2>
                {kind === "inquiry"
                  ? "Your inquiry is saved."
                  : "Your request is saved."}
              </h2>
              <p className={styles.fieldHint}>Your request reference</p>
              <p className={styles.reference}>{receipt.reference}</p>
              <p>{receipt.next_steps}</p>
              {(guest || receipt.requires_claim) && (
                <div className={styles.privateDetails}>
                  <h3>
                    <LockKeyhole size={17} aria-hidden="true" /> Keep your claim
                    details private
                  </h3>
                  <p>
                    Keep these details for verified sign-in and staff review.
                    They do not provide access to an account.
                  </p>
                  <p>
                    Request ID: <code>{receipt.id}</code>
                  </p>
                  <p>
                    Private claim code: <code>{receipt.claim_code}</code>
                  </p>
                </div>
              )}
              <Link
                className={styles.primaryLink}
                href={staff ? "/staff/requests" : "/my-cards/requests"}
              >
                {staff ? "Back to request queue" : "View my service requests"}
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </section>
          ) : (
            <form onSubmit={submit}>
              <fieldset className={styles.formFields} disabled={frozen || busy}>
                <legend className={styles.srOnly}>Request details</legend>
                <section
                  className={styles.panel}
                  aria-labelledby="request-start-title"
                >
                  <div className={styles.sectionHeading}>
                    <span className={styles.step} aria-hidden="true">
                      01
                    </span>
                    <div>
                      <h2 id="request-start-title">What can we help with?</h2>
                      <p>Choose a service and tell us what you need.</p>
                    </div>
                  </div>
                  <div className={styles.grid}>
                    <label>
                      Service
                      <select
                        value={service}
                        onChange={(e) =>
                          setService(e.target.value as typeof service)
                        }
                      >
                        <option value="grading">Grading</option>
                        <option value="consignment">Consignment</option>
                      </select>
                    </label>
                    <label>
                      Request type
                      <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                      >
                        <option value="inquiry">Ask a question</option>
                        {!staff && (
                          <option value="service_request">
                            Service request for staff review
                          </option>
                        )}
                      </select>
                    </label>
                  </div>
                  <p className={styles.fieldHint}>
                    {kind === "inquiry"
                      ? "A question starts a conversation. It does not authorize a service or record received cards."
                      : "Staff will review the request before any service or physical intake is confirmed."}
                  </p>
                </section>
                <section
                  className={styles.panel}
                  aria-labelledby="request-contact-title"
                >
                  <div className={styles.sectionHeading}>
                    <span className={styles.step} aria-hidden="true">
                      02
                    </span>
                    <div>
                      <h2 id="request-contact-title">
                        {staff ? "Customer contact" : "Your contact details"}
                      </h2>
                      <p>
                        All contact fields are required. Optional fields
                        elsewhere are marked.
                      </p>
                    </div>
                  </div>
                  <div className={styles.grid}>
                    <label className={styles.fullWidth}>
                      Full name
                      <input
                        name="name"
                        required
                        autoComplete="name"
                        maxLength={200}
                      />
                    </label>
                    <label>
                      Email
                      <input
                        name="email"
                        required
                        type="email"
                        autoComplete="email"
                        maxLength={254}
                      />
                    </label>
                    <label>
                      Phone
                      <input
                        name="phone"
                        required
                        type="tel"
                        autoComplete="tel"
                        maxLength={80}
                      />
                    </label>
                  </div>
                </section>
                <section
                  className={styles.panel}
                  aria-labelledby="request-details-title"
                >
                  <div className={styles.sectionHeading}>
                    <span className={styles.step} aria-hidden="true">
                      03
                    </span>
                    <div>
                      <h2 id="request-details-title">
                        {kind === "inquiry"
                          ? "Your question"
                          : service === "consignment"
                            ? "Consignment details"
                            : "Grading details"}
                      </h2>
                      <p>
                        {kind === "inquiry"
                          ? "Share the details that will help staff follow up."
                          : "Details are reviewed by Northside before anything is confirmed."}
                      </p>
                    </div>
                  </div>
                  {kind === "inquiry" ? (
                    <label>
                      Question
                      <textarea name="question" required maxLength={3000} />
                    </label>
                  ) : service === "consignment" ? (
                    <div className={styles.grid}>
                      <label>
                        Number of listings / lots
                        <input
                          name="listing_count"
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          required
                        />
                        <span className={styles.fieldHint}>
                          Enter a whole number greater than zero.
                        </span>
                      </label>
                      <label>
                        Delivery method
                        <select
                          value={delivery}
                          onChange={(e) => setDelivery(e.target.value)}
                        >
                          <option value="planning_delivery">
                            Planning delivery
                          </option>
                          <option value="already_dropped_off">
                            Already dropped off — staff will verify
                          </option>
                          <option value="shipped">Shipped</option>
                        </select>
                      </label>
                      {delivery === "shipped" && (
                        <>
                          <label>
                            Carrier (optional)
                            <input name="carrier" maxLength={200} />
                          </label>
                          <label>
                            Tracking (optional)
                            <input name="tracking" maxLength={200} />
                          </label>
                        </>
                      )}
                      <label className={styles.fullWidth}>
                        Special instructions (enter None if none)
                        <textarea
                          name="instructions"
                          required
                          maxLength={3000}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className={styles.grid}>
                      <label>
                        Provider preference
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                        >
                          <option>PSA</option>
                          <option>SGC</option>
                        </select>
                      </label>
                      <label>
                        Service level
                        <select name="service_level" key={provider}>
                          <option value="">
                            Staff review — details to be confirmed
                          </option>
                          {config?.serviceLevels
                            .filter((s) => s.provider === provider)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className={styles.fullWidth}>
                        Declared value (USD, optional pending review)
                        <input name="declared_value" inputMode="decimal" />
                        <span className={styles.fieldHint}>
                          This is your stated card value, not a service quote.
                        </span>
                      </label>
                      <div className={styles.fullWidth}>
                        <h3 className={styles.subheading}>Mailing address</h3>
                        <p className={styles.fieldHint}>
                          Enter your address manually, including the postal
                          code.
                        </p>
                      </div>
                      {[
                        "line1",
                        "line2",
                        "city",
                        "region",
                        "postal_code",
                        "country",
                      ].map((k) => (
                        <label
                          key={k}
                          className={
                            k === "line1" || k === "line2"
                              ? styles.fullWidth
                              : undefined
                          }
                        >
                          {
                            (
                              {
                                line1: "Mailing address",
                                line2: "Address line 2 (optional)",
                                city: "City",
                                region: "State / region",
                                postal_code: "Postal code",
                                country: "Country",
                              } as Record<string, string>
                            )[k]
                          }
                          <input
                            name={k}
                            autoComplete={
                              (
                                {
                                  line1: "address-line1",
                                  line2: "address-line2",
                                  city: "address-level2",
                                  region: "address-level1",
                                  postal_code: "postal-code",
                                  country: "country-name",
                                } as Record<string, string>
                              )[k]
                            }
                            required={k !== "line2"}
                            maxLength={k === "postal_code" ? 32 : 200}
                          />
                        </label>
                      ))}
                      <label className={styles.fullWidth}>
                        Instructions (optional)
                        <textarea name="instructions" maxLength={3000} />
                      </label>
                      <p className={`${styles.fieldHint} ${styles.fullWidth}`}>
                        Provider availability, prices and service details
                        require staff confirmation. Provider processing begins
                        at verified provider check-in.
                      </p>
                    </div>
                  )}
                </section>
                {kind === "service_request" && (
                  <section
                    className={styles.panel}
                    aria-labelledby="request-terms-title"
                  >
                    <div className={styles.sectionHeading}>
                      <span className={styles.step} aria-hidden="true">
                        04
                      </span>
                      <div>
                        <h2 id="request-terms-title">Review the terms</h2>
                        <p>
                          Read and accept the applicable terms before
                          submitting.
                        </p>
                      </div>
                    </div>
                    {term ? (
                      <>
                        <details className={styles.termDetails}>
                          <summary>
                            {term.title} — {term.version}
                          </summary>
                          <div className={styles.terms}>{term.body}</div>
                        </details>
                        <label className={styles.checkboxRow}>
                          <input
                            key={`${term.id}:${termsRevision}`}
                            name="terms"
                            type="checkbox"
                            required
                          />
                          <span>I accept these applicable terms.</span>
                        </label>
                      </>
                    ) : (
                      <p className={styles.notice} role="status">
                        Approved full terms are not available yet. You can
                        choose “Ask a question” while terms are being confirmed.
                      </p>
                    )}
                  </section>
                )}
              </fieldset>
              <div className={styles.submitBar}>
                <p>
                  <LockKeyhole size={17} aria-hidden="true" /> Save for staff
                  review. No payment or physical receipt is created.
                </p>
                <button
                  type="submit"
                  disabled={
                    busy || !config || (kind === "service_request" && !term)
                  }
                >
                  <Send size={17} aria-hidden="true" />
                  {busy
                    ? "Saving…"
                    : frozen
                      ? "Retry the same request"
                      : kind === "inquiry"
                        ? "Save inquiry"
                        : "Submit request"}
                </button>
              </div>
              {frozen && (
                <p className={styles.notice}>
                  If the save was not confirmed, retry here to use the same
                  request. Check saved requests before refreshing or leaving
                  this page.
                </p>
              )}
            </form>
          )}
        </div>
        <aside className={styles.sideCard} aria-label="Request guidance">
          <span className={styles.sideIcon}>
            <MessageSquare size={24} aria-hidden="true" />
          </span>
          <h2>What happens next?</h2>
          <ol className={styles.nextSteps}>
            <li>
              <strong>Save your reference</strong>
              <span>A saved request has its own NS reference.</span>
            </li>
            <li>
              <strong>Staff review & follow-up</strong>
              <span>
                Northside reviews the details before a service is confirmed.
              </span>
            </li>
            <li>
              <strong>Physical intake is separate</strong>
              <span>
                Cards are recorded as received only after staff verify their
                arrival.
              </span>
            </li>
          </ol>
          <div className={styles.location}>
            <Info size={19} aria-hidden="true" />
            <div>
              <strong>Before sending cards</strong>
              <p>
                6800 Forest Hills Road, Unit 3<br />
                Loves Park, Illinois
              </p>
              <p>
                Receiving ZIP and mail-in opening date await confirmation. Do
                not send cards based on this form.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

type QueueData = {
  can_edit?: boolean;
  requests: ServiceRequestView[];
  staff?: { id: string; role: string }[];
  claims?: {
    id: string;
    request_id: string;
    customer_id: string;
    status: string;
  }[];
  notes?: {
    request_id: string;
    note: string;
    reason: string;
    created_at: string;
  }[];
  outbox?: { id: string; state: string; attempts: number }[];
};

function SubmittedRequestDetails({
  request: r,
}: {
  request: ServiceRequestView;
}) {
  const labels: Record<string, string> = {
    question: "Question",
    listing_count: "Listings / lots",
    delivery_method: "Delivery method",
    inbound_carrier: "Carrier",
    inbound_tracking_number: "Tracking",
    instructions: "Instructions",
    provider: "Provider preference",
    service_level_id: "Service-level reference",
    declared_value_cents: "Declared value",
    address: "Mailing address",
  };
  function detailValue(key: string, value: unknown): string {
    if (value === null || value === "") return "Not provided";
    if (key === "delivery_method" && typeof value === "string")
      return (
        (
          {
            planning_delivery: "Planning delivery",
            already_dropped_off:
              "Customer reports dropped off — staff verification required",
            shipped: "Shipped",
          } as Record<string, string>
        )[value] ?? value
      );
    if (key === "declared_value_cents" && typeof value === "number")
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value / 100);
    if (key === "address" && typeof value === "object" && value) {
      const address = value as Record<string, unknown>;
      return ["line1", "line2", "city", "region", "postal_code", "country"]
        .map((k) => address[k])
        .filter((v) => typeof v === "string" && v)
        .join("\n");
    }
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "Not provided";
  }
  return (
    <>
      <dl className={styles.detailsGrid}>
        <div>
          <dt>Contact name</dt>
          <dd>{r.contact.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{r.contact.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{r.contact.phone}</dd>
        </div>
        {Object.entries(r.details).map(([key, value]) => (
          <div key={key}>
            <dt>{labels[key] ?? key.replaceAll("_", " ")}</dt>
            <dd>{detailValue(key, value)}</dd>
          </div>
        ))}
        {r.terms_version ? (
          <div>
            <dt>Accepted terms</dt>
            <dd>
              {r.terms_version}
              {r.terms_accepted_at ? ` · ${when(r.terms_accepted_at)}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      <details>
        <summary>Submission record</summary>
        <pre>
          {JSON.stringify(
            {
              contact: r.contact,
              details: r.details,
              source: r.source,
              terms_version: r.terms_version,
              terms_hash: r.terms_hash,
              accepted_at: r.terms_accepted_at,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </>
  );
}

export function ServiceRequestQueue({
  fixture = false,
  staff = false,
}: {
  fixture?: boolean;
  staff?: boolean;
}) {
  const endpoint = fixture
    ? `/api/preview/service-requests?actor=${staff ? "staff" : "a"}`
    : "/api/private/service-requests";
  const [data, setData] = useState<QueueData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(""),
    [stateFilter, setStateFilter] = useState(""),
    [ownerFilter, setOwnerFilter] = useState(""),
    [search, setSearch] = useState(""),
    [savedNotice, setSavedNotice] = useState(""),
    [overdue, setOverdue] = useState(false),
    [queueNow, setQueueNow] = useState(0);
  const generation = useRef({ epoch: 0 }),
    mutation = useRef(false);
  const load = useCallback(async () => {
    const g = ++generation.current.epoch;
    const v = await json(
      endpoint + (staff ? (fixture ? "&" : "?") + "staff=1" : ""),
    );
    if (g === generation.current.epoch) {
      setData(v);
      setQueueNow(Date.now());
    }
  }, [endpoint, staff, fixture]);
  useEffect(() => {
    const boundary = generation.current;
    void load().catch((e) => setError(e.message));
    const hide = () => {
      if (document.visibilityState === "hidden") {
        boundary.epoch++;
        setData(null);
        setSearch("");
        setSavedNotice("");
      } else void load().catch((e) => setError(e.message));
    };
    document.addEventListener("visibilitychange", hide);
    const clear = () => {
      boundary.epoch++;
      setData(null);
      setSearch("");
      setSavedNotice("");
    };
    const show = () =>
      void load().catch((e) => {
        setData(null);
        setError(e.message);
      });
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", show);
    return () => {
      boundary.epoch++;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", show);
    };
  }, [load]);
  async function send(body: Record<string, unknown>) {
    if (mutation.current) return;
    mutation.current = true;
    const g = generation.current.epoch;
    setBusy(true);
    setError("");
    setSavedNotice("");
    try {
      const result = await json(endpoint, body);
      if (g === generation.current.epoch) {
        await load();
        setSavedNotice(
          body.action === "test-outbox"
            ? `Test-sink pass complete: ${result.processed} job(s) processed. No real messages were sent.`
            : "Saved. The request is up to date.",
        );
      }
    } catch (e) {
      if (g === generation.current.epoch)
        setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  const form = (
    e: FormEvent<HTMLFormElement>,
    extra: Record<string, unknown>,
  ) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void send({ ...Object.fromEntries(f), ...extra });
  };
  const canEditRequests = staff && data?.can_edit === true;
  const query = search.trim().toLowerCase();
  const visibleRequests = (data?.requests ?? []).filter(
    (r) =>
      (!filter || r.service === filter || r.kind === filter) &&
      (!stateFilter || r.state === stateFilter) &&
      (!ownerFilter ||
        (ownerFilter === "unassigned"
          ? !r.staff_owner
          : r.staff_owner === ownerFilter)) &&
      (!query ||
        `${r.reference} ${r.contact.name} ${r.contact.email}`
          .toLowerCase()
          .includes(query)) &&
      (!overdue ||
        Boolean(
          r.follow_up_at &&
          Date.parse(r.follow_up_at) < queueNow &&
          r.state !== "completed",
        )),
  );
  function clearFilters() {
    setSearch("");
    setFilter("");
    setStateFilter("");
    setOwnerFilter("");
    setOverdue(false);
  }
  return (
    <section className={styles.page}>
      {staff ? (
        <StaffNavigation current="requests" />
      ) : (
        <Link className={styles.backLink} href="/my-cards/grading">
          <ArrowLeft size={17} aria-hidden="true" /> My Cards
        </Link>
      )}
      <div className={styles.queueHeader}>
        <div className={styles.lead}>
          <p className={styles.eyebrow}>
            {staff
              ? "STAFF SERVICE REQUEST QUEUE"
              : "MY CARDS · REQUEST HISTORY"}
          </p>
          <h1>{staff ? "Requests & follow-up" : "My service requests"}</h1>
          <p>
            {staff
              ? "Review inquiries, assign an owner and keep follow-up moving. Recording received cards is a separate step."
              : "Your questions, service requests and dated updates. Received cards and photos are kept in their own views."}
          </p>
        </div>
      </div>
      <div className={styles.row}>
        {(!staff || canEditRequests) && (
          <Link
            className={styles.mainAction}
            href={staff ? "/staff/requests/new" : "/services/request"}
          >
            <ClipboardList size={16} aria-hidden="true" />
            {staff ? "Record an inquiry" : "New service request"}
          </Link>
        )}
        <Link href={staff ? "/staff/grading" : "/my-cards/grading"}>
          Grading cards & photos
        </Link>
        <Link href={staff ? "/staff/consignment" : "/my-cards/consignment"}>
          Consignment cards
        </Link>
      </div>
      {fixture && <p>SAMPLE local database.</p>}
      {error && (
        <p className={styles.error} role="alert">
          {requestMessage(error)}{" "}
          <Link href={staff ? "/staff/login" : "/account?returnTo=%2Fmy-cards%2Frequests"}>Sign in</Link>
        </p>
      )}
      {savedNotice && (
        <p className={styles.savedNotice} role="status">
          {savedNotice}
        </p>
      )}
      {staff && data && !canEditRequests && (
        <p className={styles.notice}>
          Read-only workspace. You can view requests and history; changes
          require an operations, administrator or owner account.
        </p>
      )}
      {staff && (
        <>
          <div className={styles.filters}>
            <label>
              Search requests
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Reference, name or email"
                autoComplete="off"
              />
            </label>
            <label>
              Program
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All programs</option>
                <option value="grading">Grading</option>
                <option value="consignment">Consignment</option>
                <option value="inquiry">Questions only</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                {requestStates.map((state) => (
                  <option key={state} value={state}>
                    {stateLabels[state]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assigned to
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="">All owners</option>
                <option value="unassigned">Unassigned</option>
                {data?.staff?.map((person) => (
                  <option key={person.id} value={person.id}>
                    {staffLabel(person.role, person.id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.filterFooter}>
            <span>
              {data
                ? `${visibleRequests.length} request${visibleRequests.length === 1 ? "" : "s"} shown from the loaded queue`
                : "Loading requests…"}
            </span>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={overdue}
                onChange={(e) => setOverdue(e.target.checked)}
              />
              <span>Overdue follow-up only</span>
            </label>
            <button
              className={styles.quietButton}
              type="button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </div>
        </>
      )}
      {visibleRequests.map((r) => (
        <section className={styles.card} key={r.id} aria-label={r.reference}>
          <div className={styles.requestHeading}>
            <div>
              <h2>
                {r.service === "grading" ? "Grading" : "Consignment"}{" "}
                {r.kind === "inquiry" ? "inquiry" : "request"}
              </h2>
              <p className={styles.reference}>{r.reference}</p>
            </div>
            <span className={styles.status} data-state={r.state}>
              {stateLabels[r.state]}
            </span>
          </div>
          <div className={styles.meta}>
            <p>Saved {when(r.created_at)} · Central time</p>
            {staff ? (
              <p>
                Owner:{" "}
                {r.staff_owner
                  ? data?.staff?.find((person) => person.id === r.staff_owner)
                    ? staffLabel(
                        data.staff.find(
                          (person) => person.id === r.staff_owner,
                        )!.role,
                        r.staff_owner,
                      )
                    : `Assigned · ${r.staff_owner.slice(-8)}`
                  : "Unassigned"}
              </p>
            ) : null}
            {r.follow_up_at ? <p>Follow-up {when(r.follow_up_at)}</p> : null}
          </div>
          <p className={styles.receiptStatus}>
            <Info size={17} aria-hidden="true" />
            {r.received_at
              ? `Physical receipt recorded ${new Date(r.received_at).toISOString().slice(0, 10)}.`
              : "Physical receipt has not been recorded. Request review does not mark cards as received."}
          </p>
          <details>
            <summary>Contact, submitted details & terms</summary>
            <SubmittedRequestDetails request={r} />
          </details>
          <ol className={styles.history} aria-label="Request history">
            {r.history.map((h, i) => (
              <li key={i}>
                <time dateTime={h.created_at}>
                  {when(h.created_at)} · Central time
                </time>
                {h.message}
              </li>
            ))}
          </ol>
          {staff && (
            <>
              {canEditRequests && (
                <>
                  <form
                    key={`${r.id}-${r.version}`}
                    className={styles.editor}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        date = String(f.get("follow_up_at") ?? "");
                      void send({
                        action: "update",
                        id: r.id,
                        version: r.version,
                        state: f.get("state"),
                        staff_owner: f.get("staff_owner") || null,
                        follow_up_at: date
                          ? new Date(date).toISOString()
                          : null,
                        reason: f.get("reason"),
                        staff_note: f.get("staff_note"),
                        customer_message: f.get("customer_message"),
                      });
                    }}
                  >
                    <h3>Review & assignment</h3>
                    <p>
                      Update the request here. Card custody is managed in the
                      grading and consignment desks.
                    </p>
                    <div className={styles.grid}>
                      <label>
                        Request state
                        <select name="state" defaultValue={r.state}>
                          {requestStates.map((s) => (
                            <option key={s} value={s} disabled={s === "intake"}>
                              {stateLabels[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Staff owner
                        <select
                          name="staff_owner"
                          defaultValue={r.staff_owner ?? ""}
                        >
                          <option value="">Unassigned</option>
                          {r.staff_owner &&
                            !data?.staff?.some(
                              (person) => person.id === r.staff_owner,
                            ) && (
                              <option value={r.staff_owner}>
                                Current owner unavailable ·{" "}
                                {r.staff_owner.slice(-8)} (choose a new owner)
                              </option>
                            )}
                          {data?.staff?.map((s) => (
                            <option key={s.id} value={s.id}>
                              {staffLabel(s.role, s.id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Follow-up (your local time)
                        <input
                          key={r.follow_up_at ?? "unset"}
                          name="follow_up_at"
                          type="datetime-local"
                          defaultValue={localDate(r.follow_up_at)}
                        />
                      </label>
                      <label>
                        Reason (private)
                        <input name="reason" required maxLength={1000} />
                        <span className={styles.fieldHint}>
                          Required. Briefly explain why the request is changing.
                        </span>
                      </label>
                      <label>
                        Staff note (private)
                        <textarea name="staff_note" maxLength={3000} />
                        <span className={styles.fieldHint}>
                          Only authorized staff can see this note.
                        </span>
                      </label>
                      <label>
                        Customer-visible update
                        <textarea name="customer_message" maxLength={3000} />
                        <span className={styles.fieldHint}>
                          Appears in the customer’s dated request history.
                        </span>
                      </label>
                    </div>
                    <button disabled={busy}>Save request update</button>
                  </form>
                  {!r.intake_result && r.kind === "service_request" && (
                    <details>
                      <summary>
                        Record physical receipt and convert once
                      </summary>
                      <p>
                        Requires a verified linked customer. Listing quantity is
                        separate from the actual received card count.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void send({
                            ...Object.fromEntries(f),
                            action: "convert",
                            id: r.id,
                            version: r.version,
                            quantity: Number(f.get("quantity")),
                          });
                        }}
                      >
                        <div className={styles.grid}>
                          <label>
                            Actual cards received
                            <input
                              name="quantity"
                              type="number"
                              min="1"
                              max="50"
                              required
                            />
                          </label>
                          <label>
                            Receipt date
                            <input name="received_date" type="date" required />
                          </label>
                          <label>
                            Card description
                            <input
                              name="description"
                              required
                              maxLength={500}
                            />
                          </label>
                          <label>
                            Physical receipt evidence
                            <input
                              name="receipt_evidence"
                              required
                              maxLength={1000}
                            />
                          </label>
                          <label>
                            Reason
                            <input name="reason" required maxLength={1000} />
                          </label>
                        </div>
                        <button disabled={busy}>
                          Record receipt & create intake
                        </button>
                      </form>
                    </details>
                  )}
                </>
              )}
              {canEditRequests && <details>
                <summary>Private staff notes</summary>
                {data?.notes
                  ?.filter((n) => n.request_id === r.id)
                  .map((n, i) => (
                    <p className={styles.staffNote} key={i}>
                      {when(n.created_at)}: {n.reason} — {n.note}
                    </p>
                  ))}
              </details>}
            </>
          )}
        </section>
      ))}
      {data && !visibleRequests.length && (
        <div className={styles.empty}>
          <h2>
            {data.requests.length
              ? "No requests match these filters"
              : "No requests to show yet"}
          </h2>
          <p>
            {data.requests.length
              ? "Try another name, reference, status or owner."
              : "Saved requests will appear here. Received cards remain in the grading and consignment views."}
          </p>
          {staff && data.requests.length ? (
            <button
              className={styles.quietButton}
              type="button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      )}
      {!staff && (
        <section className={styles.card}>
          <h2>Claim a guest request</h2>
          <p>
            Sign-in verifies your account. Staff must separately verify your
            receipt and identity before linking the request. Matching email
            alone grants no access.
          </p>
          <form onSubmit={(e) => form(e, { action: "claim" })}>
            <label>
              Request ID
              <input name="id" required />
            </label>
            <label>
              Private claim code
              <input name="claim_token" autoComplete="off" required />
            </label>
            <button disabled={busy}>Request verified linking</button>
          </form>
        </section>
      )}
      {canEditRequests && (
        <section className={styles.supportTools}>
          <h2>Guest request linking</h2>
          <p>
            Review identity and receipt evidence before linking a guest request
            to a customer account.
          </p>
          {data?.claims
            ?.filter((c) => c.status === "pending")
            .map((c) => (
              <form
                className={styles.card}
                key={c.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void send({
                    ...Object.fromEntries(f),
                    action: "review-claim",
                    claim_id: c.id,
                    approved: f.get("decision") === "approve",
                  });
                }}
              >
                <p>
                  Request {c.request_id} · verified account {c.customer_id}
                </p>
                <label>
                  Independent identity / receipt evidence
                  <input
                    name="verification_reference"
                    required
                    maxLength={1000}
                  />
                </label>
                <label>
                  Private review reason
                  <input name="reason" required maxLength={1000} />
                </label>
                <label>
                  Decision
                  <select name="decision">
                    <option value="reject">Reject</option>
                    <option value="approve">Approve verified link</option>
                  </select>
                </label>
                <button disabled={busy}>Save claim review</button>
              </form>
            ))}
          <h2>Notification test sink</h2>
          <p>
            Real delivery is disabled.{" "}
            {data?.outbox?.filter((o) => o.state !== "test_delivered").length ??
              0}{" "}
            pending/failed jobs.
          </p>
          <button
            disabled={busy}
            onClick={() => void send({ action: "test-outbox" })}
          >
            Run a test-sink pass
          </button>
        </section>
      )}
    </section>
  );
}
