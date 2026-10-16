"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  consignmentStates,
  consignmentMoney as money,
  consignmentFields,
  type ConsignmentData,
  type ConsignmentDetail,
  type ConsignmentItem,
  type ConsignmentImport,
} from "@/lib/consignment";
type Body = Record<string, unknown>;
type Send = (b: Body) => Promise<Body | undefined>;
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
        defaultValue={value}
        type={type}
        required={required}
        step={type === "number" ? 1 : undefined}
        min={type === "number" ? 0 : undefined}
        maxLength={type === "text" ? 500 : undefined}
      />
    </label>
  );
}
function Form({
  children,
  label,
  submit,
}: {
  children: ReactNode;
  label: string;
  submit: (v: Record<string, string>) => Promise<unknown>;
}) {
  return (
    <form
      className="grading-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit(
          Object.fromEntries(new FormData(e.currentTarget)) as Record<
            string,
            string
          >,
        );
      }}
    >
      {children}
      <button className="button">{label}</button>
    </form>
  );
}
function Reason() {
  return (
    <Field name="reason" label="Private reason / evidence reference" required />
  );
}
const amount = (v: string) => (v === "" ? null : Number(v));
function ItemFields({ item }: { item?: ConsignmentItem }) {
  return (
    <>
      <Field
        name="description"
        label="Card description"
        value={item?.description}
        required
      />
      <div className="grading-fields">
        <Field
          name="received_date"
          label="Received date"
          type="date"
          value={item?.received_date?.slice(0, 10) || ""}
          required
        />
        <Field
          name="channel"
          label="Channel (leave unknown blank)"
          value={item?.channel}
        />
        <Field
          name="provider_reference"
          label="Provider item reference"
          value={item?.provider_reference || ""}
        />
        <Field
          name="submission_reference"
          label="Submission reference"
          value={item?.submission_reference}
        />
        <Field
          name="listing_reference"
          label="Listing reference"
          value={item?.listing_reference}
        />
        <label>
          Currency
          <select name="currency">
            <option value="USD">USD</option>
          </select>
        </label>
      </div>
      <label>
        Operational status
        <select name="state_key" defaultValue={item?.state_key || "received"}>
          {Object.entries(consignmentStates).map(([key, label]) => (
            <option
              key={key}
              value={key}
              disabled={key === "paid" && item?.payout_status !== "paid"}
            >
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="fine">
        Blank amounts mean unknown. Enter 0 only when a zero is confirmed. A
        sale does not establish a payout.
      </p>
      <div className="grading-fields">
        <Field
          name="asking_cents"
          label="Asking price in cents, if known"
          type="number"
          value={item?.asking_cents ?? ""}
        />
        <Field
          name="sale_cents"
          label="Verified sale amount in cents"
          type="number"
          value={item?.sale_verified_at ? (item.sale_cents ?? "") : ""}
        />
        <Field
          name="fees_cents"
          label="Total fees in cents, if known"
          type="number"
          value={item?.fees_cents ?? ""}
        />
      </div>
      <Field
        name="sale_evidence"
        label="Sale evidence reference (required for a new or changed sale amount)"
      />
      <label>
        Customer-visible notes
        <textarea
          name="customer_notes"
          defaultValue={item?.customer_notes}
          maxLength={3000}
        />
      </label>
      <Reason />
    </>
  );
}
function values(v: Record<string, string>) {
  return {
    ...v,
    asking_cents: amount(v.asking_cents),
    sale_cents: amount(v.sale_cents),
    fees_cents: amount(v.fees_cents),
    ...(v.sale_evidence ? {} : { sale_evidence: undefined }),
  };
}
export function ConsignmentWorkspace({
  fixture,
  staff,
}: {
  fixture: boolean;
  staff: boolean;
}) {
  const [who, setWho] = useState(staff ? "staff" : "a"),
    [data, setData] = useState<ConsignmentData | null>(null),
    [detail, setDetail] = useState<ConsignmentDetail | null>(null),
    [page, setPage] = useState("Items"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [intakeRequest, setIntakeRequest] = useState(() => crypto.randomUUID());
  const endpoint = fixture
    ? `/api/preview/consignment?actor=${who}`
    : "/api/private/consignment";
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
    let current = true;
    get()
      .then((v) => {
        if (current) {
          setData(v);
          setDetail(null);
          setError("");
        }
      })
      .catch((e) => {
        if (current) {
          setData(null);
          setError(e.message);
        }
      });
    return () => {
      current = false;
    };
  }, [get]);
  const select = async (id: string) => {
    try {
      setDetail(await get("item=" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const send: Send = async (b) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const v = await r.json();
      if (!r.ok)
        throw Error(String(v.error || "Unable to save").replaceAll("_", " "));
      setData(await get());
      if (detail) setDetail(await get("item=" + detail.item.id));
      setNotice(fixture ? "Saved to the local sample database." : "Saved.");
      return v;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
        <h1>{staff ? "Consignment desk" : "Your consignment cards"}</h1>
        <p>
          Follow each card from intake through listing and recorded settlement.
        </p>
      </div>
      {fixture && (
        <aside className="grading-notice">
          <strong>LOCAL SAMPLE WORKSPACE</strong>
          <p>
            Fictional cards, amounts and accounts. Changes save on this Mac. Use
            sample information only.
          </p>
          {!staff && (
            <label>
              Sample account
              <select
                value={who}
                onChange={(e) => {
                  setWho(e.target.value);
                  setNotice("");
                }}
              >
                <option value="a">Sample collector A</option>
                <option value="b">Sample collector B</option>
              </select>
            </label>
          )}
          <Link href={staff ? "/my-cards/consignment" : "/staff/consignment"}>
            {staff ? "Open customer sample →" : "Open staff sample →"}
          </Link>
        </aside>
      )}
      {error && (
        <p role="alert" className="grading-notice">
          {error}.{" "}
          {!data && (
            <Link href={staff ? "/staff/login" : "/account"}>
              Open {staff ? "staff sign-in" : "account"}
            </Link>
          )}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Saving…" : notice}
      </p>
      {!data && !error && <p>Loading saved records…</p>}
      {data && (
        <>
          <aside className="consignment-health">
            <strong>Fanatics Collect: {data.integration.state}</strong>
            <p>{data.integration.message}</p>
            <small>
              No successful provider sync has been verified. Updates below are
              Northside recorded.
            </small>
          </aside>
          <div className="grading-toolbar">
            {staff && (
              <nav aria-label="Consignment tools">
                {(writer
                  ? [
                      "Items",
                      "New intake",
                      "Imports & matching",
                      "Partner access",
                    ]
                  : ["Items", "Partner access"]
                ).map((p) => (
                  <button
                    key={p}
                    className={page === p ? "button" : "button secondary"}
                    aria-current={page === p ? "page" : undefined}
                    onClick={() => setPage(p)}
                  >
                    {p}
                    {p === "Imports & matching" && data.review_count > 0
                      ? ` (${data.review_count} to review)`
                      : ""}
                  </button>
                ))}
              </nav>
            )}
            <button
              className="plain"
              onClick={async () => {
                try {
                  const v = await get("export=1"),
                    url = URL.createObjectURL(
                      new Blob([v.csv], { type: "text/csv" }),
                    ),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = fixture
                    ? "SAMPLE-consignment.csv"
                    : "my-consignment.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Export {fixture ? "sample " : ""}consignment CSV
            </button>
          </div>
          <fieldset className="grading-controls" disabled={busy}>
            {(!staff || page === "Items") && (
              <div className="grading-columns">
                <section>
                  <h2>
                    {staff ? "Item records" : "My cards"}{" "}
                    <small>({data.items.length})</small>
                  </h2>
                  {!data.items.length && (
                    <p>
                      No consignment items are linked to your verified account.
                    </p>
                  )}
                  {data.items.map((i) => (
                    <button
                      key={i.id}
                      className={
                        "grading-card " +
                        (detail?.item.id === i.id ? "selected" : "")
                      }
                      onClick={() => select(i.id)}
                    >
                      <strong>{i.description}</strong>
                      <span>{consignmentStates[i.state_key]}</span>
                      <small>
                        Item {i.id.slice(-8)} ·{" "}
                        {i.payout_status === "partial"
                          ? "Partial settlement recorded"
                          : i.payout_status === "paid"
                            ? "Settlement recorded in full"
                            : i.sale_verified_at
                              ? "Settlement pending"
                              : "Payout unknown"}
                      </small>
                    </button>
                  ))}
                  <p className="fine">
                    Showing up to 300 recent items. Contact Northside if an
                    expected card is missing.
                  </p>
                </section>
                {detail ? (
                  <ItemDetail
                    key={detail.item.id + ":" + detail.item.version}
                    detail={detail}
                    writer={writer}
                    fixture={fixture}
                    send={send}
                    get={get}
                    reload={() => select(detail.item.id)}
                  />
                ) : (
                  <section className="empty">
                    <h2>Select a card</h2>
                    <p>
                      Read its status, references, sale information and recorded
                      history.
                    </p>
                  </section>
                )}
              </div>
            )}
            {staff && writer && page === "New intake" && (
              <section className="panel consignment-intake">
                <h2>New consignment intake</h2>
                <p>
                  Save one physical card per intake. Only a verified customer
                  account can be selected. Unmatched spreadsheet records stay in
                  staff review.
                </p>
                <Form
                  label="Save consignment intake"
                  submit={async (v) => {
                    const result = await send({
                      action: "intake",
                      request_id: intakeRequest,
                      ...values(v),
                    });
                    if (result) setIntakeRequest(crypto.randomUUID());
                    return result;
                  }}
                >
                  <label>
                    Exact customer account
                    <select name="customer_id" defaultValue="" required>
                      <option value="" disabled>
                        Select verified customer
                      </option>
                      {data.customers
                        .filter((c) => c.verified)
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.display_name} · {c.id.slice(-8)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <ItemFields />
                </Form>
              </section>
            )}
            {staff && writer && page === "Imports & matching" && (
              <ImportDesk data={data} get={get} send={send} />
            )}
            {staff && page === "Partner access" && (
              <section className="panel">
                <h2>Partner data access</h2>
                <p>
                  Northside’s partnership is confirmed. The connector,
                  permissions and private consignor data coverage have not been
                  verified.
                </p>
                <ul>
                  {Object.entries(data.integration.capabilities).map(
                    ([key, enabled]) => (
                      <li key={key}>
                        {key.replaceAll("_", " ")}:{" "}
                        {enabled ? "supported" : "unavailable"}
                      </li>
                    ),
                  )}
                </ul>
                <p>
                  Documentation version, authentication, permissions, rate
                  limits and field coverage: unknown.
                </p>
                <p>
                  Manual records remain available when the partner connection is
                  disconnected or unavailable. Import review never initiates a
                  provider sync.
                </p>
                <p>
                  A partner information request has been drafted in the project
                  documentation. No message has been sent.
                </p>
              </section>
            )}
          </fieldset>
        </>
      )}
      <p className="fine">
        Payout information is a record of reported settlement. This app does not
        initiate money transfers. Estimated net is shown only when the verified
        sale amount and total fees are known. Consignment proceeds are separate
        from Shopify sales and loyalty points.
      </p>
    </div>
  );
}
function ItemDetail({
  detail,
  writer,
  fixture,
  send,
  get,
  reload,
}: {
  detail: ConsignmentDetail;
  writer: boolean;
  fixture: boolean;
  send: Send;
  get: (extra: string) => Promise<Body>;
  reload: () => Promise<void>;
}) {
  const i = detail.item,
    [fileError, setFileError] = useState(""),
    [uploading, setUploading] = useState(false);
  const reversed = new Set(
    detail.settlements.flatMap((s) => (s.reverses_id ? [s.reverses_id] : [])),
  );
  return (
    <article className="panel grading-detail">
      <span className="badge">{consignmentStates[i.state_key]}</span>
      <h2>{i.description}</h2>
      <p className="fine">
        Northside intake: {i.case_id}
        <br />
        Item: {i.id}
        <br />
        Received: {i.received_date?.slice(0, 10) || "Unknown"}
        <br />
        Updated {date(i.updated_at)} · Northside recorded
      </p>
      <dl className="consignment-money">
        <div>
          <dt>Asking price</dt>
          <dd>{money(i.asking_cents)}</dd>
        </div>
        <div>
          <dt>Sale · staff verified</dt>
          <dd>{money(i.sale_verified_at ? i.sale_cents : null)}</dd>
        </div>
        <div>
          <dt>Total fees</dt>
          <dd>{money(i.fees_cents)}</dd>
        </div>
        <div>
          <dt>Estimated net</dt>
          <dd>{money(i.net_cents)}</dd>
        </div>
      </dl>
      {i.net_cents === null && (
        <p className="grading-notice">
          Net is unknown until a verified sale and all fees are recorded.
          Missing fees have not been treated as zero.
        </p>
      )}
      {i.net_cents !== null && i.net_cents < 0 && (
        <p className="grading-notice">
          Recorded fees exceed the sale amount. Staff review is required.
        </p>
      )}
      <div className="grading-notice">
        <strong>
          {i.payout_status === "paid"
            ? "Settlement recorded in full"
            : i.payout_status === "partial"
              ? "Partial settlement recorded"
              : i.sale_verified_at
                ? "Awaiting settlement information"
                : "Payout unknown"}
        </strong>
        <p>
          {i.settlement_count
            ? `${money(i.settled_cents)} recorded${i.net_cents !== null ? " of " + money(i.net_cents) + " estimated net" : ""}.`
            : "No active settlement reference recorded."}
        </p>
        <small>Informational only. No transfer is initiated here.</small>
      </div>
      <h3>Submission and listing</h3>
      <p>
        Channel: {i.channel || "Unknown"}
        <br />
        Provider item: {i.provider_reference || "Unknown"}
        <br />
        Submission: {i.submission_reference || "Unknown"}
        <br />
        Listing: {i.listing_reference || "Unknown"}
      </p>
      {i.source_updated_at && (
        <p className="fine">
          Last reviewed source timestamp: {date(i.source_updated_at)}
        </p>
      )}
      <h3>Notes from Northside</h3>
      <p className="preserve-lines">
        {i.customer_notes || "No additional notes."}
      </p>
      <h3>Images / files</h3>
      {detail.files.map((f, n) => (
        <button
          className="plain"
          key={f.id}
          onClick={async () => {
            try {
              const r = await get("file=" + f.id);
              window.open(String(r.url), "_blank", "noopener,noreferrer");
            } catch (e) {
              setFileError((e as Error).message);
            }
          }}
        >
          Open {fixture ? "sample " : ""}file {n + 1} ↗
        </button>
      ))}
      {!detail.files.length && <p>No images attached.</p>}
      {writer &&
        (fixture ? (
          <button
            className="button secondary"
            onClick={() => send({ action: "sample-image", item_id: i.id })}
          >
            Attach labeled sample image
          </button>
        ) : (
          <label>
            Add private image (PNG/JPEG/WebP, up to 5 MiB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const r = await fetch(
                    `/api/private/cards/${i.card_id}/upload`,
                    {
                      method: "POST",
                      headers: { "Content-Type": f.type },
                      body: f,
                    },
                  );
                  if (!r.ok)
                    throw Error(
                      "Upload failed. Check file type, size and Storage configuration.",
                    );
                  await reload();
                  setFileError("");
                } catch (e) {
                  setFileError((e as Error).message);
                } finally {
                  setUploading(false);
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
                {e.source === "reviewed_csv"
                  ? "Northside reviewed spreadsheet"
                  : "Northside staff recorded"}{" "}
                · not a provider feed
              </small>
            </div>
          </li>
        ))}
      </ol>
      <h3>Settlement references</h3>
      {!detail.settlements.length && <p>No settlement reference recorded.</p>}
      {detail.settlements.map((s) => (
        <div className="consignment-settlement" key={s.id}>
          <strong>
            {s.reverses_id
              ? "Record correction"
              : reversed.has(s.id)
                ? "Reversed record"
                : "Recorded settlement"}{" "}
            · {money(s.amount_cents)}
          </strong>
          <p>
            {s.reference} · {s.recorded_date.slice(0, 10)} · Northside recorded
          </p>
          {writer && !s.reverses_id && !reversed.has(s.id) && (
            <details>
              <summary>Correct this recorded settlement</summary>
              <p>
                This reverses the record only. It cannot recall or transfer
                money.
              </p>
              <Form
                label="Save record reversal"
                submit={(v) =>
                  send({
                    action: "settlement",
                    item_id: i.id,
                    version: i.version,
                    currency: "USD",
                    reverses_id: s.id,
                    ...v,
                  })
                }
              >
                <Field
                  name="reference"
                  label="Unique correction reference"
                  required
                />
                <Field
                  name="recorded_date"
                  label="Correction date"
                  type="date"
                  required
                />
                <Reason />
              </Form>
            </details>
          )}
        </div>
      ))}
      {writer && (
        <>
          <details>
            <summary>Edit item / append a correction</summary>
            <Form
              label="Save audited item update"
              submit={(v) =>
                send({
                  action: "update",
                  item_id: i.id,
                  version: i.version,
                  ...values(v),
                })
              }
            >
              <ItemFields item={i} />
            </Form>
          </details>
          <details>
            <summary>Record an existing settlement</summary>
            <p>
              Use evidence of an actual external settlement. Known sale and
              total fees are required. Partial amounts are supported;
              overpayments are rejected for review.
            </p>
            <Form
              label="Save settlement reference"
              submit={(v) =>
                send({
                  action: "settlement",
                  item_id: i.id,
                  version: i.version,
                  currency: "USD",
                  ...v,
                  amount_cents: Number(v.amount_cents),
                })
              }
            >
              <Field
                name="amount_cents"
                label="Recorded amount in cents (USD)"
                type="number"
                required
              />
              <Field
                name="reference"
                label="Unique payout reference"
                required
              />
              <Field
                name="recorded_date"
                label="Settlement date"
                type="date"
                required
              />
              <Reason />
            </Form>
          </details>
        </>
      )}
    </article>
  );
}
function ImportDesk({
  data,
  get,
  send,
}: {
  data: ConsignmentData;
  get: (extra: string) => Promise<Body>;
  send: Send;
}) {
  const [csv, setCsv] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<ConsignmentImport | null>(null),
    [error, setError] = useState("");
  const readColumns = async (value: string) => {
    setError("");
    setPreview(null);
    if (new Blob([value]).size > 262144) {
      setError("CSV must be 256 KiB or smaller.");
      return;
    }
    try {
      const { parse } = await import("csv-parse/browser/esm/sync"),
        rows = parse(value, {
          bom: true,
          skip_empty_lines: true,
          max_record_size: 10000,
        }) as string[][],
        h = rows[0];
      if (!h?.length || new Set(h).size !== h.length || h.length > 30)
        throw Error();
      setHeaders(h);
      setMapping(
        Object.fromEntries(
          consignmentFields.map((k) => [k, h.includes(k) ? k : ""]),
        ),
      );
    } catch {
      setHeaders([]);
      setError("Unable to read CSV. Use the sanitized template.");
    }
  };
  return (
    <div className="grading-columns">
      <section className="panel">
        <h2>Reviewed consignment import</h2>
        <p>
          Import intake, status and sale information. Blank optional fields
          preserve existing values; they remain unknown for new items.
          Settlement references are entered on individual items after
          verification.
        </p>
        <a href="/samples/consignment.csv" download>
          Download sanitized sample CSV
        </a>
        <label>
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 262144) {
                setError("CSV must be 256 KiB or smaller.");
                return;
              }
              const v = await f.text();
              setCsv(v);
              await readColumns(v);
            }}
          />
        </label>
        <details>
          <summary>Or paste CSV text</summary>
          <label>
            CSV text
            <textarea
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setHeaders([]);
                setPreview(null);
              }}
              maxLength={262144}
            />
          </label>
          <button className="button secondary" onClick={() => readColumns(csv)}>
            Read columns
          </button>
        </details>
        {error && <p role="alert">{error}</p>}
        {headers.length > 0 && (
          <Form
            label="Build review preview"
            submit={async (v) => {
              const r = await send({
                action: "import-preview",
                csv,
                mapping,
                source: v.source,
              });
              if (r) setPreview(r as unknown as ConsignmentImport);
              return r;
            }}
          >
            <Field
              name="source"
              label="Stable source name"
              value="sample-consignment"
              required
            />
            <details open>
              <summary>Column mapping</summary>
              {consignmentFields.map((k) => (
                <label key={k}>
                  {k.replaceAll("_", " ")}
                  <select
                    value={mapping[k] || ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [k]: e.target.value })
                    }
                  >
                    <option value="">Leave unmapped</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </details>
          </Form>
        )}
        {preview && (
          <section className="consignment-review">
            <h3>Review: {preview.source}</h3>
            <p>
              Batch status: {preview.status}.{" "}
              {preview.rows.filter((r) => r.state === "ready").length} ready;{" "}
              {
                preview.rows.filter((r) =>
                  ["unmatched", "conflict", "error"].includes(r.state),
                ).length
              }{" "}
              need review.
            </p>
            {preview.rows.map((r) => (
              <article className="consignment-review-row" key={r.row_number}>
                <h4>
                  Row {r.row_number} · {r.external_id || "Missing external ID"}
                </h4>
                <strong>{r.state}</strong>
                <p>{r.message.replaceAll("_", " ")}</p>
                <p>
                  {r.input.description || "No description"} ·{" "}
                  {r.input.state_key || "No status"}
                </p>
                <p className="fine">
                  Approved customer: {r.customer_id || "Unmatched"}
                  <br />
                  Target: {r.target_item_id || "New intake after matching"}
                </p>
                <p>
                  Incoming sale:{" "}
                  {r.input.sale_cents === undefined
                    ? "Unspecified"
                    : money(r.input.sale_cents)}{" "}
                  · fees:{" "}
                  {r.input.fees_cents === undefined
                    ? "Unspecified"
                    : money(r.input.fees_cents)}
                </p>
                <details>
                  <summary>Review all mapped fields and current values</summary>
                  <div className="grading-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Current record</th>
                          <th>Incoming value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(r.input).map(([key, value]) => (
                          <tr key={key}>
                            <th>{key.replaceAll("_", " ")}</th>
                            <td>
                              {reviewValue(
                                key,
                                r.current_snapshot
                                  ? key === "item_id"
                                    ? r.current_snapshot.id
                                    : r.current_snapshot[
                                        key as keyof ConsignmentItem
                                      ]
                                  : undefined,
                              )}
                            </td>
                            <td>{reviewValue(key, value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {r.current_snapshot && (
                    <p className="fine">
                      Review the current record and all proposed changes.
                      Unspecified optional values preserve existing data.
                    </p>
                  )}
                </details>
                {preview.status === "review" && r.state === "unmatched" && (
                  <Form
                    label="Approve exact match"
                    submit={async (v) => {
                      const result = await send({
                        action: "import-resolve",
                        id: preview.id,
                        row_number: r.row_number,
                        ...v,
                        confirm: v.confirm === "on",
                      });
                      if (result)
                        setPreview(result as unknown as ConsignmentImport);
                      return result;
                    }}
                  >
                    <label>
                      Create for verified customer
                      <select name="customer_id" defaultValue="">
                        <option value="">Choose existing item instead</option>
                        {data.customers
                          .filter((c) => c.verified)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.display_name} · {c.id.slice(-8)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Or match existing item
                      <select name="item_id" defaultValue="">
                        <option value="">New intake for chosen customer</option>
                        {data.items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.id.slice(-8)} · {i.description}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grading-check">
                      <input type="checkbox" name="confirm" required />
                      <span>
                        I verified this exact ownership match using
                        intake/partner evidence, not email or card title alone.
                      </span>
                    </label>
                    <Reason />
                  </Form>
                )}
                {preview.status === "review" &&
                  ["unmatched", "conflict", "error", "ready"].includes(
                    r.state,
                  ) && (
                    <details>
                      <summary>Reject this row</summary>
                      <Form
                        label="Reject row without item changes"
                        submit={async (v) => {
                          const result = await send({
                            action: "import-resolve",
                            id: preview.id,
                            row_number: r.row_number,
                            reject: true,
                            ...v,
                          });
                          if (result)
                            setPreview(result as unknown as ConsignmentImport);
                          return result;
                        }}
                      >
                        <Reason />
                      </Form>
                    </details>
                  )}
              </article>
            ))}
            {preview.status === "review" && (
              <Form
                label="Confirm reviewed import"
                submit={async (v) => {
                  const r = await send({
                    action: "import-commit",
                    id: preview.id,
                    confirm: v.confirm === "on",
                    reason: v.reason,
                  });
                  if (r)
                    setPreview(
                      (await get(
                        "import=" + preview.id,
                      )) as unknown as ConsignmentImport,
                    );
                  return r;
                }}
              >
                <label className="grading-check">
                  <input name="confirm" type="checkbox" required />
                  <span>
                    I reviewed every match, current value and proposed change,
                    and verified any sale amounts against evidence.
                  </span>
                </label>
                <Reason />
              </Form>
            )}
          </section>
        )}
      </section>
      <section className="panel">
        <h2>Staff review queue</h2>
        <p>
          {data.review_count} unmatched, conflicting or invalid rows require
          review. They cannot become customer records until resolved or
          explicitly rejected.
        </p>
        {data.imports.map((i) => (
          <button
            className="grading-card"
            key={i.id}
            onClick={async () => {
              try {
                setPreview(
                  (await get("import=" + i.id)) as unknown as ConsignmentImport,
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <strong>
              {i.source} · {i.status}
            </strong>
            <small>{date(i.created_at)} · Open saved review</small>
          </button>
        ))}
      </section>
    </div>
  );
}

function reviewValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Not supplied";
  if (key.endsWith("_cents") && typeof value === "number") return money(value);
  if (
    key === "state_key" &&
    typeof value === "string" &&
    Object.hasOwn(consignmentStates, value)
  )
    return consignmentStates[value as keyof typeof consignmentStates];
  return String(value);
}
