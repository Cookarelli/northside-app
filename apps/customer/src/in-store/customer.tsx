"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Product, PublicSession, Mapping } from "@northside/domain";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const labels: Record<string, string> = {
  shopping: "Building your basket",
  awaiting_counter_payment: "Waiting for counter payment",
  paid_awaiting_preparation: "Payment confirmed · preparing",
  ready: "Ready to collect",
  collected: "Collected. Enjoy your finds!",
  cancelled: "Session closed",
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/in-store/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Please try again."), {
      status: response.status,
    });
  return data;
}
function ProductArt({ product }: { product: Product }) {
  return (
    <div className={`product-art ${product.color}`} aria-hidden="true">
      <div className="art-shadow" />
      <div className="pack">
        <span>NORTHSIDE</span>
        <strong>{product.mark}</strong>
        <small>THE COLLECTOR SERIES</small>
      </div>
      <span className="art-tag">SAMPLE ARTWORK</span>
    </div>
  );
}
export default function Customer({ path }: { path: string[] }) {
  const page = path[0] || "home";
  const staff = page === "staff";
  const [items, setItems] = useState<Product[]>([]);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("disconnected");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [lookup, setLookup] = useState("");
  const [variant, setVariant] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [queue, setQueue] = useState<PublicSession[] | null>(null);
  const [password, setPassword] = useState("");
  const [reference, setReference] = useState("");
  const [collection, setCollection] = useState("");
  const [opened, setOpened] = useState<PublicSession | null>(null);
  const [lastReset, setLastReset] = useState(0);
  const lastInteraction = useRef(Date.now());
  const lastTouch = useRef(0);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reset = async (shared = session?.shared ?? false) => {
    if (shared) {
      setSession(null);
      setOpened(null);
      setReference("");
      setCollection("");
      setPassword("");
    }
    const s = await api<PublicSession>("session", { shared });
    setSession(s);
    setOpened(null);
    setReference("");
    setCollection("");
    setPassword("");
    lastInteraction.current = Date.now();
    setLastReset(Date.now());
  };
  useEffect(() => {
    let gone = false;
    api<{ mode: string; products: Product[] }>("catalog")
      .then((d) => {
        if (!gone) {
          setItems(d.products);
          setMode(d.mode);
        }
      })
      .catch((e) => setMessage(e.message));
    if (staff) {
      api<PublicSession[]>("staff/queue")
        .then(setQueue)
        .catch(() => setQueue(null));
      const query = new URLSearchParams(window.location.search);
      setReference(query.get("handoff") ?? "");
      setCollection(query.get("collection") ?? "");
    } else {
      api<PublicSession>("session")
        .then((s) => {
          if (!gone) setSession(s);
        })
        .catch(async (e) => {
          if (e.status === 401) {
            const s = await api<PublicSession>("session", {
              shared:
                new URLSearchParams(window.location.search).get("shared") ===
                "1"
                  ? true
                  : undefined,
            });
            if (!gone) setSession(s);
          } else setMessage(e.message);
        })
        .catch((e) => {
          if (!gone) setMessage(e.message);
        });
    }
    return () => {
      gone = true;
    };
  }, [staff]);
  useEffect(() => {
    if (page === "q" && path[1])
      api<{ mapping: Mapping }>(`qr/${encodeURIComponent(path[1])}`)
        .then((r) => {
          setMapping(r.mapping);
          if (r.mapping.kind === "product")
            setVariant(r.mapping.variantId ?? "");
        })
        .catch((e) => setMessage(e.message));
  }, [page, path[1]]);
  useEffect(() => {
    if (!session?.shared || staff) return;
    function interact() {
      lastInteraction.current = Date.now();
      if (Date.now() - lastTouch.current > 15_000) {
        lastTouch.current = Date.now();
        api<PublicSession>("session/touch", {}).catch(() => {});
      }
    }
    window.addEventListener("pointerdown", interact);
    window.addEventListener("keydown", interact);
    const t = setInterval(() => {
      if (Date.now() - lastInteraction.current >= 180_000) {
        lastInteraction.current = Date.now();
        reset(true)
          .then(() =>
            setMessage(
              "The shared iPad was cleared after inactivity. A new basket is ready.",
            ),
          )
          .catch((e) => setMessage(e.message));
      }
    }, 1000);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", interact);
      window.removeEventListener("keydown", interact);
    };
  }, [session?.shared, staff]);
  useEffect(() => {
    if (page !== "status" || !session) return;
    const timer = setInterval(
      () =>
        api<PublicSession>("session")
          .then(setSession)
          .catch((e) => setMessage(e.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, [page, session?.id]);
  useEffect(() => {
    if (!session?.shared || session.phase !== "collected") return;
    const timer = setTimeout(
      () => reset(true).catch((e) => setMessage(e.message)),
      20_000,
    );
    return () => clearTimeout(timer);
  }, [session?.phase, session?.shared]);
  const selected =
    page === "product"
      ? items.find((p) => p.id === path[1])
      : mapping?.kind === "product"
        ? items.find((p) => p.id === mapping.productId)
        : undefined;
  const selectedVariant =
    selected?.variants.find((v) => v.id === variant) ??
    (selected?.variants.length === 1 ? selected.variants[0] : undefined);
  const count = session?.lines.reduce((a, l) => a + l.quantity, 0) ?? 0;
  async function add() {
    if (!session || !selectedVariant)
      throw new Error("Choose a pack, box or case first.");
    const current =
      session.lines.find((l) => l.variantId === selectedVariant.id)?.quantity ??
      0;
    setSession(
      await api("basket", {
        version: session.version,
        variantId: selectedVariant.id,
        quantity: current + quantity,
      }),
    );
    setMessage("Added to your basket. Staff will retrieve it after payment.");
  }
  async function loadQueue() {
    setQueue(await api("staff/queue"));
  }
  function grid(list = items) {
    return (
      <div className="product-grid">
        {list.map((p) => (
          <a
            className="product-card"
            href={`/in-store/product/${p.id}`}
            key={p.id}
          >
            <ProductArt product={p} />
            <div className="product-info">
              <span className="eyebrow">
                {p.variants.every((v) => !v.available)
                  ? "Currently unavailable"
                  : "Available to explore"}
              </span>
              <h3>
                {p.title}
                <span>↗</span>
              </h3>
              <p>
                {p.variants.map((v) => v.unit).join(" / ")}
                <strong>
                  From {money(Math.min(...p.variants.map((v) => v.cents)))}
                </strong>
              </p>
            </div>
          </a>
        ))}
      </div>
    );
  }
  const home = (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">GOOD FINDS. GOOD COMPANY.</span>
          <h1>
            Your next favorite
            <br />
            <em>is right here.</em>
          </h1>
          <p>
            Explore the collection. Scan what catches your eye.
            <br className="desktop" /> We’ll take care of the rest.
          </p>
          <div className="actions">
            <a className="button primary" href="/in-store/scan">
              Scan a product <span>⌁</span>
            </a>
            <a className="text-link" href="/in-store/q/C001">
              Explore the collection ↗
            </a>
          </div>
          <div className="hero-note">
            <span>01 / SCAN</span>
            <span>02 / PAY</span>
            <span>03 / COLLECT</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun">N</div>
          <div className="hero-card back">
            <small>NORTHSIDE ORIGINALS</small>
            <strong>
              FIND
              <br />
              YOUR
              <br />
              PEOPLE.
            </strong>
            <span>EST. FOR THE COLLECTORS</span>
          </div>
          <div className="hero-card front">
            <small>THE NEXT GREAT FIND</small>
            <div className="star">✳</div>
            <strong>
              MAKE IT
              <br />
              YOURS.
            </strong>
            <span>NORTHSIDE / NO. 001</span>
          </div>
          <div className="round-stamp">
            SCAN IT
            <br />
            LOVE IT
            <br />
            COLLECT IT
          </div>
        </div>
      </section>
      <section className="catalog-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              A LITTLE SOMETHING FOR YOUR COLLECTION
            </span>
            <h2>The starting lineup</h2>
          </div>
          <a href="/in-store/q/C001" className="text-link">
            View collection ↗
          </a>
        </div>
        {grid()}
      </section>
      <section className="how">
        <div>
          <b>01</b>
          <h3>Find your favorite</h3>
          <p>
            Scan the label or browse here. Confirm the exact pack, box, case or
            single.
          </p>
        </div>
        <div>
          <b>02</b>
          <h3>Make it yours</h3>
          <p>Review your basket and bring your handoff code to the counter.</p>
        </div>
        <div>
          <b>03</b>
          <h3>We’ll get it ready</h3>
          <p>
            The team retrieves your merchandise. Show your collection code when
            it’s ready.
          </p>
        </div>
      </section>
    </>
  );
  return (
    <div className="northside-in-store">
      <div className="prototype-bar">
        <span className="dot" />
        {mode === "fixture"
          ? "LOCAL FIXTURE EXPERIENCE · Sample products · No real charges"
          : "SHOPIFY INTEGRATION · Setup required"}
        <a href="/in-store/staff">Staff access ↗</a>
      </div>
      <header>
        <a href="/in-store/" className="brand">
          <Image
            src="/northside-logo.svg"
            width={207}
            height={57}
            alt="Northside Collectibles"
            priority
          />
        </a>
        <nav aria-label="Main navigation">
          <a className={page === "home" ? "active" : ""} href="/in-store/">
            Explore
          </a>
          <a className={page === "scan" ? "active" : ""} href="/in-store/scan">
            Scan
          </a>
          <a
            className={page === "membership" ? "active" : ""}
            href="/in-store/membership"
          >
            Membership
          </a>
          <a
            className={page === "status" ? "active" : ""}
            href="/in-store/status"
          >
            Order status
          </a>
        </nav>
        <a className="basket-link" href="/in-store/basket">
          Basket <span>{count}</span>
        </a>
      </header>
      {!staff && session?.shared && (
        <div className="shared-bar">
          <span>Shared iPad · Clears after 3 minutes of inactivity</span>
          <button onClick={() => action(() => reset(true))}>Start over</button>
        </div>
      )}
      <main key={lastReset}>
        {message && (
          <div className="notice" role="status">
            {message}
            {message.includes("Sign out of the existing") && (
              <a href="/signed-out" className="text-link">
                Sign out securely →
              </a>
            )}
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              ×
            </button>
          </div>
        )}
        {(page === "home" || (page === "q" && mapping?.kind === "entry")) &&
          home}
        {page === "q" && mapping?.kind === "collection" && (
          <section className="page-section">
            <span className="eyebrow">THE NORTHSIDE COLLECTION</span>
            <h1>{mapping.title}</h1>
            <p className="intro">
              Choose a product to confirm its unit and current availability.
            </p>
            {grid(items.filter((p) => mapping.productIds.includes(p.id)))}
          </section>
        )}
        {selected && (
          <section className="product-detail">
            <ProductArt product={selected} />
            <div>
              <a href="/in-store/q/C001" className="text-link">
                ← Back to collection
              </a>
              <span className="eyebrow detail-label">
                NORTHSIDE · FIXTURE PRODUCT
              </span>
              <h1>{selected.title}</h1>
              <p className="intro">{selected.description}</p>
              <label>
                Choose your unit
                <select
                  value={selectedVariant?.id ?? ""}
                  onChange={(e) => setVariant(e.target.value)}
                >
                  <option value="" disabled>
                    Select a variant
                  </option>
                  {selected.variants.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.title} · {v.unit} · {money(v.cents)}
                      {!v.available ? " · Unavailable" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {selectedVariant && (
                <p className="price">
                  {money(selectedVariant.cents)}{" "}
                  <small>per {selectedVariant.unit}</small>
                </p>
              )}
              <label>
                Quantity
                <input
                  aria-label="Quantity"
                  type="number"
                  min="1"
                  max="50"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </label>
              <button
                className="button primary full"
                disabled={busy || !selectedVariant?.available || !session}
                onClick={() => action(add)}
              >
                {selectedVariant && !selectedVariant.available
                  ? "Currently unavailable"
                  : "Add to basket +"}
              </button>
              <p className="muted">
                Your basket doesn’t reserve inventory. Staff retrieves
                merchandise after payment.
              </p>
              <a className="text-link" href="/in-store/basket">
                View basket →
              </a>
            </div>
          </section>
        )}
        {page === "scan" && (
          <section className="page-section narrow">
            <span className="eyebrow">FIND SOMETHING GOOD</span>
            <h1>One scan away.</h1>
            <p className="intro">
              Use your phone’s camera to scan a Northside label. The product
              opens here for you to confirm before adding it.
            </p>
            <div className="scan-frame" aria-hidden="true">
              <span>⌗</span>
              <p>Point your camera at a Northside QR</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  const result = await api<{ code: string }>(
                    `qr/${encodeURIComponent(lookup.trim())}`,
                  );
                  window.location.assign(`/in-store/q/${result.code}`);
                });
              }}
            >
              <label>
                Can’t scan? Enter the short label code
                <input
                  placeholder="e.g. N001"
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  autoCapitalize="characters"
                  required
                />
              </label>
              <button disabled={busy} className="button primary full">
                Find product →
              </button>
            </form>
            <div className="sample-codes">
              <span>Try a fixture label</span>
              <a href="/in-store/q/N001">N001 · Pack</a>
              <a href="/in-store/q/N002">N002 · Box or case</a>
              <a href="/in-store/q/C001">C001 · Collection</a>
            </div>
          </section>
        )}
        {page === "basket" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOUR FINDS, ALL TOGETHER</span>
                <h1>
                  Your basket <small>({count})</small>
                </h1>
              </div>
              <a href="/in-store/scan" className="text-link">
                Scan another item +
              </a>
            </div>
            {!session?.lines.length ? (
              <div className="empty">
                <span>✳</span>
                <h2>Something good is waiting.</h2>
                <p>
                  Scan a label or explore the collection to start your basket.
                </p>
                <a href="/in-store/q/C001" className="button primary">
                  Explore the collection →
                </a>
              </div>
            ) : (
              <div className="basket-layout">
                <div>
                  {session.lines.map((l) => (
                    <div className="basket-row" key={l.variantId}>
                      <div className="mini-pack">N</div>
                      <div className="basket-title">
                        <h3>{l.title}</h3>
                        <p>
                          {money(l.cents)} per {l.unit}
                        </p>
                        <button
                          className="text-button"
                          disabled={busy || session.phase !== "shopping"}
                          onClick={() =>
                            action(async () =>
                              setSession(
                                await api("basket", {
                                  version: session.version,
                                  variantId: l.variantId,
                                  quantity: 0,
                                }),
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <label className="quantity-label">
                        Qty
                        <select
                          aria-label={`Quantity for ${l.title}`}
                          value={l.quantity}
                          disabled={busy || session.phase !== "shopping"}
                          onChange={(e) =>
                            action(async () =>
                              setSession(
                                await api("basket", {
                                  version: session.version,
                                  variantId: l.variantId,
                                  quantity: Number(e.target.value),
                                }),
                              ),
                            )
                          }
                        >
                          {Array.from({ length: 50 }, (_, i) => i + 1).map(
                            (n) => (
                              <option key={n}>{n}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <strong>{money(l.cents * l.quantity)}</strong>
                    </div>
                  ))}
                  <p className="muted">
                    Items are not reserved. Availability and prices are checked
                    again at handoff.
                  </p>
                </div>
                <aside className="summary">
                  <span className="eyebrow">THE GOOD STUFF</span>
                  <h2>Basket summary</h2>
                  <div className="total">
                    <span>Estimated subtotal</span>
                    <strong>{money(session.total)}</strong>
                  </div>
                  <p>
                    Taxes and discounts are finalized by Shopify. No real
                    charges in this fixture prototype.
                  </p>
                  {session.phase === "shopping" ? (
                    <>
                      <button
                        disabled={busy}
                        className="button primary full"
                        onClick={() =>
                          action(async () => {
                            await api("checkout", {});
                          })
                        }
                      >
                        Pay now with Shopify ↗
                      </button>
                      <button
                        disabled={busy}
                        className="button secondary full"
                        onClick={() =>
                          action(async () => {
                            setSession(
                              await api("handoff", {
                                version: session.version,
                              }),
                            );
                            window.location.assign("/in-store/status");
                          })
                        }
                      >
                        Pay at counter →
                      </button>
                    </>
                  ) : (
                    <a className="button primary full" href="/in-store/status">
                      View handoff / order status →
                    </a>
                  )}
                  <p className="muted">
                    {session.shared
                      ? "Shared iPad: take your code to staff to pay."
                      : "Online checkout is pending Shopify setup. Try the counter flow locally."}
                  </p>
                </aside>
              </div>
            )}
          </section>
        )}
        {page === "status" && (
          <section className="page-section narrow">
            <span className="eyebrow">WE’LL TAKE IT FROM HERE</span>
            <h1>Your order status.</h1>
            {!session || session.phase === "shopping" ? (
              <div className="empty">
                <h2>Your next find starts here.</h2>
                <p>Review your basket and choose a payment path first.</p>
                <a href="/in-store/basket" className="button primary">
                  Open basket →
                </a>
              </div>
            ) : (
              <div className="status-card">
                <span className="status-symbol">
                  {session.phase === "collected" ? "✓" : "✳"}
                </span>
                <h2>{labels[session.phase]}</h2>
                <p>
                  {session.phase === "awaiting_counter_payment"
                    ? "This is an unpaid basket. Show this handoff to a team member at the counter."
                    : session.phase === "ready"
                      ? "Show the paid collection code below. A team member will confirm collection."
                      : session.phase === "collected"
                        ? "Your merchandise has been collected. Thanks for stopping by."
                        : "Your payment is recorded. Staff are getting your merchandise ready."}
                </p>
                {session.payment?.source === "fixture" && (
                  <div className="fixture-badge">
                    SIMULATED FIXTURE PAYMENT · No money charged
                  </div>
                )}
                {session.phase === "awaiting_counter_payment" &&
                  session.handoff && (
                    <>
                      <img
                        className="qr-image"
                        src="/api/in-store/code-image"
                        alt="Unpaid counter handoff QR"
                        width="288"
                        height="288"
                      />
                      <div className="code-label">UNPAID COUNTER HANDOFF</div>
                      <strong className="fallback-code">
                        {session.handoff.code}
                      </strong>
                      <p>
                        Expires{" "}
                        {new Date(session.handoff.expiresAt).toLocaleTimeString(
                          "en-US",
                          {
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: "America/Chicago",
                          },
                        )}
                        . Basket version {session.handoff.version} is frozen.
                      </p>
                      {!session.handoff.claimedAt && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              setSession(await api("handoff/revoke", {}));
                              window.location.assign("/in-store/basket");
                            })
                          }
                        >
                          Cancel handoff and edit basket
                        </button>
                      )}
                    </>
                  )}
                {session.collectionCode && session.phase !== "collected" && (
                  <>
                    <img
                      className="qr-image"
                      src="/api/in-store/code-image?type=collection"
                      alt="Paid collection code"
                      width="288"
                      height="288"
                    />
                    <div className="code-label">
                      PAID COLLECTION · STAFF MUST VERIFY
                    </div>
                    <strong className="fallback-code">
                      {session.collectionCode}
                    </strong>
                  </>
                )}
                {session.phase === "collected" && (
                  <button
                    className="button primary"
                    onClick={() => action(() => reset())}
                  >
                    Start a fresh basket →
                  </button>
                )}
                <p className="muted">
                  Status is checked from the server. A QR or browser return
                  never proves payment.
                </p>
              </div>
            )}
          </section>
        )}
        {page === "membership" && (
          <section className="page-section membership">
            <div>
              <span className="eyebrow">A PLACE FOR YOUR PEOPLE</span>
              <h1>
                More than
                <br />
                <em>a collection.</em>
              </h1>
              <p className="intro">
                We’re building a little more belonging into every visit.
              </p>
              <p>
                Membership is taking shape. Customer accounts, points, tiers and
                rewards will be connected to verified Shopify activity when the
                program is ready.
              </p>
              <div className="coming">
                IN THE WORKS · No earning rules or rewards are active
              </div>
              <a href="/in-store/" className="button primary">
                Keep exploring →
              </a>
            </div>
            <div className="member-card">
              <span>NORTHSIDE / MEMBERSHIP</span>
              <strong>
                YOU
                <br />
                BELONG
                <br />
                HERE.
              </strong>
              <p>GOOD FINDS. GOOD COMPANY.</p>
              <span>PROGRAM COMING LATER</span>
            </div>
          </section>
        )}
        {staff && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">NORTHSIDE TEAM</span>
                <h1>Counter & collection</h1>
              </div>
              {queue && (
                <button
                  className="text-button"
                  onClick={() =>
                    action(async () => {
                      await api("staff/logout", {});
                      setQueue(null);
                      setOpened(null);
                    })
                  }
                >
                  Sign out
                </button>
              )}
            </div>
            {!queue ? (
              <form
                className="login-card"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await api("staff/login", { password });
                    setPassword("");
                    await loadQueue();
                  });
                }}
              >
                <h2>Staff sign in</h2>
                <p>
                  Use the separate staff password from your local environment
                  file.
                </p>
                <label>
                  Staff password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <button disabled={busy} className="button primary full">
                  Open staff queue →
                </button>
              </form>
            ) : (
              <>
                <div className="staff-tools">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        let input = reference.trim();
                        try {
                          input =
                            new URL(input).searchParams.get("handoff") ?? input;
                        } catch {}
                        setOpened(
                          await api("staff/handoff", { reference: input }),
                        );
                      });
                    }}
                  >
                    <label>
                      Open an unpaid handoff
                      <input
                        placeholder="Handoff code or scanned URL"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        required
                      />
                    </label>
                    <button disabled={busy} className="button primary">
                      Look up basket →
                    </button>
                  </form>
                  <div>
                    <span className="eyebrow">
                      PAYMENT & COLLECTION ARE SEPARATE
                    </span>
                    <p>
                      Only verified paid orders move to preparation. A
                      collection code authorizes one collection after staff
                      checks server state.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => action(loadQueue)}
                    >
                      Refresh queue ↻
                    </button>
                  </div>
                </div>
                {opened && (
                  <div className="opened-handoff">
                    <h2>Unpaid basket · {opened.handoff?.code}</h2>
                    {opened.lines.map((l) => (
                      <p key={l.variantId}>
                        {l.quantity} × {l.title} ({l.unit})
                      </p>
                    ))}
                    <p>
                      <strong>{money(opened.total)}</strong> · Version{" "}
                      {opened.version}
                    </p>
                    <button
                      disabled={busy || !!opened.handoff?.claimedAt}
                      className="button primary"
                      onClick={() =>
                        action(async () => {
                          setOpened(
                            await api("staff/claim", {
                              reference: opened.handoff!.reference,
                            }),
                          );
                          await loadQueue();
                        })
                      }
                    >
                      {opened.handoff?.claimedAt
                        ? "Claimed — do not import again"
                        : "Claim handoff for counter"}
                    </button>
                    <p className="muted">
                      Local claim only. Shopify POS import is an uninstalled
                      prototype.
                    </p>
                  </div>
                )}
                <div className="queue">
                  {queue.length === 0 ? (
                    <div className="empty">
                      <h2>The queue is clear.</h2>
                      <p>
                        Customer counter handoffs and paid orders appear here.
                      </p>
                    </div>
                  ) : (
                    queue.map((s) => (
                      <article key={s.id} className="queue-card">
                        <div>
                          <span className="eyebrow">{s.id.slice(0, 8)}</span>
                          <h3>{labels[s.phase]}</h3>
                          <p>
                            {s.lines
                              .map((l) => `${l.quantity} × ${l.title}`)
                              .join(" · ")}
                          </p>
                          <strong>{money(s.total)}</strong>
                          {s.payment?.source === "fixture" && (
                            <span className="fixture-badge">
                              SIMULATED · NO CHARGE
                            </span>
                          )}
                        </div>
                        <div className="queue-controls">
                          {s.phase === "awaiting_counter_payment" &&
                            !s.handoff?.claimedAt && (
                              <button
                                className="button secondary"
                                onClick={() => {
                                  setOpened(s);
                                  setReference(s.handoff?.code ?? "");
                                }}
                              >
                                Open handoff
                              </button>
                            )}
                          {s.phase === "awaiting_counter_payment" &&
                            s.handoff?.claimedAt &&
                            mode === "fixture" && (
                              <button
                                disabled={busy}
                                className="button secondary"
                                onClick={() =>
                                  action(async () => {
                                    await api("staff/fixture-payment", {
                                      id: s.id,
                                    });
                                    await loadQueue();
                                  })
                                }
                              >
                                Simulate fixture payment
                              </button>
                            )}
                          {s.phase === "paid_awaiting_preparation" && (
                            <button
                              disabled={busy}
                              className="button primary"
                              onClick={() =>
                                action(async () => {
                                  await api("staff/transition", {
                                    id: s.id,
                                    next: "ready",
                                  });
                                  await loadQueue();
                                })
                              }
                            >
                              Mark ready for collection
                            </button>
                          )}
                          {s.phase === "ready" && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                action(async () => {
                                  await api("staff/transition", {
                                    id: s.id,
                                    next: "collected",
                                    collectionCode: collection.trim(),
                                  });
                                  setCollection("");
                                  await loadQueue();
                                });
                              }}
                            >
                              <label>
                                Customer collection code
                                <input
                                  value={collection}
                                  onChange={(e) =>
                                    setCollection(e.target.value)
                                  }
                                  required
                                />
                              </label>
                              <button
                                disabled={busy}
                                className="button primary"
                              >
                                Verify & collect once
                              </button>
                            </form>
                          )}
                          {s.phase === "collected" && (
                            <span className="collected">
                              ✓ Collection recorded
                            </span>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        )}
        {![
          "home",
          "q",
          "product",
          "scan",
          "basket",
          "status",
          "membership",
          "staff",
        ].includes(page) && (
          <section className="empty">
            <h1>That page isn’t here.</h1>
            <a href="/in-store/">Return to Northside</a>
          </section>
        )}
      </main>
      <footer>
        <a className="brand" href="/in-store/">
          <Image
            src="/northside-logo.svg"
            width={160}
            height={44}
            alt="Northside Collectibles"
          />
        </a>
        <p>A good place to find your next favorite.</p>
        <div>
          <span>Local fixture prototype · USD sample prices</span>
          {!staff && (
            <button
              className="text-button"
              onClick={() => action(() => reset(!session?.shared))}
            >
              {session?.shared
                ? "Switch to personal device"
                : "Use as shared store iPad"}
            </button>
          )}
        </div>
      </footer>
      <div className="mobile-nav">
        <a href="/in-store/">Explore</a>
        <a href="/in-store/scan">Scan</a>
        <a href="/in-store/basket">Basket ({count})</a>
        <a href="/in-store/status">Status</a>
      </div>
    </div>
  );
}
