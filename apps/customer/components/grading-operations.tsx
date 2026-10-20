"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GradingCardScanner } from "./grading-card-scanner";
import { PhotoCapture, PhotoView } from "./northside-exam";
import { photoHelp, photoLabels, type PhotoKind } from "@/lib/exam";
import {
  gradingLabel,
  statusImportFields,
  type OperationsData,
  type BatchWorkspace,
  type OperationsCard,
  type ScannedCard,
  type ScanMethod,
  type StatusImportPreview,
} from "@/lib/grading-fulfillment";
type Body = Record<string, unknown>;
const when = (v: string) =>
  new Date(v).toLocaleString("en-US", { timeZone: "America/Chicago" });
function Input({
  name,
  label,
  value = "",
  required = false,
  type = "text",
}: {
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        defaultValue={value}
        required={required}
        type={type}
        maxLength={1000}
      />
    </label>
  );
}
function Reason() {
  return (
    <label>
      Reason and evidence (private)
      <textarea
        name="reason"
        required
        maxLength={1000}
        placeholder="What was verified or observed?"
      />
    </label>
  );
}
function Form({
  children,
  onSave,
  submit,
  disabled = false,
}: {
  children: ReactNode;
  onSave: (v: Record<string, string>) => Promise<unknown>;
  submit: string;
  disabled?: boolean;
}) {
  return (
    <form
      className="grading-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          Object.fromEntries(new FormData(e.currentTarget)) as Record<
            string,
            string
          >,
        );
      }}
    >
      <fieldset disabled={disabled}>
        {children}
        <button className="button" type="submit">
          {submit}
        </button>
      </fieldset>
    </form>
  );
}
const tabs = [
  "Batches",
  "Returns & milestones",
  "Pickup",
  "Spreadsheet updates",
  "Review & activity",
] as const;
export function GradingOperations({
  fixture,
  initialCard,
}: {
  fixture: boolean;
  initialCard?: string;
}) {
  const endpoint = fixture
    ? "/api/preview/grading/operations?actor=staff"
    : "/api/private/grading/operations";
  const [data, setData] = useState<OperationsData | null>(null),
    [tab, setTab] = useState<(typeof tabs)[number]>(
      initialCard ? "Returns & milestones" : "Batches",
    ),
    [batchId, setBatchId] = useState(""),
    [batch, setBatch] = useState<BatchWorkspace | null>(null),
    [cardId, setCardId] = useState(initialCard || ""),
    [card, setCard] = useState<OperationsCard | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Body | null>(null),
    [pickup, setPickup] = useState<(ScannedCard & { method: ScanMethod })[]>(
      [],
    );
  const get = useCallback(
    async (extra = "") => {
      const r = await fetch(
          endpoint + (endpoint.includes("?") ? "&" : "?") + extra,
          { cache: "no-store" },
        ),
        b = await r.json();
      if (!r.ok)
        throw Error(
          String(b.error || "Records unavailable").replaceAll("_", " "),
        );
      return b;
    },
    [endpoint],
  );
  const load = useCallback(async () => {
    setData(await get());
    if (batchId) setBatch(await get("batch=" + batchId));
    if (cardId) setCard(await get("card=" + cardId));
  }, [get, batchId, cardId]);
  useEffect(() => {
    let active = true;
    get()
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [get]);
  useEffect(() => {
    let active = true;
    if (!batchId) return;
    get("batch=" + batchId)
      .then((v) => {
        if (active) setBatch(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [batchId, get]);
  useEffect(() => {
    let active = true;
    if (!cardId) return;
    get("card=" + cardId)
      .then((v) => {
        if (active) setCard(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [cardId, get]);
  const post = async (b: Body) => {
    const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
        cache: "no-store",
      }),
      v = await r.json();
    if (!r.ok)
      throw Error(String(v.error || "Save not confirmed").replaceAll("_", " "));
    return v;
  };
  async function save(input: Body, retry = false) {
    if (busy) return;
    const b = retry ? input : { ...input, request_id: crypto.randomUUID() };
    setBusy(true);
    setPending(b);
    setError("");
    setNotice("");
    try {
      const result = await post(b);
      setPending(null);
      if (result.id && b.action === "batch_create") setBatchId(result.id);
      if (result.released) setPickup([]);
      await load();
      setNotice(
        (fixture ? "SAMPLE — " : "") +
          "Saved and confirmed." +
          (result.released
            ? " Recipient acknowledgment and released cards are preserved."
            : ""),
      );
      return result;
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Save not confirmed") +
          ". Review saved state before changing the request, or retry the same request.",
      );
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!pending,
    writer =
      !!data && ["owner", "admin", "operations"].includes(data.role || "");
  const cardEndpoint = (id: string) =>
    `${fixture ? "/api/preview" : "/api/private"}/grading/exam?card=${id}${fixture ? "&actor=staff" : ""}`;
  const exportUrl = (extra: string) =>
    endpoint + (endpoint.includes("?") ? "&" : "?") + extra;
  return (
    <div className="grading-workspace grading-operations">
      <div className="intro">
        <p className="eyebrow">STAFF GRADING OPERATIONS</p>
        <h1>From approved card to verified pickup</h1>
        <p>
          Scan physical cards, preserve the dispatched evidence, record actual
          returns and verify each release.
        </p>
        <Link href="/staff/grading">
          ← Intake, exams, quotes & payment references
        </Link>
      </div>
      {fixture && (
        <div className="grading-notice">
          <strong>SAMPLE workspace</strong>
          <p>
            Local fictional records only. Notifications remain UNSENT. No
            grading-company feed is connected.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="grading-notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="grading-notice">
          {notice}
        </p>
      )}
      {pending && (
        <div className="grading-notice">
          <p>
            The last request needs review. Retrying uses the original reference
            and exact card list.
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void save(pending, true)}
            >
              Retry same request
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await load();
                  setPending(null);
                  setError("");
                  setPickup([]);
                  setNotice(
                    "Latest saved state loaded. Recheck cards before another action.",
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Reload failed");
                }
              }}
            >
              Review saved state
            </button>
          </div>
        </div>
      )}
      {!data ? (
        <p>
          {error
            ? "Sign in with an invited staff account to access operations."
            : "Loading saved operations…"}{" "}
          <Link href="/staff/login">Staff sign-in</Link>
        </p>
      ) : (
        <>
          {!writer && (
            <p>Read-only staff access. Changes require an operations role.</p>
          )}
          <nav className="grading-tabs" aria-label="Grading operations">
            {tabs.map((t) => (
              <button
                className={tab === t ? "active" : ""}
                aria-pressed={tab === t}
                key={t}
                disabled={locked}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {tab === "Batches" && (
            <div className="grading-columns">
              <section className="panel">
                <h2>Submission batches</h2>
                <label>
                  Choose submission batch
                  <select
                    value={batchId}
                    disabled={locked}
                    onChange={(e) => {
                      setBatch(null);
                      setBatchId(e.target.value);
                    }}
                  >
                    <option value="">Select a batch</option>
                    {data.batches.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.reference} · {b.phase}
                      </option>
                    ))}
                  </select>
                </label>
                {batch && (
                  <>
                    <h3>{batch.batch.reference}</h3>
                    <p>
                      {
                        data.providers.find(
                          (p) => p.key === batch.batch.provider,
                        )?.label
                      }{" "}
                      · {batch.batch.service || "Service not configured"} ·{" "}
                      {batch.batch.phase.replaceAll("_", " ")}
                    </p>
                    {writer && (
                      <Form
                        key={batch.batch.id + ":" + batch.batch.version}
                        disabled={locked}
                        submit="Save submission tracking"
                        onSave={(v) =>
                          save({
                            action: "batch_tracking",
                            id: batch.batch.id,
                            version: batch.batch.version,
                            ...v,
                          })
                        }
                      >
                        <Input
                          name="reference"
                          label="Submission reference"
                          value={batch.batch.reference}
                          required
                        />
                        <Input
                          name="carrier"
                          label="Carrier"
                          value={batch.batch.carrier}
                        />
                        <Input
                          name="tracking"
                          label="Carrier tracking"
                          value={batch.batch.tracking}
                        />
                        <label>
                          Provider service
                          <input
                            name="service"
                            defaultValue={batch.batch.service}
                            readOnly={batch.batch.phase !== "draft"}
                            required
                          />
                        </label>
                        <Reason />
                      </Form>
                    )}
                    {writer && batch.batch.phase === "draft" && (
                      <GradingCardScanner
                        disabled={locked}
                        onScan={async (code, method) => {
                          await save({
                            action: "scan_batch",
                            batch_id: batch.batch.id,
                            batch_version: batch.batch.version,
                            code,
                            method,
                            reason:
                              "Physical Northside label checked while staging submission",
                          });
                        }}
                      />
                    )}
                    <h3>Individual cards ({batch.cards.length})</h3>
                    {!batch.cards.length && (
                      <p>
                        Scan approved, ready cards into this batch. Different
                        collectors can share one submission.
                      </p>
                    )}
                    <ul className="grading-operation-list">
                      {batch.cards.map((c) => (
                        <li key={c.card_id}>
                          <strong>{c.description}</strong>
                          <p>
                            {c.collector_name} · {c.label} · physically{" "}
                            {c.custody === "grader"
                              ? "with grader"
                              : c.custody === "released"
                                ? "released"
                                : "at Northside"}
                          </p>
                          <small>{c.card_id}</small>
                          <p>
                            {c.scan_id
                              ? "Label checked"
                              : "No active staging scan"}{" "}
                            ·{" "}
                            {c.approval_current
                              ? "Approval current"
                              : "Approval missing or changed"}
                          </p>
                          <Link
                            href={"/staff/grading/operations?card=" + c.card_id}
                          >
                            Card operations
                          </Link>
                          {writer && batch.batch.phase === "draft" && (
                            <Form
                              disabled={locked}
                              submit="Remove from open batch"
                              onSave={(v) =>
                                save({
                                  action: "remove_batch_card",
                                  batch_id: batch.batch.id,
                                  batch_version: batch.batch.version,
                                  card_id: c.card_id,
                                  ...v,
                                })
                              }
                            >
                              <Reason />
                            </Form>
                          )}
                        </li>
                      ))}
                    </ul>
                    {writer && batch.batch.phase === "draft" && (
                      <>
                        <Form
                          disabled={locked || !batch.cards.length}
                          submit="Revalidate approval & confirm dispatch"
                          onSave={(v) =>
                            save({
                              action: "dispatch",
                              batch_id: batch.batch.id,
                              batch_version: batch.batch.version,
                              cards: batch.cards.map((c) => ({
                                card_id: c.card_id,
                                version: c.version,
                              })),
                              confirmed: v.confirmed === "on",
                              reason: v.reason,
                            })
                          }
                        >
                          <p>
                            Dispatch preserves every card above with its
                            approved exam, quote and collector. The server
                            checks all approvals and scans again.
                          </p>
                          <label className="grading-check">
                            <input type="checkbox" name="confirmed" required />I
                            verified this exact physical card list and am
                            recording the handoff to the carrier.
                          </label>
                          <Reason />
                        </Form>
                        <details>
                          <summary>Cancel before dispatch</summary>
                          <Form
                            disabled={locked}
                            submit="Cancel this unshipped batch"
                            onSave={(v) =>
                              save({
                                action: "cancel_batch",
                                batch_id: batch.batch.id,
                                batch_version: batch.batch.version,
                                ...v,
                              })
                            }
                          >
                            <p>
                              Cards remain received records and are removed from
                              this open submission.
                            </p>
                            <Reason />
                          </Form>
                        </details>
                      </>
                    )}
                    {batch.dispatch && (
                      <div className="grading-notice">
                        <h3>Preserved dispatched manifest</h3>
                        <p>
                          {when(batch.dispatch.dispatched_at)} · Staff{" "}
                          {batch.dispatch.staff_id}
                        </p>
                        <p>
                          {batch.dispatch.reference} · {batch.dispatch.service}{" "}
                          · {batch.dispatch.carrier} {batch.dispatch.tracking}
                        </p>
                        <p>
                          {batch.manifest.length} cards. Later tracking changes
                          do not rewrite this record.
                        </p>
                        <a
                          className="button secondary"
                          href={exportUrl("manifest=" + batch.batch.id)}
                        >
                          Download staff manifest CSV
                        </a>
                      </div>
                    )}
                    {batch.batch.phase === "legacy_dispatched" && (
                      <p>
                        Historical dispatch. No new verified manifest is
                        fabricated for an earlier shipment.
                      </p>
                    )}
                  </>
                )}
              </section>
              <section className="panel">
                <h2>New outbound submission</h2>
                {writer && (
                  <Form
                    disabled={locked}
                    submit="Create submission batch"
                    onSave={(v) => save({ action: "batch_create", ...v })}
                  >
                    <Input
                      name="reference"
                      label="New submission reference"
                      required
                    />
                    <label>
                      Confirmed provider
                      <select name="provider">
                        {data.providers
                          .filter((p) => p.confirmed)
                          .map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Input
                      name="service"
                      label="Exact approved provider service"
                      required
                    />
                    <Input
                      name="carrier"
                      label="Carrier (required before dispatch)"
                    />
                    <Input
                      name="tracking"
                      label="Tracking (required before dispatch)"
                    />
                    <Reason />
                  </Form>
                )}
                <p>
                  External fees come from each card’s customer-approved quote.
                  No provider rate or service is assumed.
                </p>
                <h3>Card labels</h3>
                <p>
                  Open a card under Returns & milestones to download its stable
                  label. Apply labels to the protective holder, never directly
                  to a collectible.
                </p>
              </section>
            </div>
          )}
          {tab === "Returns & milestones" && (
            <>
              <section className="panel">
                <h2>Find the individual physical card</h2>
                <GradingCardScanner
                  disabled={locked}
                  onScan={async (code) => {
                    const r = await post({ action: "scan_card", code });
                    setCardId(r.card.card_id);
                  }}
                />
                <label>
                  Or select a saved card
                  <select
                    value={cardId}
                    disabled={locked}
                    onChange={(e) => {
                      setCard(null);
                      setCardId(e.target.value);
                    }}
                  >
                    <option value="">Choose a card</option>
                    {data.cards
                      .filter((c) => !c.voided_at)
                      .map((c) => (
                        <option key={c.card_id} value={c.card_id}>
                          {c.description} · {c.card_id.slice(-8)} · {c.label}
                        </option>
                      ))}
                  </select>
                </label>
              </section>
              {card && (
                <>
                  <section className="panel">
                    <h2>{card.card.description}</h2>
                    <p>
                      {card.card.collector_name} · {card.card.label} ·{" "}
                      {card.card.custody === "grader"
                        ? "With external grader"
                        : card.card.custody === "released"
                          ? "Released"
                          : "At Northside"}
                    </p>
                    <p className="small">{card.card.card_id}</p>
                    <div className="actions">
                      <a
                        className="button secondary"
                        href={exportUrl("label=" + card.card.card_id)}
                      >
                        Download individual card label
                      </a>
                      <Link
                        className="button secondary"
                        href={"/staff/grading/exam/" + card.card.card_id}
                      >
                        Original photos & Northside Exam
                      </Link>
                    </div>
                    <p className="small">
                      Northside’s original estimate stays in the signed exam. An
                      external result never replaces it.
                    </p>
                    {writer && card.card.custody !== "released" && (
                      <Form
                        disabled={locked}
                        submit="Save evidenced milestone"
                        onSave={(v) =>
                          save({
                            action: "milestone",
                            cards: [
                              {
                                card_id: card.card.card_id,
                                version: card.card.version,
                              },
                            ],
                            ...v,
                          })
                        }
                      >
                        <label>
                          Observed milestone
                          <select
                            name="status_key"
                            defaultValue={
                              [
                                "sent_to_grader",
                                "returned",
                                "completed",
                              ].includes(card.card.status_key)
                                ? "on_hold"
                                : card.card.status_key
                            }
                          >
                            {data.states
                              .filter(
                                (s) =>
                                  s.enabled &&
                                  ![
                                    "sent_to_grader",
                                    "returned",
                                    "completed",
                                  ].includes(s.key),
                              )
                              .map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <p>
                          Holds and exceptions keep the physical location.
                          Shipment, receipt and release use their dedicated
                          checks.
                        </p>
                        <Reason />
                      </Form>
                    )}
                    {writer &&
                      ["grader", "northside"].includes(card.card.custody) &&
                      [
                        "sent_to_grader",
                        "grader_received",
                        "grading",
                        "returned",
                        "ready_for_pickup",
                      ].includes(card.card.last_milestone) && (
                        <Form
                          key={
                            "return-" +
                            card.card.card_id +
                            "-" +
                            card.card.version
                          }
                          disabled={locked}
                          submit={
                            card.card.custody === "grader"
                              ? "Record this card’s physical return"
                              : "Save corrected external outcome"
                          }
                          onSave={(v) =>
                            save({
                              action: "return_card",
                              card_id: card.card.card_id,
                              version: card.card.version,
                              ...v,
                              physically_received:
                                v.physically_received === "on",
                            })
                          }
                        >
                          <h3>Actual external outcome</h3>
                          <label>
                            Outcome
                            <select
                              name="result_kind"
                              defaultValue={card.card.result_kind || ""}
                              required
                            >
                              <option value="">
                                Choose actual grade or no grade
                              </option>
                              <option value="graded">Graded</option>
                              <option value="no_grade">No grade issued</option>
                            </select>
                          </label>
                          <Input
                            name="result"
                            label="Actual grade, or external no-grade reason"
                            value={card.card.result}
                            required
                          />
                          <Input
                            name="certificate"
                            label="Certificate number (if available)"
                            value={card.card.certificate}
                          />
                          <label className="grading-check">
                            <input
                              type="checkbox"
                              name="physically_received"
                              required
                            />
                            I checked this physical card back at Northside and
                            its actual grader outcome.
                          </label>
                          <Reason />
                        </Form>
                      )}
                  </section>
                  {card.card.custody === "northside" &&
                    ["returned", "ready_for_pickup"].includes(
                      card.card.last_milestone,
                    ) && (
                      <section className="panel">
                        <h2>Returned card photographs</h2>
                        <p>
                          Confirm returned front and back photos before Ready
                          for pickup. These are separate from intake/exam
                          photos.
                        </p>
                        <p className="small">{photoHelp}</p>
                        <div className="exam-photo-grid">
                          {(
                            [
                              "returned_front",
                              "returned_back",
                              "returned_closeup",
                            ] as PhotoKind[]
                          ).map((kind) => (
                            <section className="exam-photo-slot" key={kind}>
                              <h3>
                                {photoLabels[kind]}
                                {kind === "returned_closeup"
                                  ? " · optional"
                                  : " · required"}
                              </h3>
                              {card.photos
                                .filter((p) => p.kind === kind)
                                .map((p) => (
                                  <PhotoView
                                    key={p.id}
                                    photo={p}
                                    endpoint={cardEndpoint(card.card.card_id)}
                                  />
                                ))}
                              {writer && (
                                <PhotoCapture
                                  kind={kind}
                                  endpoint={cardEndpoint(card.card.card_id)}
                                  locked={locked}
                                  onBusy={setBusy}
                                  onSaved={load}
                                />
                              )}
                            </section>
                          ))}
                        </div>
                      </section>
                    )}
                  <section className="panel">
                    <h2>Actual outcome revisions</h2>
                    {card.outcomes.length ? (
                      card.outcomes.map((o) => (
                        <article key={o.revision}>
                          <h3>
                            Revision {o.revision} ·{" "}
                            {o.kind === "no_grade" ? "No grade" : o.result}
                          </h3>
                          <p>
                            {o.result}
                            {o.certificate
                              ? " · Certificate " + o.certificate
                              : ""}
                          </p>
                          <p>
                            {when(o.created_at)} · {o.source} · Staff{" "}
                            {o.staff_id}
                          </p>
                          <p>Reason: {o.reason}</p>
                        </article>
                      ))
                    ) : (
                      <p>
                        No structured actual outcome recorded. Existing legacy
                        text is preserved above.
                      </p>
                    )}
                    <details>
                      <summary>Staff audit history</summary>
                      <ul className="grading-operation-list">
                        {card.audit.map((a, i) => (
                          <li key={i}>
                            {when(a.created_at)} · {a.action} · {a.source}
                            <p>Actor: {a.staff_id || a.customer_actor_id}</p>
                            <p>{a.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </section>
                </>
              )}
            </>
          )}
          {tab === "Pickup" && (
            <div className="grading-columns">
              <section className="panel">
                <h2>Scan each card being released</h2>
                <p>
                  Only the scanned cards will be released. Leave remaining cards
                  for another pickup. Verify the person and any representative
                  authorization independently.
                </p>
                {writer && (
                  <GradingCardScanner
                    disabled={locked}
                    onScan={async (code, method) => {
                      const c = (await post({ action: "scan_card", code }))
                        .card as ScannedCard;
                      if (
                        c.custody !== "northside" ||
                        c.status_key !== "ready_for_pickup"
                      )
                        throw Error(
                          "This card is not physically ready for pickup.",
                        );
                      if (pickup.some((p) => p.card_id === c.card_id))
                        throw Error("Already scanned for this pickup.");
                      if (
                        pickup.length &&
                        pickup[0].collector_id !== c.collector_id
                      )
                        throw Error(
                          "Complete a separate pickup for each collector.",
                        );
                      setPickup((p) => [...p, { ...c, method }]);
                    }}
                  />
                )}
                <ul className="grading-operation-list">
                  {pickup.map((c) => (
                    <li key={c.card_id}>
                      <strong>{c.description}</strong>
                      <p>
                        {c.collector_name} · {c.card_id} · {c.method}
                      </p>
                      <button
                        className="button secondary"
                        disabled={locked}
                        onClick={() =>
                          setPickup((p) =>
                            p.filter((x) => x.card_id !== c.card_id),
                          )
                        }
                      >
                        Leave this card for later
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel">
                <h2>Verify recipient & acknowledge receipt</h2>
                <p>
                  A QR code, email address or typed name alone does not
                  establish ownership. Do not retain identity-document numbers
                  or images in these notes.
                </p>
                {writer && (
                  <Form
                    disabled={locked || !pickup.length}
                    submit={`Confirm release of ${pickup.length} scanned cards`}
                    onSave={(v) =>
                      save({
                        action: "release",
                        customer_id: pickup[0]?.collector_id,
                        cards: pickup.map((c) => ({
                          card_id: c.card_id,
                          version: c.version,
                          method: c.method,
                          code: gradingLabel(c.card_id),
                        })),
                        ...v,
                        identity_verified: v.identity_verified === "on",
                        recipient_acknowledged:
                          v.recipient_acknowledged === "on",
                      })
                    }
                  >
                    <p>
                      Collector:{" "}
                      <strong>
                        {pickup[0]?.collector_name || "Scan a ready card first"}
                      </strong>
                    </p>
                    <label>
                      Recipient
                      <select name="recipient_kind">
                        <option value="collector">Collector</option>
                        <option value="representative">
                          Authorized representative
                        </option>
                      </select>
                    </label>
                    <Input
                      name="recipient_name"
                      label="Recipient’s full name"
                      required
                    />
                    <label>
                      Independent identity check
                      <select name="verification_method">
                        <option value="photo_id_in_person">
                          Photo ID checked in person
                        </option>
                        <option value="verified_account_and_receipt">
                          Verified account and intake receipt
                        </option>
                        <option value="independent_callback_and_receipt">
                          Independent callback and intake receipt
                        </option>
                      </select>
                    </label>
                    <Input
                      name="verification_evidence"
                      label="How identity and collector record were verified (no ID numbers)"
                      required
                    />
                    <Input
                      name="authorization_evidence"
                      label="Collector’s authorization evidence (required for a representative)"
                    />
                    <label className="grading-check">
                      <input
                        type="checkbox"
                        name="identity_verified"
                        required
                      />
                      I independently verified this recipient and their
                      authority to collect these cards.
                    </label>
                    <Input
                      name="acknowledgment"
                      label="Recipient acknowledgment (recipient enters their name and confirms the selected cards received)"
                      required
                    />
                    <label className="grading-check">
                      <input
                        type="checkbox"
                        name="recipient_acknowledged"
                        required
                      />
                      The recipient reviewed this exact card list and
                      acknowledged receiving it.
                    </label>
                    <Reason />
                  </Form>
                )}
              </section>
            </div>
          )}
          {tab === "Spreadsheet updates" && (
            <StatusImports
              endpoint={endpoint}
              data={data}
              disabled={locked || !writer}
              reload={load}
            />
          )}
          {tab === "Review & activity" && (
            <>
              <section className="panel">
                <h2>Post-dispatch withdrawal review</h2>
                <p>
                  These requests never cancel a shipment automatically. Record
                  actual contact and evidence; no provider integration is
                  implied.
                </p>
                {!data.withdrawals.length ? (
                  <p>No withdrawal requests.</p>
                ) : (
                  data.withdrawals.map((w) => (
                    <article className="grading-notice" key={w.id}>
                      <p>
                        Card {w.card_id} · {when(w.created_at)} ·{" "}
                        {w.resolution.replaceAll("_", " ")}
                      </p>
                      {writer && (
                        <Form
                          disabled={locked}
                          submit="Save staff review"
                          onSave={(v) =>
                            save({
                              action: "withdrawal_review",
                              withdrawal_id: w.id,
                              ...v,
                            })
                          }
                        >
                          <label>
                            Review outcome
                            <select name="resolution">
                              <option value="reviewing_with_grader">
                                Staff reviewing with grader
                              </option>
                              <option value="return_when_received">
                                Arrange return when physically received
                              </option>
                              <option value="unable_to_withdraw">
                                Unable to withdraw
                              </option>
                              <option value="closed">Review closed</option>
                            </select>
                          </label>
                          <Reason />
                        </Form>
                      )}
                    </article>
                  ))
                )}
              </section>
              <section className="panel">
                <h2>Pickup receipts</h2>
                {data.pickups.map((p) => (
                  <article key={p.id}>
                    <h3>
                      {p.recipient_name} · {p.recipient_kind}
                    </h3>
                    <p>
                      {when(p.created_at)} · Staff {p.staff_id}
                    </p>
                    <p>
                      {p.card_ids.length} individually scanned cards · Receipt{" "}
                      {p.id}
                    </p>
                    <ul>
                      {p.card_ids.map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ul>
                  </article>
                ))}
                {!data.pickups.length && <p>No verified pickups recorded.</p>}
              </section>
              <section className="panel">
                <h2>Grading notification delivery</h2>
                <p>
                  In-app updates save with the records. Email uses the existing
                  configured adapter and preferences. If setup is needed, Google
                  Workspace remains preferred. Nothing here sends a real test
                  message.
                </p>
                <Link href="/staff/engagement">
                  Notification operations and attempt history →
                </Link>
                <ul className="grading-operation-list">
                  {data.notices.map((n) => (
                    <li key={n.id}>
                      {n.channel} · <strong>{n.state.toUpperCase()}</strong> ·{" "}
                      {n.attempts} attempts
                      <p>
                        {n.last_error?.replaceAll("_", " ") ||
                          "Queued after successful save"}{" "}
                        · {when(n.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
                {!data.notices.length && (
                  <p>
                    No email/push jobs. In-app updates do not require email
                    opt-in.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
function StatusImports({
  endpoint,
  data,
  disabled,
  reload,
}: {
  endpoint: string;
  data: OperationsData;
  disabled: boolean;
  reload: () => Promise<void>;
}) {
  const [csv, setCsv] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<StatusImportPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState("");
  async function call(b: Body) {
    const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      }),
      v = await r.json();
    if (!r.ok)
      throw Error(String(v.error || "Import unavailable").replaceAll("_", " "));
    return v;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Reviewed grading status spreadsheet</h2>
      <p>
        Update existing physical cards by their exact ID. Review mapping and
        each row before committing. Dispatch, customer approval and pickup
        cannot be imported. Return rows need the actual grade or no-grade
        reason; pickup readiness still needs confirmed return photos.
      </p>
      <a href="/samples/grading-status.csv" download>
        Download SAMPLE template
      </a>
      <p>
        Intake imports remain in{" "}
        <Link href="/staff/grading">Intake → Imports</Link>, with existing
        duplicate and reversal safeguards.
      </p>
      <label>
        CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={disabled || busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void run(async () => {
              if (f.size > 262144) throw Error("CSV limit is 256 KiB");
              const s = await f.text();
              const h = (
                await call({ action: "status_import_headers", csv: s })
              ).headers as string[];
              setCsv(s);
              setHeaders(h);
              setMapping(
                Object.fromEntries(
                  statusImportFields.map((k) => [k, h.includes(k) ? k : ""]),
                ),
              );
              setPreview(null);
            });
          }}
        />
      </label>
      <label>
        Stable spreadsheet source
        <input
          value={source}
          maxLength={80}
          onChange={(e) => setSource(e.target.value)}
          placeholder="northside-status-sheet"
        />
      </label>
      {headers.length > 0 && (
        <>
          <div className="grading-form">
            {statusImportFields.map((k) => (
              <label key={k}>
                {k.replaceAll("_", " ")}
                <select
                  value={mapping[k] || ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [k]: e.target.value }))
                  }
                >
                  <option value="">Not mapped</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="button"
            disabled={disabled || busy}
            onClick={() =>
              void run(async () => {
                setPreview(
                  await call({
                    action: "status_import_preview",
                    csv,
                    source,
                    mapping,
                  }),
                );
                await reload();
              })
            }
          >
            Validate & save review
          </button>
        </>
      )}
      <label>
        Saved spreadsheet review
        <select
          value={preview?.id || ""}
          onChange={(e) => {
            if (!e.target.value) return;
            void run(async () => {
              const r = await fetch(
                  endpoint +
                    (endpoint.includes("?") ? "&" : "?") +
                    "import=" +
                    e.target.value,
                  { cache: "no-store" },
                ),
                v = await r.json();
              if (!r.ok) throw Error(v.error);
              setPreview(v);
            });
          }}
        >
          <option value="">Choose a saved review</option>
          {data.status_imports.map((i) => (
            <option key={i.id} value={i.id}>
              {i.source} · {i.status} · {when(i.created_at)}
            </option>
          ))}
        </select>
      </label>
      {preview && (
        <>
          <h3>
            {preview.source} · {preview.status || "review"}
          </h3>
          <ul className="grading-operation-list">
            {preview.rows.map((r) => (
              <li key={r.line}>
                <strong>
                  Row {r.line}: {r.state}
                </strong>
                <p>
                  {r.description || r.external_id} · {r.previous_status} →{" "}
                  {String(r.input?.status_key || "")}
                </p>
                <p>
                  {String(r.input?.result || "")}{" "}
                  {r.message.replaceAll("_", " ")}
                </p>
              </li>
            ))}
          </ul>
          <Form
            disabled={
              disabled ||
              busy ||
              preview.status === "committed" ||
              preview.rows.some((r) => r.state === "error")
            }
            submit="Commit reviewed status updates"
            onSave={(v) =>
              run(async () => {
                await call({
                  action: "status_import_commit",
                  id: preview.id,
                  ...v,
                  confirmed: v.confirmed === "on",
                });
                setPreview({ ...preview, status: "committed" });
                await reload();
              })
            }
          >
            <label className="grading-check">
              <input type="checkbox" name="confirmed" required />I reviewed
              every mapped row against the physical cards and actual evidence.
            </label>
            <Reason />
          </Form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
