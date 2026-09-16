"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  gradingFields,
  examMoney,
  type GradingData,
  type GradingDetail,
  type ImportPreview,
} from "@/lib/grading";
type Body = Record<string, unknown>;
type Send = (body: Body) => Promise<Body | undefined>;
const date = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));
function Field({
  name,
  label,
  value = "",
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  value?: string | number;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={type === "text" ? 500 : undefined}
        step={type === "number" ? 1 : undefined}
      />
    </label>
  );
}
function Form({
  children,
  submit,
  onSubmit,
}: {
  children: ReactNode;
  submit: string;
  onSubmit: (data: Record<string, string>) => Promise<unknown>;
}) {
  return (
    <form
      className="grading-form"
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        await onSubmit(
          Object.fromEntries(new FormData(form)) as Record<string, string>,
        );
      }}
    >
      {children}
      <button className="button" type="submit">
        {submit}
      </button>
    </form>
  );
}
function Reason() {
  return (
    <Field
      name="reason"
      label="Reason / staff verification notes (private)"
      required
    />
  );
}
function StateSelect({
  data,
  value = "received",
}: {
  data: GradingData;
  value?: string;
}) {
  return (
    <label>
      Status
      <select name="status_key" defaultValue={value}>
        {data.states.map((s) => (
          <option key={s.key} value={s.key} disabled={!s.enabled}>
            {s.label}
            {s.enabled ? "" : " (disabled)"}
          </option>
        ))}
      </select>
    </label>
  );
}
const pages = [
  "Cards",
  "New intake",
  "Batches",
  "Imports",
  "Claims",
  "Settings",
] as const;
export function GradingWorkspace({
  fixture,
  staff,
}: {
  fixture: boolean;
  staff: boolean;
}) {
  const [who, setWho] = useState(staff ? "staff" : "a"),
    [data, setData] = useState<GradingData | null>(null),
    [detail, setDetail] = useState<GradingDetail | null>(null),
    [page, setPage] = useState<(typeof pages)[number]>("Cards"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const endpoint = fixture
    ? `/api/preview/grading?actor=${who}`
    : "/api/private/grading";
  const get = useCallback(
    async (extra = "") => {
      const r = await fetch(
        endpoint + (endpoint.includes("?") ? "&" : "?") + extra,
        { cache: "no-store" },
      );
      const v = await r.json();
      if (!r.ok)
        throw Error(
          String(v.error || "Records unavailable").replaceAll("_", " "),
        );
      return v;
    },
    [endpoint],
  );
  useEffect(() => {
    let active = true;
    get()
      .then((v) => {
        if (active) {
          setData(v);
          setDetail(null);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [get]);
  const select = async (id: string) => {
    try {
      setDetail(await get("card=" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const send: Send = async (body) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok)
        throw Error(String(v.error || "Unable to save").replaceAll("_", " "));
      setData(await get());
      if (detail) setDetail(await get("card=" + detail.card.card_id));
      setMessage("Saved" + (fixture ? " to this local sample database." : "."));
      return v;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    try {
      const v = await get("export=1");
      const url = URL.createObjectURL(new Blob([v.csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fixture ? "SAMPLE-grading-export.csv" : "grading-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const writer =
    !!data && ["owner", "admin", "operations"].includes(data.role || "");
  return (
    <div className="grading-workspace">
      <div className="intro">
        <p className="eyebrow">
          {staff ? "NORTHSIDE OPERATIONS" : "YOUR COLLECTION"}
        </p>
        <h1>{staff ? "Grading desk" : "Your grading cards"}</h1>
        <p>From examination to return, one clear record for every card.</p>
      </div>
      {fixture && (
        <aside className="grading-notice">
          <strong>LOCAL SAMPLE WORKSPACE</strong>
          <p>
            Fictional cards and accounts. Changes save on this Mac. Use sample
            information only.
          </p>
          {!staff && (
            <label>
              Sample account
              <select
                value={who}
                onChange={(e) => {
                  setWho(e.target.value);
                  setMessage("");
                }}
              >
                <option value="a">Sample collector A</option>
                <option value="b">Sample collector B</option>
              </select>
            </label>
          )}
          <Link href={staff ? "/my-cards/grading" : "/staff/grading"}>
            {staff ? "Open customer sample →" : "Open staff sample →"}
          </Link>
        </aside>
      )}
      {error && (
        <p className="grading-notice" role="alert">
          {error}.{" "}
          {!data && (
            <Link href={staff ? "/staff/login" : "/account"}>
              Open {staff ? "staff sign-in" : "account"}
            </Link>
          )}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Saving…" : message}
      </p>
      {!data && !error && <p>Loading saved records…</p>}
      {data && (
        <>
          <div className="grading-toolbar">
            {staff ? (
              <nav aria-label="Grading tools">
                {pages
                  .filter((p) => writer || p === "Cards")
                  .map((p) => (
                    <button
                      className={p === page ? "button" : "button secondary"}
                      key={p}
                      onClick={() => setPage(p)}
                      aria-current={p === page ? "page" : undefined}
                    >
                      {p}
                    </button>
                  ))}
              </nav>
            ) : (
              <p>Northside recorded updates · no provider feed connected</p>
            )}
            <button className="plain" onClick={download}>
              Export {fixture ? "sample " : ""}cards CSV
            </button>
          </div>
          <fieldset disabled={busy} className="grading-controls">
            {(!staff || page === "Cards") && (
              <>
                <div className="grading-columns">
                  <section>
                    <h2>
                      {staff ? "Card records" : "My cards"}{" "}
                      <small>({data.cards.length})</small>
                    </h2>
                    {!data.cards.length && (
                      <p>No grading cards are linked to this account yet.</p>
                    )}
                    {data.cards.map((c) => (
                      <button
                        className={
                          "grading-card " +
                          (detail?.card.card_id === c.card_id ? "selected" : "")
                        }
                        key={c.card_id}
                        onClick={() => select(c.card_id)}
                      >
                        <strong>{c.description}</strong>
                        <span>
                          {c.label}
                          {c.voided_at ? " · intake reversed" : ""}
                        </span>
                        <small>
                          Card {c.card_id.slice(-8)} ·{" "}
                          {examMoney(c.examination_cents)} examination
                        </small>
                      </button>
                    ))}
                    <p className="fine">
                      Showing up to 500 recent cards. Contact Northside if an
                      expected card is missing.
                    </p>
                  </section>
                  <section>
                    {detail ? (
                      <CardDetail
                        key={detail.card.card_id + ":" + detail.card.version}
                        detail={detail}
                        data={data}
                        send={send}
                        get={get}
                        fixture={fixture}
                        writer={writer}
                        reload={() => select(detail.card.card_id)}
                      />
                    ) : (
                      <div className="empty">
                        <h2>Select a card</h2>
                        <p>
                          Read findings, milestones and examination details.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
                {!staff && (
                  <section className="panel">
                    <h2>Link an intake receipt</h2>
                    <p>
                      Enter the private claim code on your receipt. Staff must
                      verify your receipt and identity before access is granted.
                    </p>
                    <Form
                      submit="Request staff review"
                      onSubmit={(v) =>
                        send({ action: "claim-request", code: v.code })
                      }
                    >
                      <Field name="code" label="Receipt claim code" required />
                    </Form>
                    {data.claims.map((c) => (
                      <p key={c.id}>
                        Claim {c.id.slice(-8)}: {c.status}
                      </p>
                    ))}
                  </section>
                )}
              </>
            )}
            {staff && writer && page === "New intake" && (
              <Intake data={data} send={send} />
            )}
            {staff && writer && page === "Batches" && (
              <Batches data={data} send={send} />
            )}
            {staff && writer && page === "Imports" && (
              <Imports data={data} send={send} get={get} />
            )}
            {staff && writer && page === "Claims" && (
              <section className="panel">
                <h2>Verify receipt claims</h2>
                <p>
                  Approve only after checking the original receipt and
                  independent identity evidence. An email match is insufficient.
                </p>
                {data.claims.length ? (
                  data.claims.map((c) => (
                    <article className="case" key={c.id}>
                      <p>Intake: {c.case_id}</p>
                      <p>
                        Verified account:{" "}
                        {
                          data.customers.find(
                            (x) => x.id === c.verified_customer_id,
                          )?.display_name
                        }{" "}
                        · {c.verified_customer_id}
                      </p>
                      <strong>{c.status}</strong>
                      {c.status === "pending" && (
                        <Form
                          submit="Record review"
                          onSubmit={(v) =>
                            send({
                              action: "claim-review",
                              id: c.id,
                              approve: v.decision === "approve",
                              evidence: v.evidence,
                              reason: v.reason,
                            })
                          }
                        >
                          <label>
                            Decision
                            <select name="decision">
                              <option value="deny">Deny access</option>
                              <option value="approve">
                                Approve verified claim
                              </option>
                            </select>
                          </label>
                          <label>
                            Independent evidence
                            <select name="evidence">
                              <option value="">Not verified</option>
                              <option value="receipt_and_in_person_identity">
                                Receipt + identity checked in person
                              </option>
                              <option value="receipt_and_verified_callback">
                                Receipt + independently verified callback
                              </option>
                            </select>
                          </label>
                          <Reason />
                        </Form>
                      )}
                    </article>
                  ))
                ) : (
                  <p>No receipt claims awaiting review.</p>
                )}
              </section>
            )}
            {staff && writer && page === "Settings" && (
              <Settings data={data} send={send} />
            )}
          </fieldset>
        </>
      )}
      <p className="fine">
        Examination is not a grading-company fee or a promise of a grade.
        Provider fees, shipping, insurance, tax and other charges remain
        separate and unquoted. No turnaround date is promised. Online pickup and
        all future in-store tools remain disabled.
      </p>
    </div>
  );
}
function Intake({ data, send }: { data: GradingData; send: Send }) {
  const [quantity, setQuantity] = useState(3),
    [request, setRequest] = useState(() => crypto.randomUUID());
  return (
    <div className="grading-columns">
      <section className="panel">
        <h2>New examination intake</h2>
        <Form
          submit="Save physical cards"
          onSubmit={async (v) => {
            const r = await send({
              action: "intake",
              request_id: request,
              reason: v.reason,
              input: { ...v, quantity: Number(v.quantity) },
            });
            if (r) setRequest(crypto.randomUUID());
            return r;
          }}
        >
          <label>
            Customer record
            <select name="customer_id" required defaultValue="">
              <option value="" disabled>
                Select exact customer
              </option>
              {data.customers.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.display_name} · {c.id.slice(-8)} ·{" "}
                  {c.verified ? "verified account" : "receipt claim required"}
                </option>
              ))}
            </select>
          </label>
          <Field name="description" label="Card description" required />
          <div className="grading-fields">
            {[
              ["sport", "Sport / category"],
              ["year", "Year"],
              ["manufacturer", "Manufacturer"],
              ["card_set", "Set"],
              ["card_number", "Card number"],
              ["parallel", "Parallel"],
            ].map(([name, label]) => (
              <Field name={name} label={label} key={name} />
            ))}
          </div>
          <label>
            Number of physical cards
            <input
              name="quantity"
              type="number"
              min="1"
              max="50"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </label>
          <div className="grading-notice">
            <strong>
              {quantity} × {examMoney(data.settings.examination_cents)} ={" "}
              {examMoney(quantity * data.settings.examination_cents)}
            </strong>
            <p>
              Examination subtotal only. Each physical card receives a unique
              ID.
            </p>
          </div>
          <Reason />
        </Form>
        <p className="fine">
          Open a saved card to add images, findings, customer notes or payment
          references.
        </p>
      </section>
      <section className="panel">
        <h2>Customer without an online account</h2>
        <p>
          Create a receipt contact first. This does not activate an account or
          grant online access.
        </p>
        <Form
          submit="Create receipt contact"
          onSubmit={(v) => send({ action: "contact", ...v })}
        >
          <Field name="display_name" label="Name on intake receipt" required />
          <Reason />
        </Form>
        <p>
          Then select this exact contact in the intake form. After saving, open
          a card to issue its private receipt claim code.
        </p>
      </section>
    </div>
  );
}
function CardDetail({
  detail,
  data,
  send,
  get,
  fixture,
  writer,
  reload,
}: {
  detail: GradingDetail;
  data: GradingData;
  send: Send;
  get: (extra: string) => Promise<Body>;
  fixture: boolean;
  writer: boolean;
  reload: () => Promise<void>;
}) {
  const c = detail.card,
    [code, setCode] = useState(""),
    [fileError, setFileError] = useState(""),
    [fileBusy, setFileBusy] = useState(false);
  const count = detail.intake_card_count,
    subtotal = count * c.examination_cents;
  return (
    <article className="panel grading-detail">
      <span className="badge">{c.label}</span>
      <h2>{c.description}</h2>
      <p>
        {[
          c.sport,
          c.year,
          c.manufacturer,
          c.card_set,
          c.card_number,
          c.parallel,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="fine">
        Permanent card ID: {c.card_id}
        <br />
        Intake ID: {c.case_id}
        <br />
        Updated {date(c.updated_at)} · Northside recorded
      </p>
      <div className="grading-notice">
        <strong>{examMoney(c.examination_cents)} examination per card</strong>
        <p>
          {count} physical {count === 1 ? "card" : "cards"} in this intake ·{" "}
          {examMoney(subtotal)} examination subtotal
          {c.voided_at ? " · reversed, not an active charge" : ""}
        </p>
        <small>External charges unquoted. No payment is implied.</small>
      </div>
      <h3>Examination findings</h3>
      <p className="preserve-lines">
        {c.findings || "Examination findings have not been recorded yet."}
      </p>
      <h3>Notes from Northside</h3>
      <p className="preserve-lines">
        {c.customer_notes || "No additional customer notes."}
      </p>
      {c.result && (
        <p>
          Recorded result: {c.result}
          {c.certificate ? " · certificate " + c.certificate : ""}
        </p>
      )}
      {!writer &&
        data.mode === "customer" &&
        c.status_key === "awaiting_decision" &&
        !c.voided_at && (
          <div className="grading-notice">
            <h3>Your decision</h3>
            <p>
              This records a request. It does not mean the grader has received
              your card, authorize an unquoted fee, or complete a physical
              return.
            </p>
            <div className="grading-toolbar">
              <button
                className="button"
                onClick={() =>
                  send({
                    action: "decision",
                    card_id: c.card_id,
                    version: c.version,
                    choice: "submit",
                    request_id: crypto.randomUUID(),
                  })
                }
              >
                Request submission
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  send({
                    action: "decision",
                    card_id: c.card_id,
                    version: c.version,
                    choice: "return",
                    request_id: crypto.randomUUID(),
                  })
                }
              >
                Request return
              </button>
            </div>
          </div>
        )}
      <h3>Card images / files</h3>
      {detail.files.map((f, i) => (
        <button
          className="plain"
          key={f.id}
          onClick={async () => {
            try {
              const result = await get("file=" + f.id);
              window.open(String(result.url), "_blank", "noopener,noreferrer");
            } catch (e) {
              setFileError((e as Error).message);
            }
          }}
        >
          Open {fixture ? "sample " : ""}file {i + 1} ↗
        </button>
      ))}
      {!detail.files.length && <p>No images attached.</p>}
      {writer &&
        !c.voided_at &&
        (fixture ? (
          <button
            className="button secondary"
            onClick={() => send({ action: "sample-image", card_id: c.card_id })}
          >
            Attach labeled sample image
          </button>
        ) : (
          <label>
            Add card image (PNG/JPEG/WebP, up to 5 MiB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={fileBusy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileBusy(true);
                try {
                  const response = await fetch(
                    `/api/private/cards/${c.card_id}/upload`,
                    {
                      method: "POST",
                      headers: { "Content-Type": file.type },
                      body: file,
                    },
                  );
                  if (!response.ok)
                    throw Error(
                      "Upload failed. Check file type, size and Storage configuration.",
                    );
                  await reload();
                  setFileError("");
                } catch (e) {
                  setFileError((e as Error).message);
                } finally {
                  setFileBusy(false);
                }
              }}
            />
          </label>
        ))}
      {fileError && <p role="alert">{fileError}</p>}
      <h3>Recorded history</h3>
      <ol className="timeline">
        {detail.events.map((e) => (
          <li key={e.id}>
            <div>
              <h3>{e.label}</h3>
              <p>{date(e.created_at)}</p>
              <small>
                {e.source === "customer"
                  ? "Authenticated customer request"
                  : e.source === "import"
                    ? "Northside CSV import"
                    : "Northside recorded"}{" "}
                · not provider verified
              </small>
            </div>
          </li>
        ))}
      </ol>
      <h3>Examination payment references</h3>
      {detail.payments.length ? (
        detail.payments.map((p) => (
          <p key={p.id}>
            {p.source === "shopify_order_link"
              ? "Linked Shopify order; examination allocation not verified"
              : `Staff-recorded external payment: ${examMoney(p.amount_cents || 0)}`}{" "}
            · {String(p.recorded_date).slice(0, 10)}
            {p.reference ? " · " + p.reference : ""}
          </p>
        ))
      ) : (
        <p>No payment reference recorded.</p>
      )}
      {writer && !c.voided_at && (
        <>
          <details>
            <summary>Edit status, findings or correction</summary>
            <Form
              submit="Save audited update"
              onSubmit={(v) =>
                send({
                  action: "update",
                  card_id: c.card_id,
                  version: c.version,
                  ...v,
                })
              }
            >
              <StateSelect data={data} value={c.status_key} />
              <label>
                Findings (customer visible)
                <textarea
                  name="findings"
                  maxLength={3000}
                  defaultValue={c.findings}
                />
              </label>
              <label>
                Notes (customer visible)
                <textarea
                  name="customer_notes"
                  maxLength={3000}
                  defaultValue={c.customer_notes}
                />
              </label>
              <Field
                name="result"
                label="Per-card result (Northside recorded)"
                value={c.result}
              />
              <Field
                name="certificate"
                label="Certificate / grader reference"
                value={c.certificate}
              />
              <Reason />
            </Form>
          </details>
          <details>
            <summary>Record examination payment reference</summary>
            <p>
              A reference is not a new Shopify sale. Existing references cannot
              be counted twice. External grading fees are excluded.
            </p>
            <Form
              submit="Save payment reference"
              onSubmit={(v) =>
                send({
                  action: "payment",
                  card_id: c.card_id,
                  ...v,
                  amount_cents: Number(v.amount_cents),
                })
              }
            >
              <label>
                Source
                <select name="source">
                  <option value="external_staff_record">
                    Staff-recorded external payment
                  </option>
                  <option value="shopify_order_link">
                    Existing verified Shopify order link
                  </option>
                </select>
              </label>
              <Field
                name="reference"
                label="External reference or Shopify Order GID"
                required
              />
              <Field
                name="recorded_date"
                label="Payment/reference date"
                type="date"
                required
              />
              <Field
                name="amount_cents"
                label="Examination amount in cents (external only)"
                type="number"
                value={subtotal}
              />
              <Reason />
            </Form>
          </details>
          <details>
            <summary>Issue receipt claim code</summary>
            <p>
              For a receipt contact without an activated account. Expires in
              seven days. Share on the original intake receipt; no email
              matching.
            </p>
            <Form
              submit="Issue new claim code"
              onSubmit={async (v) => {
                const r = await send({
                  action: "claim-code",
                  case_id: c.case_id,
                  ...v,
                });
                if (r) setCode(String(r.code));
                return r;
              }}
            >
              <Reason />
            </Form>
            {code && (
              <p className="grading-code">
                Private receipt code: <code>{code}</code>
              </p>
            )}
          </details>
        </>
      )}
    </article>
  );
}
function Batches({ data, send }: { data: GradingData; send: Send }) {
  const [chosen, setChosen] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    batch = data.batches.find((b) => b.id === chosen);
  return (
    <div className="grading-columns">
      <section className="panel">
        <h2>Shared submission batches</h2>
        <p>
          Batch references, tracking and other customers stay staff-only. Update
          selected cards to record a partial return or exception.
        </p>
        <label>
          Batch
          <select
            value={chosen}
            onChange={(e) => {
              setChosen(e.target.value);
              setSelected([]);
            }}
          >
            <option value="">Select a batch</option>
            {data.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.reference} ·{" "}
                {data.providers.find((p) => p.key === b.provider)?.label}
              </option>
            ))}
          </select>
        </label>
        {batch && (
          <>
            <Form
              submit="Save batch tracking"
              onSubmit={(v) =>
                send({
                  action: "batch",
                  operation: "tracking",
                  id: batch.id,
                  version: batch.version,
                  ...v,
                })
              }
            >
              <Field
                name="reference"
                label="Batch reference"
                value={batch.reference}
                required
              />
              <Field name="carrier" label="Carrier" value={batch.carrier} />
              <Field
                name="tracking"
                label="Tracking reference"
                value={batch.tracking}
              />
              <Reason />
            </Form>
            <h3>Cards in this batch or available to add</h3>
            {data.cards
              .filter(
                (c) => !c.voided_at && (!c.batch_id || c.batch_id === batch.id),
              )
              .map((c) => (
                <label className="grading-check" key={c.card_id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.card_id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, c.card_id]
                          : selected.filter((x) => x !== c.card_id),
                      )
                    }
                  />
                  <span>
                    {c.description} · {c.card_id.slice(-8)}
                    <small>
                      {
                        data.customers.find((x) => x.id === c.customer_id)
                          ?.display_name
                      }{" "}
                      · {c.label} ·{" "}
                      {c.batch_id ? "in batch" : "not yet assigned"}
                    </small>
                  </span>
                </label>
              ))}
            <Form
              submit={`Update ${selected.length} selected cards`}
              onSubmit={async (v) => {
                const r = await send({
                  action: "batch",
                  operation: "cards",
                  id: batch.id,
                  version: batch.version,
                  cards: selected.map((id) => ({
                    card_id: id,
                    version: data.cards.find((c) => c.card_id === id)!.version,
                  })),
                  assign: true,
                  ...v,
                });
                if (r) setSelected([]);
                return r;
              }}
            >
              <StateSelect data={data} />
              <Reason />
            </Form>
          </>
        )}
      </section>
      <section className="panel">
        <h2>Create a batch</h2>
        <Form
          submit="Create submission batch"
          onSubmit={async (v) => {
            const r = await send({
              action: "batch",
              operation: "create",
              ...v,
            });
            if (r) setChosen(String(r.id));
            return r;
          }}
        >
          <Field name="reference" label="New batch reference" required />
          <label>
            Provider (internal)
            <select name="provider">
              {data.providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.confirmed ? "" : " · unconfirmed"}
                </option>
              ))}
            </select>
          </label>
          <Field name="carrier" label="New batch carrier" />
          <Field name="tracking" label="New batch tracking" />
          <Reason />
        </Form>
      </section>
    </div>
  );
}
function Imports({
  data,
  send,
  get,
}: {
  data: GradingData;
  send: Send;
  get: (extra: string) => Promise<Body>;
}) {
  const [csv, setCsv] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<
      (ImportPreview & { status?: string }) | null
    >(null),
    [error, setError] = useState("");
  const load = async (file: File) => {
    if (file.size > 262144) {
      setError("CSV must be 256 KiB or smaller.");
      return;
    }
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    setError("");
    const { parse } = await import("csv-parse/browser/esm/sync");
    try {
      const rows = parse(text, {
        bom: true,
        skip_empty_lines: true,
        max_record_size: 10000,
      }) as string[][];
      const h = rows[0];
      if (!h?.length || new Set(h).size !== h.length) throw Error();
      setHeaders(h);
      setMapping(
        Object.fromEntries(
          gradingFields.map((k) => [k, h.includes(k) ? k : ""]),
        ),
      );
    } catch {
      setHeaders([]);
      setError("Unable to read CSV headers. Use the sample template.");
    }
  };
  return (
    <div className="grading-columns">
      <section className="panel">
        <h2>Reviewed CSV intake</h2>
        <p>
          Exact customer IDs only. Repeated external IDs are skipped; changed
          data is rejected. No email rematching.
        </p>
        <a href="/samples/grading-intake.csv" download>
          Download sanitized sample CSV
        </a>
        <label>
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        {headers.length > 0 && (
          <Form
            submit="Build import preview"
            onSubmit={async (v) => {
              const r = await send({
                action: "import-preview",
                csv,
                mapping,
                source: v.source,
              });
              if (r) setPreview(r as unknown as ImportPreview);
              return r;
            }}
          >
            <Field
              name="source"
              label="Stable source name (reuse for future imports)"
              value="sample-intake"
              required
            />
            {gradingFields.map((k) => (
              <label key={k}>
                {k.replaceAll("_", " ")}
                <select
                  value={mapping[k] || ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [k]: e.target.value })
                  }
                >
                  <option value="">
                    {[
                      "external_id",
                      "customer_id",
                      "description",
                      "quantity",
                    ].includes(k)
                      ? "Choose required column"
                      : "Leave blank"}
                  </option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </Form>
        )}
        {preview && (
          <section className="grading-import-review">
            <h3>Review {preview.source}</h3>
            <p>
              {preview.card_count} new physical cards ·{" "}
              {examMoney(preview.subtotal_cents)} examination subtotal
            </p>
            <div className="grading-table">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>External ID / customer</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td>
                        {r.external_id}
                        <br />
                        <small>{r.input?.customer_id}</small>
                        <br />
                        {r.input?.description}{" "}
                        {r.input ? "× " + r.input.quantity : ""}
                      </td>
                      <td>
                        {r.state}: {r.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(!preview.status || preview.status === "review") && (
              <Form
                submit="Confirm and commit import"
                onSubmit={async (v) => {
                  const r = await send({
                    action: "import-commit",
                    id: preview.id,
                    confirm: v.confirm === "on",
                    reason: v.reason,
                  });
                  if (r) setPreview({ ...preview, status: "committed" });
                  return r;
                }}
              >
                <label className="grading-check">
                  <input type="checkbox" name="confirm" required />
                  <span>
                    I reviewed every row, exact customer match and examination
                    subtotal.
                  </span>
                </label>
                <Reason />
              </Form>
            )}
            {preview.status && <p>Import status: {preview.status}</p>}
          </section>
        )}
      </section>
      <section className="panel">
        <h2>Saved import batches</h2>
        <p>
          Reversal preserves history and reserves external IDs. It is available
          only before later card updates, claims, payments, images or batching.
        </p>
        {data.imports.map((i) => (
          <details key={i.id}>
            <summary>
              {i.source} · {i.status} · {date(i.created_at)}
            </summary>
            <button
              className="plain"
              onClick={async () => {
                try {
                  setPreview(
                    (await get(
                      "import=" + i.id,
                    )) as unknown as ImportPreview & { status: string },
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Read saved preview
            </button>
            {i.status === "committed" && (
              <Form
                submit="Reverse untouched import"
                onSubmit={async (v) => {
                  const r = await send({
                    action: "import-reverse",
                    id: i.id,
                    confirm: v.confirm === "on",
                    reason: v.reason,
                  });
                  if (r && preview?.id === i.id)
                    setPreview({ ...preview, status: "reversed" });
                  return r;
                }}
              >
                <label className="grading-check">
                  <input type="checkbox" name="confirm" required />
                  <span>Reverse this batch, preserving its history.</span>
                </label>
                <Reason />
              </Form>
            )}
          </details>
        ))}
      </section>
    </div>
  );
}
function Settings({ data, send }: { data: GradingData; send: Send }) {
  if (!["owner", "admin"].includes(data.role || ""))
    return <p>Only an owner or admin can edit grading configuration.</p>;
  return (
    <div className="grading-columns">
      <section className="panel">
        <h2>Examination rate</h2>
        <p>
          Applies to future intakes only. Existing intake rates stay unchanged.
        </p>
        <Form
          submit="Save future examination rate"
          onSubmit={(v) =>
            send({
              action: "settings",
              kind: "rate",
              version: data.settings.version,
              examination_cents: Number(v.examination_cents),
              reason: v.reason,
            })
          }
        >
          <Field
            name="examination_cents"
            label="Examination rate in cents"
            type="number"
            value={data.settings.examination_cents}
          />
          <Reason />
        </Form>
        <h3>Provider configuration</h3>
        {data.providers.map((p) => (
          <p key={p.key}>
            {p.label} ·{" "}
            {p.confirmed ? "identity confirmed" : "internal, unconfirmed"} · no
            live feed
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>Operational status labels</h2>
        <p>
          Labels and availability are editable. Stable status codes preserve the
          decision workflow and past event wording.
        </p>
        {data.states.map((s) => (
          <details key={s.key + ":" + s.label + ":" + s.enabled}>
            <summary>
              {s.label}
              {s.enabled ? "" : " (disabled)"}
            </summary>
            <Form
              submit="Save status configuration"
              onSubmit={(v) =>
                send({
                  action: "settings",
                  kind: "state",
                  key: s.key,
                  label: v.label,
                  enabled: v.enabled === "yes",
                  reason: v.reason,
                })
              }
            >
              <Field
                name="label"
                label="Display label"
                value={s.label}
                required
              />
              <label>
                Availability
                <select name="enabled" defaultValue={s.enabled ? "yes" : "no"}>
                  <option value="yes">Enabled</option>
                  <option value="no">Disabled for new events</option>
                </select>
              </label>
              <Reason />
            </Form>
          </details>
        ))}
      </section>
    </div>
  );
}
