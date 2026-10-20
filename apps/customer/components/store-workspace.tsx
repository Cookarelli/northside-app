"use client";
import Link from "next/link";
import { useEffect, useState, useCallback, type FormEvent } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { inventoryPools, pickupStates, pickupNext } from "@/lib/store";
import type { storeStaff } from "@/lib/server/store";
import { StoreScanner } from "./store-scanner";
type Data = Awaited<ReturnType<typeof storeStaff>>;
type Post = (body: Record<string, unknown>) => Promise<boolean>;
type Field = {
  key: string;
  label: string;
  kind?: "text" | "list" | "number" | "check" | "select";
  options?: { id: string; label: string }[];
  optional?: boolean;
  locked?: boolean;
  max?: number;
};
const field = (
  key: string,
  label: string,
  extra: Omit<Field, "key" | "label"> = {},
): Field => ({ key, label, ...extra });
const opts = (items: { id: string; label: string }[]) => ({
  kind: "select" as const,
  options: items,
});
const active = field("active", "Active", { kind: "check" });
function Editor({
  action,
  record,
  fields,
  post,
  busy,
  submit = "Save changes",
}: {
  action: string;
  record?: Record<string, unknown>;
  fields: Field[];
  post: Post;
  busy: boolean;
  submit?: string;
}) {
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el),
      input: Record<string, unknown> = {};
    for (const x of fields) {
      if (x.locked && record) {
        input[x.key] = record[x.key];
        continue;
      }
      const v = String(f.get(x.key) || "");
      input[x.key] =
        x.kind === "check"
          ? f.has(x.key)
          : x.kind === "list"
            ? v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : x.kind === "number"
              ? v === ""
                ? null
                : Number(v)
              : v || null;
    }
    if (
      await post({
        action,
        id: record?.id || newId,
        version: record?.version ?? null,
        input,
        reason: f.get("reason"),
      })
    ) {
      if (!record) {
        el.reset();
        setNewId(crypto.randomUUID());
      }
    }
  }
  return (
    <form className="grading-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <div className="loyalty-form-grid">
          {fields.map((x) => (
            <label
              className={x.kind === "check" ? "loyalty-check" : ""}
              key={x.key}
            >
              {x.kind === "check" ? (
                <>
                  <input
                    name={x.key}
                    type="checkbox"
                    defaultChecked={
                      record ? record[x.key] === true : x.key === "active"
                    }
                  />
                  {x.label}
                </>
              ) : (
                <>
                  {x.label}
                  {x.kind === "select" ? (
                    <select
                      name={x.key}
                      defaultValue={String(record?.[x.key] ?? "")}
                      required={!x.optional}
                      disabled={x.locked && !!record}
                    >
                      <option value="">
                        {x.optional ? "None" : "Choose…"}
                      </option>
                      {x.options?.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name={x.key}
                      type={x.kind === "number" ? "number" : "text"}
                      min={x.kind === "number" ? 0 : undefined}
                      max={x.kind === "number" ? 100 : undefined}
                      maxLength={x.max || 1000}
                      readOnly={x.locked && !!record}
                      required={!x.optional && x.kind !== "list"}
                      defaultValue={
                        x.kind === "list"
                          ? ((record?.[x.key] as string[]) || []).join(", ")
                          : String(record?.[x.key] ?? "")
                      }
                    />
                  )}
                </>
              )}
            </label>
          ))}
        </div>
        <label>
          Reason for this change
          <input name="reason" required maxLength={1000} />
        </label>
        <button className="button" disabled={busy}>
          {submit}
        </button>
      </fieldset>
    </form>
  );
}
function Schematic({ data }: { data: Data }) {
  return (
    <figure className="store-map">
      <svg
        viewBox="0 0 600 470"
        role="img"
        aria-label="Editable schematic of eight aisles, sample entrance and service counter; not a floor plan"
      >
        <rect
          x="1"
          y="1"
          width="598"
          height="438"
          fill="#f3f7fb"
          stroke="#bac8da"
        />
        {data.edges
          .filter((e) => e.active)
          .map((e) => {
            const a = data.nodes.find((n) => n.id === e.from_node && n.active),
              b = data.nodes.find((n) => n.id === e.to_node && n.active);
            return a && b ? (
              <line
                key={e.id}
                x1={20 + a.x * 5.6}
                y1={20 + a.y * 4}
                x2={20 + b.x * 5.6}
                y2={20 + b.y * 4}
                stroke="#9eb6cc"
                strokeWidth="3"
                strokeDasharray="5 5"
              />
            ) : null;
          })}
        {data.aisles
          .filter((a) => a.active && a.x !== null && a.y !== null)
          .map((a) => (
            <g
              key={a.id}
              transform={`translate(${20 + a.x! * 5.6},${20 + a.y! * 4})`}
            >
              <rect
                x="-38"
                y="-25"
                width="76"
                height="50"
                rx="6"
                fill="#174f98"
              />
              <text textAnchor="middle" y="5" fill="white" fontSize="15">
                Aisle {a.number}
              </text>
            </g>
          ))}
        {data.nodes
          .filter((n) => n.active)
          .map((n) => (
            <g
              key={n.id}
              transform={`translate(${20 + n.x * 5.6},${20 + n.y * 4})`}
            >
              <circle r="7" fill="#058073" />
              <text
                y={n.y < 15 ? 24 : -15}
                textAnchor={n.x > 80 ? "end" : n.x < 20 ? "start" : "middle"}
                fontSize="12"
                fill="#163145"
              >
                {n.label}
              </text>
            </g>
          ))}
        <text x="300" y="460" textAnchor="middle" fontSize="13" fill="#334c66">
          SCHEMATIC • Not to scale • No walking directions
        </text>
      </svg>
      <figcaption>
        Staff schematic only. Positions are editable proportions, not
        measurements or verified shelf locations. Aisles without positions stay
        in the editable list below.
      </figcaption>
    </figure>
  );
}
export function StoreWorkspace({ fixture }: { fixture: boolean }) {
  const endpoint = fixture
    ? "/api/preview/store?actor=staff"
    : "/api/private/store";
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      const r = await fetch(endpoint, { cache: "no-store" }),
        b = await r.json();
      if (!r.ok) throw Error(b.error || "workspace_unavailable");
      setData(b);
      setError("");
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "workspace_unavailable").replaceAll(
          "_",
          " ",
        ),
      );
    }
  }, [endpoint]);
  useEffect(() => {
    let keep = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error || "workspace_unavailable");
        if (keep) setData(body);
      })
      .catch((e) => {
        if (keep)
          setError(
            (e instanceof Error
              ? e.message
              : "workspace_unavailable"
            ).replaceAll("_", " "),
          );
      });
    return () => {
      keep = false;
    };
  }, [endpoint]);
  const post: Post = async (body) => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        b = await r.json();
      if (!r.ok) throw Error(b.error || "save_failed");
      await reload();
      setNotice("Saved with an audit entry.");
      return true;
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "save_failed").replaceAll("_", " "),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const blocked =
    busy ||
    !data ||
    !["owner", "admin", "operations"].includes(data.role || "");
  const aisleOptions =
      data?.aisles
        .filter((a) => a.active)
        .map((a) => ({ id: a.id, label: `${a.number} · ${a.label}` })) || [],
    locations =
      data?.locations
        .filter((l) => l.active)
        .map((l) => ({
          id: l.id,
          label: `${inventoryPools[l.pool]} · ${l.label}`,
        })) || [],
    products = data?.products.map((p) => ({ id: p.id, label: p.title })) || [],
    variants = data?.variants.map((v) => ({ id: v.id, label: v.sku })) || [],
    nodes =
      data?.nodes
        .filter((n) => n.active)
        .map((n) => ({ id: n.id, label: n.label })) || [];
  const locationFields = [
    field("pool", "Inventory pool", {
      ...opts(
        Object.entries(inventoryPools).map(([id, label]) => ({ id, label })),
      ),
      locked: true,
    }),
    field("label", "Location label"),
    field("aisle_id", "Retail aisle", {
      ...opts(aisleOptions),
      optional: true,
    }),
    field("side", "Configured aisle side", { optional: true, max: 80 }),
    field("zone", "Zone", { optional: true, max: 100 }),
    field("categories", "Categories (comma separated)", { kind: "list" }),
    field("approved_retail", "Approved for customer retail results", {
      kind: "check",
    }),
    active,
  ];
  const productFields = [
    field("shopify_product_id", "Shopify product ID", { locked: true }),
    field("title", "Display title"),
    field("family", "Product family"),
    field("handle", "Shopify product handle"),
  ];
  const variantFields = [
    field("product_id", "Product", { ...opts(products), locked: true }),
    field("shopify_variant_id", "Shopify variant ID", { locked: true }),
    field("sku", "SKU"),
    field("barcode", "Product barcode", { optional: true, max: 64 }),
    field(
      "verified",
      fixture
        ? "SAMPLE verified mapping"
        : "Verify against current Shopify catalog",
      { kind: "check" },
    ),
    field("evidence", "Verification evidence reference"),
  ];
  const qrFields = [
    field("product_id", "Product", opts(products)),
    field("variant_id", "Optional exact variant", {
      ...opts(variants),
      optional: true,
    }),
    field("placement_id", "Staff placement reference", {
      ...opts(locations),
      optional: true,
    }),
    field("campaign_key", "Optional campaign key", { optional: true, max: 80 }),
    field(
      "destination",
      "Destination",
      opts([
        { id: "product", label: "Current product" },
        { id: "retail_locator", label: "Current approved retail locator" },
      ]),
    ),
    active,
  ];
  const nodeFields = [
    field("label", "Node label"),
    field(
      "kind",
      "Node type",
      opts([
        { id: "entrance", label: "Entrance" },
        { id: "service_counter", label: "Service counter" },
        { id: "path", label: "Path node" },
      ]),
    ),
    field("x", "Horizontal position (0–100)", { kind: "number" }),
    field("y", "Vertical position (0–100)", { kind: "number" }),
    active,
  ];
  const editor = (action: string, fields: Field[], record?: object) => (
    <Editor
      key={
        record
          ? String((record as { id: string }).id) +
            ":" +
            String((record as { version: number }).version)
          : action + "-new"
      }
      action={action}
      fields={fields}
      record={record ? { ...record } : undefined}
      post={post}
      busy={blocked}
      submit={record ? "Save changes" : "Create record"}
    />
  );
  return (
    <div className="loyalty-workspace store-workspace">
      <div className="page-heading">
        <p className="eyebrow">STAFF · FUTURE STORE</p>
        <h1>Store workspace</h1>
        <p>Prepare the eight aisles, product locators and printed codes.</p>
      </div>
      {fixture && (
        <aside className="fixture-callout">
          <strong>SAMPLE workspace — saved locally</strong>
          <p>
            Fictional products, locations, stock, prices and pickup rehearsals.
            This schematic is not the Northside floor plan.
          </p>
        </aside>
      )}
      <aside className="loyalty-notice">
        <strong>Customer store features are disabled.</strong>
        <p>
          Scanning, directions, pickup checkout and collection are not active.
          Shopify products, inventory pools and fulfillment settings are
          unchanged.
        </p>
      </aside>
      <nav className="actions">
        <Link href="/staff" className="button secondary">
          Staff overview
        </Link>
        <Link href="/staff/breaks" className="button secondary">
          Breaks
        </Link>
      </nav>
      {notice && (
        <p role="status" className="loyalty-notice">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="loyalty-notice">
          <p>{error}</p>
          <button onClick={() => void reload()} className="button secondary">
            Reload workspace
          </button>
          {!fixture && (
            <Link href="/staff/login"> Sign in with a staff account</Link>
          )}
        </div>
      )}
      {data ? (
        <Tabs.Root defaultValue="layout">
          <Tabs.List className="tabs break-tabs" aria-label="Store tools">
            {[
              ["layout", "Aisles & layout"],
              ["locations", "Locations"],
              ["products", "Products & moves"],
              ["qr", "QR labels"],
              ["scanner", "Scanner"],
              ["pickup", "Pickup rehearsal"],
              ["audit", "Audit"],
            ].map(([v, label]) => (
              <Tabs.Trigger value={v} key={v}>
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="layout">
            <section className="loyalty-card">
              <h2>Eight editable aisles</h2>
              <Schematic data={data} />
              {data.aisles.map((a) => (
                <details key={a.id}>
                  <summary>
                    Aisle {a.number} · {a.label}
                    {!a.active ? " · inactive" : ""}
                  </summary>
                  {editor(
                    "aisle",
                    [
                      field("label", "Aisle label"),
                      field("sides", "Sides (comma separated)", {
                        kind: "list",
                      }),
                      field("categories", "Categories (comma separated)", {
                        kind: "list",
                      }),
                      field("x", "Horizontal position (0–100)", {
                        kind: "number",
                        optional: true,
                      }),
                      field("y", "Vertical position (0–100)", {
                        kind: "number",
                        optional: true,
                      }),
                      active,
                    ],
                    a,
                  )}
                </details>
              ))}
            </section>
            <section className="loyalty-card">
              <h2>Entrances, counter & path nodes</h2>
              {data.nodes.map((n) => (
                <details key={n.id}>
                  <summary>{n.label}</summary>
                  {editor("node", nodeFields, n)}
                </details>
              ))}
              <details>
                <summary>Add a node</summary>
                {editor("node", nodeFields)}
              </details>
              <h3>Path connections</h3>
              <p className="small">
                Connections describe the schematic only. No route, distance or
                walking instruction is generated.
              </p>
              {data.edges.map((e) => (
                <details key={e.id}>
                  <summary>
                    {nodes.find((n) => n.id === e.from_node)?.label ||
                      "Inactive node"}{" "}
                    ↔{" "}
                    {nodes.find((n) => n.id === e.to_node)?.label ||
                      "Inactive node"}
                    {!e.active ? " · inactive" : ""}
                  </summary>
                  {editor(
                    "edge",
                    [
                      field("from_node", "From node", opts(nodes)),
                      field("to_node", "To node", opts(nodes)),
                      active,
                    ],
                    { ...e, version: 1 },
                  )}
                </details>
              ))}
              <details>
                <summary>Add a connection</summary>
                {editor("edge", [
                  field("from_node", "From node", opts(nodes)),
                  field("to_node", "To node", opts(nodes)),
                  active,
                ])}
              </details>
            </section>
          </Tabs.Content>
          <Tabs.Content value="locations">
            <section className="loyalty-card">
              <h2>Three separate inventory pools</h2>
              <p>
                Only active, approved retail locations enter a customer result.
                Private placement and storage references stay in this workspace.
              </p>
              {data.locations.map((l) => (
                <details key={l.id}>
                  <summary>
                    {inventoryPools[l.pool]} · {l.label}
                    {l.approved_retail ? " · approved retail" : ""}
                  </summary>
                  {editor("location", locationFields, l)}
                </details>
              ))}
              <details>
                <summary>Add a location</summary>
                {editor("location", locationFields)}
              </details>
            </section>
          </Tabs.Content>
          <Tabs.Content value="products">
            <section className="loyalty-card">
              <h2>Product identity & verified variants</h2>
              <p>
                Families group products. Shopify IDs and SKU/barcode mappings
                identify them; location assignments describe where they are
                kept. These records do not edit Shopify.
              </p>
              {data.products.map((p) => (
                <details key={p.id}>
                  <summary>
                    {p.title} · {p.family}
                  </summary>
                  {editor("product", productFields, p)}
                </details>
              ))}
              <details>
                <summary>Register a product</summary>
                {editor("product", productFields)}
              </details>
              {data.variants.map((v) => (
                <details key={v.id}>
                  <summary>
                    {v.sku} · {v.verified ? "verified mapping" : "unverified"}
                  </summary>
                  {editor("variant", variantFields, v)}
                </details>
              ))}
              <details>
                <summary>Register a variant / barcode</summary>
                {editor("variant", variantFields)}
              </details>
            </section>
            <section className="loyalty-card">
              <h2>Assign or move a product</h2>
              <p>
                Moving an assignment preserves the product, variant and printed
                QR identity. It never transfers Shopify stock.
              </p>
              {data.assignments.map((a) => (
                <details key={a.id}>
                  <summary>
                    {variants.find((v) => v.id === a.variant_id)?.label ||
                      "Variant"}{" "}
                    →{" "}
                    {locations.find((l) => l.id === a.location_id)?.label ||
                      "Inactive location"}
                  </summary>
                  {editor(
                    "assignment",
                    [
                      field("variant_id", "Variant", {
                        ...opts(variants),
                        locked: true,
                      }),
                      field(
                        "location_id",
                        "Assigned location",
                        opts(locations),
                      ),
                    ],
                    a,
                  )}
                </details>
              ))}
              <details>
                <summary>Add an assignment</summary>
                {editor("assignment", [
                  field("variant_id", "Variant", opts(variants)),
                  field("location_id", "Assigned location", opts(locations)),
                ])}
              </details>
            </section>
          </Tabs.Content>
          <Tabs.Content value="qr">
            <section className="loyalty-card">
              <h2>Northside QR registry</h2>
              <p>
                Printed codes hold only an app URL with a stable opaque token.
                Product, optional variant, staff placement, campaign and
                destination stay in the server registry. Edit these mappings
                without changing the printed code.
              </p>
              {fixture && (
                <p className="small">
                  SAMPLE downloads contain a /q/sample/ URL. Test them in the
                  staff scanner; public sample URLs stay disabled. Do not print
                  these labels for customers.
                </p>
              )}
              {!data.qr_origin && (
                <p className="loyalty-notice">
                  Label downloads need the verified Northside app domain to be
                  configured first.
                </p>
              )}
              {data.qrs.map((q) => (
                <article className="store-label" key={q.id}>
                  <h3>
                    {products.find((p) => p.id === q.product_id)?.label ||
                      "Product"}{" "}
                    · {q.active ? "active registry entry" : "disabled"}
                  </h3>
                  <code className="loyalty-code">{q.token}</code>
                  {data.qr_origin && (
                    <label>
                      {fixture
                        ? "SAMPLE code for manual scanner"
                        : "Northside code for manual scanner"}
                      <input
                        readOnly
                        value={
                          data.qr_origin +
                          (fixture ? "/q/sample/" : "/q/") +
                          q.token
                        }
                      />
                    </label>
                  )}
                  <div className="actions">
                    {q.active &&
                      data.qr_origin &&
                      ["svg", "png"].map((format) => (
                        <a
                          className="button secondary"
                          key={format}
                          href={
                            endpoint +
                            (endpoint.includes("?") ? "&" : "?") +
                            "label=" +
                            q.id +
                            "&format=" +
                            format
                          }
                          download
                        >
                          {fixture ? "SAMPLE " : ""}
                          {format.toUpperCase()} label
                        </a>
                      ))}
                  </div>
                  <details>
                    <summary>Edit QR destination</summary>
                    {editor("qr", qrFields, q)}
                  </details>
                </article>
              ))}
              <details>
                <summary>Create a QR label</summary>
                {editor("qr", qrFields)}
              </details>
              <p>
                <a
                  href="https://help.shopify.com/en/manual/promoting-marketing/create-marketing/shopcodes"
                  target="_blank"
                  rel="noreferrer"
                >
                  Shopify Shopcodes
                </a>{" "}
                remain an option for Shopify landing links. An opaque Shopcode
                is not a verified variant or an app cart instruction.
              </p>
            </section>
          </Tabs.Content>
          <Tabs.Content value="scanner">
            <StoreScanner endpoint={endpoint} fixture={fixture} />
          </Tabs.Content>
          <Tabs.Content value="pickup">
            <section className="loyalty-card">
              <h2>Pickup workflow rehearsal</h2>
              <p>
                Paid → Preparing → Ready → Collected. These are separate audited
                staff steps. A real paid order must eventually be verified
                through Shopify; readiness requires a staff stock and
                fulfillment check, and collection requires verified customer
                handoff.
              </p>
              <p className="loyalty-notice">
                {fixture
                  ? "SAMPLE rehearsal only — no real payment, reservation, ready notice or handoff occurs."
                  : "Live pickup recording is disabled until the store and fulfillment workflow are verified."}
              </p>
              {fixture && (
                <>
                  {data.pickups.map((p) => (
                    <details key={p.id}>
                      <summary>
                        {p.order_id} · {p.state}
                      </summary>
                      {editor(
                        "pickup",
                        [
                          field("customer_id", "Sample customer", {
                            ...opts(
                              data.customers.map((c) => ({
                                id: c.id,
                                label: c.display_name,
                              })),
                            ),
                            locked: true,
                          }),
                          field("order_id", "SAMPLE order reference", {
                            locked: true,
                          }),
                          field(
                            "state",
                            "Next rehearsal step",
                            opts(
                              pickupStates
                                .filter((s) => pickupNext(p.state, s))
                                .map((s) => ({ id: s, label: s })),
                            ),
                          ),
                        ],
                        p,
                      )}
                    </details>
                  ))}
                  <details>
                    <summary>Start a SAMPLE paid-order rehearsal</summary>
                    {editor("pickup", [
                      field(
                        "customer_id",
                        "Sample customer",
                        opts(
                          data.customers.map((c) => ({
                            id: c.id,
                            label: c.display_name,
                          })),
                        ),
                      ),
                      field("order_id", "SAMPLE order reference"),
                      field(
                        "state",
                        "Rehearsal state",
                        opts([{ id: "paid", label: "SAMPLE paid" }]),
                      ),
                    ])}
                  </details>
                </>
              )}
            </section>
          </Tabs.Content>
          <Tabs.Content value="audit">
            <section className="loyalty-card">
              <h2>Store change history</h2>
              <p>
                Private reasons and staff actions are retained in an append-only
                audit.
              </p>
              {data.audit.map((a) => (
                <article className="store-audit" key={a.id}>
                  <strong>{a.action.replaceAll("_", " ")}</strong>
                  <p>{a.reason}</p>
                  <time>
                    {new Date(a.created_at).toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                    })}{" "}
                    Chicago
                  </time>
                </article>
              ))}
            </section>
          </Tabs.Content>
        </Tabs.Root>
      ) : (
        !error && <p role="status">Loading store workspace…</p>
      )}
      <p className="loyalty-footnote">
        Real floor plan, barcode verification, camera tests on iPhone and
        Android, physical store readiness and Shopify fulfillment checks remain
        required before activation.
      </p>
    </div>
  );
}
