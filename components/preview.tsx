"use client";
import Link from "next/link";
import { NextBreak } from "./break-workspace";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { shopLink } from "@/lib/commerce";
import { createContext, useContext, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Home,
  ShoppingBag,
  Radio,
  Layers,
  User,
  ArrowUpRight,
  ArrowRight,
  ShoppingCart,
  ChevronRight,
  ShieldCheck,
  Package,
  Star,
} from "lucide-react";
import type { PreviewData, Product, CardCase } from "@/lib/contracts";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const date = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(v));
type State = {
  data: PreviewData;
  signed: boolean;
  setSigned: (v: boolean) => void;
  cart: Record<string, number>;
  setCart: React.Dispatch<React.SetStateAction<Record<string, number>>>;
};
const Context = createContext<State | null>(null);
function usePreview() {
  return useContext(Context)!;
}
const nav = [
  ["/", "Home", Home],
  ["/shop", "Shop", ShoppingBag],
  ["/breaks", "Breaks", Radio],
  ["/my-cards", "My Cards", Layers],
  ["/account", "Account", User],
] as const;
export function Shell({
  data,
  children,
}: {
  data: PreviewData;
  children: React.ReactNode;
}) {
  const [signed, setSigned] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const path = usePathname();
  const staff = path.startsWith("/staff");
  return (
    <Context.Provider value={{ data, signed, setSigned, cart, setCart }}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="preview-bar">
        {data.fixture
          ? "LOCAL PREVIEW · All products, customer records, prices and dates are fixtures."
          : "PRE-LAUNCH · Purchases and rewards are not open yet."}
      </div>
      <header>
        <Link href="/" className="brand">
          <Image
            src="/northside-logo.svg"
            alt="Northside Collectibles"
            width={2070}
            height={572}
            priority
            className="northside-logo"
          />
        </Link>
        <nav aria-label="Main navigation" className="desktop-nav">
          {nav.map(([url, label]) => (
            <Link
              key={url}
              href={url}
              prefetch={false}
              aria-current={path === url ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link
          className="cart-link"
          href="/cart"
          aria-label={
            data.fixture
              ? `Cart, ${Object.values(cart).reduce((a, b) => a + b, 0)} sample items`
              : "Cart"
          }
        >
          <ShoppingCart size={21} />
          {data.fixture && (
            <span>{Object.values(cart).reduce((a, b) => a + b, 0)}</span>
          )}
        </Link>
      </header>
      {staff && (
        <div className="staff-strip">
          {data.fixture
            ? "ISOLATED STAFF PREVIEW · Sample grading, consignment, rewards, breaks and store records save locally"
            : "INVITED STAFF WORKSPACE"}
        </div>
      )}
      <main id="main">{children}</main>
      <footer>
        <span>For the love of the collection.</span>
        <span>
          Northside app ·{" "}
          <Link href="/staff">
            {data.fixture ? "Staff preview" : "Staff workspace"}
          </Link>
        </span>
      </footer>
      <nav aria-label="Mobile navigation" className="mobile-nav">
        {nav.map(([url, label, Icon]) => (
          <Link
            key={url}
            href={url}
            prefetch={false}
            aria-current={path === url ? "page" : undefined}
          >
            <Icon size={21} />
            {label}
          </Link>
        ))}
      </nav>
    </Context.Provider>
  );
}
function Intro({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
}) {
  return (
    <div className="intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {copy && <p className="lede">{copy}</p>}
    </div>
  );
}
function Empty({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="empty">
      <Package size={30} />
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}
function Art({ product }: { product: Product }) {
  return (
    <div
      className={`product-art ${product.accent}`}
      role="img"
      aria-label={`Illustrative placeholder for ${product.name}`}
    >
      <span className="art-label">SAMPLE ARTWORK</span>
      <div className="sample-box">
        <span>COLLECTOR SERIES</span>
        <Layers size={45} />
        <strong>{product.category.toUpperCase()}</strong>
        <small>ILLUSTRATION • NOT A REAL PRODUCT</small>
      </div>
    </div>
  );
}
function ProductGrid({
  products,
  back = "/shop",
}: {
  products: Product[];
  back?: string;
}) {
  return (
    <div className="product-grid">
      {products.map((p) => (
        <Link
          className="product"
          key={p.id}
          href={`/shop/${p.id}?back=${encodeURIComponent(back)}`}
        >
          <Art product={p} />
          <div className="product-copy">
            <small>{p.category} · Fixture</small>
            <h3>{p.name}</h3>
            <p>
              {money(p.priceCents)} <small>example price</small>
              <ArrowUpRight size={18} />
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
export function HomePage() {
  const { data, signed } = usePreview();
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">YOUR COLLECTION STARTS HERE</p>
          <h1>
            {signed
              ? "Welcome back, collector."
              : "The next great find.\nThe same Northside."}
          </h1>
          <p>
            Discover cards, follow the breaks, and keep your collection moving.
            All in one place.
          </p>
          <div className="actions">
            <Link className="button light" href="/shop">
              Explore the shop <ArrowRight size={18} />
            </Link>
            <Link className="text-link" href="/my-cards">
              Track my cards <ArrowUpRight size={17} />
            </Link>
          </div>
          <span className="hero-note">An early look at your Northside app</span>
        </div>
        <div
          className="hero-art"
          aria-label="Temporary collection illustration"
        >
          <div className="hero-card back">
            <Layers size={62} />
          </div>
          <div className="hero-card front">
            <span>
              THE JOY OF
              <br />
              THE FIND.
            </span>
            <Star size={54} />
            <small>SAMPLE ILLUSTRATION</small>
          </div>
          <span className="edition">CARDS. COMMUNITY. COLLECTIONS.</span>
        </div>
      </section>
      {signed && (
        <div className="notice">
          Sample signed-in view: {data.identity?.name}. This is not customer
          authentication.
        </div>
      )}
      <div className="section-heading">
        <div>
          <p className="eyebrow">FIND YOUR NEXT FAVORITE</p>
          <h2>From the card shop</h2>
        </div>
        <Link href="/shop">
          Browse all <ArrowRight size={17} />
        </Link>
      </div>
      {data.products.length ? (
        <ProductGrid products={data.products} />
      ) : (
        <Empty
          title="The catalog isn’t connected yet"
          copy="Published merchandise will appear after Shopify is connected. No sample products are substituted."
        />
      )}
      <section className="home-lower">
        <NextBreak fixture={data.fixture} />
        <div className="rewards-feature">
          <span className="round-icon">
            <Star />
          </span>
          <p className="eyebrow">NORTHSIDE REWARDS</p>
          <h2>
            A little more for
            <br />
            your next big find.
          </h2>
          <p>
            Rookie. Vet. HOF. GOAT. Get a first look at our custom rewards
            program. Rules are still awaiting approval.
          </p>
          <Link href="/rewards">
            Explore rewards <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}
export function ShopPage() {
  const { data } = usePreview();
  const params = useSearchParams();
  const query = params.get("q") || "",
    category = params.get("category") || "All";
  const rawPage = Number(params.get("page") || 1),
    requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const back = `/shop?${params.toString()}`;
  function setFilter(q: string, c: string) {
    window.history.replaceState(
      null,
      "",
      shopLink({ q, category: c === "All" ? undefined : c }),
    );
  }
  const products = data.products.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(products.length / 2)),
  );
  return (
    <>
      <Intro
        eyebrow="THE CARD SHOP"
        title="Make room for your next find."
        copy={
          data.fixture
            ? "Browse the sample collection. All prices and artwork below are illustrative; nothing is available to purchase."
            : "The catalog is disconnected. Published merchandise will appear when Shopify is configured."
        }
      />
      <div className="shop-tools">
        <label className="search">
          Search products
          <input
            value={query}
            onChange={(e) => setFilter(e.target.value, category)}
            placeholder="Search the collection…"
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setFilter(query, e.target.value)}
          >
            {["All", "Baseball", "Basketball", "Football", "Supplies"].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </select>
        </label>
      </div>
      {products.length ? (
        <ProductGrid
          products={products.slice((page - 1) * 2, page * 2)}
          back={back}
        />
      ) : (
        <Empty
          title={data.fixture ? "No matching samples" : "Catalog unavailable"}
          copy={
            data.fixture
              ? "Try a different search or category."
              : "Shopify is disconnected. Draft products remain unchanged and are not exposed here."
          }
        />
      )}
      <nav className="collection-links" aria-label="Sample product pages">
        {page > 1 && (
          <Link
            href={`${shopLink({ q: query, category: category === "All" ? undefined : category })}${query || category !== "All" ? "&" : "?"}page=${page - 1}`}
          >
            Previous samples
          </Link>
        )}
        <span>
          Sample page {page} of {Math.max(1, Math.ceil(products.length / 2))}
        </span>
        {page * 2 < products.length && (
          <Link
            href={`${shopLink({ q: query, category: category === "All" ? undefined : category })}${query || category !== "All" ? "&" : "?"}page=${page + 1}`}
          >
            Next samples →
          </Link>
        )}
      </nav>
    </>
  );
}
export function ProductPage({
  id,
  back = "/shop",
}: {
  id: string;
  back?: string;
}) {
  const { data, setCart } = usePreview();
  const [added, setAdded] = useState(false);
  const [variant, setVariant] = useState("standard");
  const p = data.products.find((x) => x.id === id);
  if (!p)
    return (
      <Empty
        title="Product unavailable"
        copy="This item is not in the available catalog."
      />
    );
  return (
    <>
      <Link className="back" href={back}>
        ← Back to shop
      </Link>
      <div className="detail-grid">
        <Art product={p} />
        <div>
          <p className="eyebrow">{p.category} · FIXTURE PRODUCT</p>
          <h1>{p.name}</h1>
          <p className="price">
            {money(p.priceCents)} <small>example USD price</small>
          </p>
          <p className="lede">{p.description}</p>
          <label>
            Sample variant
            <select
              value={variant}
              onChange={(e) => {
                setVariant(e.target.value);
                setAdded(false);
              }}
            >
              <option value="standard">Standard • example only</option>
              <option value="unavailable">
                Alternate • sample sold-out state
              </option>
            </select>
          </label>
          <button
            className="button"
            disabled={variant !== "standard"}
            onClick={() => {
              setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
              setAdded(true);
            }}
          >
            {variant === "standard"
              ? "Add to demo cart"
              : "Sample variant unavailable"}{" "}
            <ShoppingBag size={18} />
          </button>
          <p role="status">
            {added ? (
              <Link href="/cart">Added to demo cart. View cart →</Link>
            ) : (
              "Local demonstration only. No stock is reserved."
            )}
          </p>
          <div className="notice">
            Purchases, pickup and rewards redemption are disabled.
          </div>
        </div>
      </div>
    </>
  );
}
export function CartPage() {
  const { data, cart, setCart } = usePreview();
  const entries = data.products.filter((p) => cart[p.id]);
  return (
    <>
      <Intro
        eyebrow="YOUR BAG"
        title="Demo cart"
        copy="Sample items only. This cart stays in memory and clears on refresh. No live checkout can be called."
      />
      {entries.length ? (
        <>
          <div className="cart-items">
            {entries.map((p) => (
              <div className="cart-row" key={p.id}>
                <div>
                  <Link href={`/shop/${p.id}`}>
                    <h3>{p.name}</h3>
                  </Link>
                  <p>{money(p.priceCents)} · example price</p>
                </div>
                <label>
                  Quantity
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={cart[p.id]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1 && n <= 99)
                        setCart((c) => ({ ...c, [p.id]: n }));
                    }}
                  />
                </label>
                <button
                  className="plain"
                  onClick={() =>
                    setCart((c) => {
                      const n = { ...c };
                      delete n[p.id];
                      return n;
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="cart-total">
            <h2>
              Example subtotal{" "}
              {money(
                entries.reduce((s, p) => s + p.priceCents * cart[p.id], 0),
              )}
            </h2>
            <p>Not a payable total. Taxes and shipping are not calculated.</p>
            <button disabled className="button">
              Checkout disabled
            </button>
          </div>
        </>
      ) : (
        <Empty
          title="Your demo cart is empty"
          copy="Explore the sample shop to try adding an item."
        />
      )}
      <Link className="back" href="/shop">
        Continue browsing →
      </Link>
    </>
  );
}
function Timeline({ item }: { item: CardCase }) {
  return (
    <article className="case">
      <div className="case-top">
        <div>
          <small>{item.id} · SAMPLE RECORD</small>
          <h2>{item.name}</h2>
        </div>
        <span className="badge">{item.status}</span>
      </div>
      <ol className="timeline">
        {item.events.map((e, i) => (
          <li key={e.label} className={e.complete ? "complete" : ""}>
            <span className="step">{e.complete ? "✓" : i + 1}</span>
            <div>
              <h3>{e.label}</h3>
              <p>
                {e.at
                  ? `${date(e.at)} · example date`
                  : "Pending • no date promised"}
              </p>
              <small>Staff-recorded fixture • not provider verified</small>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
export function CardsPage() {
  const { data, signed } = usePreview();
  return (
    <>
      <Intro
        eyebrow="YOUR COLLECTION, IN PROGRESS"
        title="My Cards"
        copy="A clear view of each card’s journey, from intake to what’s next."
      />
      {!signed ? (
        <Empty
          title="Your collection belongs to you"
          copy="Visit Account to try the sample signed-in experience. Real Shopify login is not connected."
        />
      ) : (
        <>
          <div className="notice">
            These are fictional customer records. Dates and milestones are
            examples, not provider updates.
          </div>
          <Tabs.Root defaultValue="grading">
            <Tabs.List className="tabs" aria-label="Card services">
              <Tabs.Trigger value="grading">Grading</Tabs.Trigger>
              <Tabs.Trigger value="consignment">Consignment</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="grading">
              {data.grading.map((c) => (
                <Timeline key={c.id} item={c} />
              ))}
              <p className="fine">
                Northside examination is $5 per card. External grading,
                shipping, insurance and other fees are separate and unconfirmed.
                No provider is assigned to this sample.
              </p>
            </Tabs.Content>
            <Tabs.Content value="consignment">
              {data.consignment.map((c) => (
                <Timeline key={c.id} item={c} />
              ))}
              <div className="notice">
                Sale amount, fees and payout are unknown. Fanatics Collect data
                is disconnected; no payment is initiated here.
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </>
      )}
    </>
  );
}
export function RewardsPage() {
  const { data } = usePreview();
  const [thresholds, setThresholds] = useState([0, 1000, 5000, 10000]);
  return (
    <>
      <Intro
        eyebrow="NORTHSIDE REWARDS"
        title="Every collector has a next level."
        copy="Our own points program, built around Northside. Program not launched; earning and redemption remain inactive pending Joey’s approval."
      />
      {data.wallet ? (
        <>
          <div className="wallet">
            <div>
              <p className="eyebrow">SAMPLE WALLET • NOT A CASH BALANCE</p>
              <h2>
                {data.wallet.points.toLocaleString()}{" "}
                <small>example points</small>
              </h2>
              <p>Rookie · {data.wallet.held} sample points processing</p>
            </div>
            <button disabled className="button light">
              Redemption not available
            </button>
          </div>
          <div className="section-heading">
            <h2>The lineup</h2>
            <span>Draft tier examples</span>
          </div>
          <div className="tier-grid">
            {data.wallet.tiers.map((t, i) => (
              <div className="tier" key={t.name}>
                <span>0{i + 1}</span>
                <h2>{t.name}</h2>
                <label>
                  Example qualifying spend (USD)
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    value={thresholds[i]}
                    onChange={(e) =>
                      setThresholds((v) =>
                        v.map((x, j) =>
                          i === j ? Math.max(0, Number(e.target.value)) : x,
                        ),
                      )
                    }
                  />
                </label>
                <p>From {money(thresholds[i] * 100)} · draft</p>
              </div>
            ))}
          </div>
          <p className="fine">
            Changes only preview draft thresholds in memory. They do not
            activate rules or change points. Qualification period, exclusions,
            reward values, expiry, stacking and refund restoration remain
            unapproved.
          </p>
        </>
      ) : (
        <Empty
          title="Rewards are not launched"
          copy="The custom Northside loyalty service is not connected. No balance is being inferred."
        />
      )}
    </>
  );
}
export function AccountPage() {
  const { data, signed, setSigned, setCart } = usePreview();
  return (
    <>
      <Intro
        eyebrow="YOUR NORTHSIDE"
        title={
          signed ? "Hello, sample collector." : "A home for your collection."
        }
        copy="Your cards, orders and rewards, brought together in one account."
      />
      <div className="account-grid">
        <section className="panel">
          <ShieldCheck size={30} />
          <h2>{signed ? "Sample account active" : "Customer account"}</h2>
          <p>
            {signed
              ? data.identity?.name
              : "Real customer sign-in will use Shopify. It is not connected yet."}
          </p>
          {data.fixture && (
            <button
              className="button"
              onClick={() => {
                setSigned(!signed);
                setCart({});
              }}
            >
              {signed ? "Leave sample account" : "Try sample signed-in view"}
            </button>
          )}
          <p className="fine">
            Preview identity only. No password or personal details are
            collected.
          </p>
          <Link className="back" href="/staff/login">
            Invited staff sign-in →
          </Link>
        </section>
        <section className="panel">
          <p className="eyebrow">YOUR COLLECTOR TOOLKIT</p>
          <Link className="account-link" href="/account/breaks">
            My breaks & reminders →
          </Link>
          <Link className="account-link" href="/rewards">
            Northside Rewards <ChevronRight />
          </Link>
          <Link className="account-link" href="/my-cards">
            Grading & consignment <ChevronRight />
          </Link>
          <Link className="account-link" href="/breaks">
            Upcoming breaks <ChevronRight />
          </Link>
          <Link className="account-link" href="/account/orders">
            Sample order history →
          </Link>
          <p>
            Real order history is unavailable until Shopify is connected. The
            sample history above is fictional.
          </p>
        </section>
      </div>
    </>
  );
}
export function StaffPage() {
  const { data } = usePreview();
  return (
    <>
      <Intro
        eyebrow="STAFF WORKSPACE • LOCAL ONLY"
        title="Preview settings"
        copy="A read-only fixture view of launch readiness. Hosted staff authentication and operational records are not connected."
      />
      {!data.fixture ? (
        <Empty
          title="Staff access unavailable"
          copy="Invited staff authentication will be implemented in Prompt 2."
        />
      ) : (
        <>
          <div className="notice">
            <strong>Live catalog: empty / disconnected.</strong> All Shopify
            products are currently Draft. An empty published catalog is
            expected. No products, inventory or fulfillment settings have been
            changed.
          </div>
          <div className="account-grid">
            <section className="panel">
              <h2>Integration health</h2>
              <Link className="back" href="/staff/integrations">
                View detailed connection status →
              </Link>
              {[
                "Shopify catalog & checkout",
                "Customer Account API",
                "Supabase / staff identity",
                "Grading provider feeds",
                "Fanatics Collect feed",
              ].map((s) => (
                <div className="setting" key={s}>
                  <span>{s}</span>
                  <span>Disconnected</span>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>Public feature gates</h2>
              {[
                "Purchases",
                "Loyalty earning",
                "Reward redemption",
                "Barcode scanning",
                "Aisle navigation",
                "Pickup",
              ].map((s) => (
                <div className="setting" key={s}>
                  <span>{s}</span>
                  <span>Disabled</span>
                </div>
              ))}
            </section>
          </div>
          <section className="panel">
            <h2>Inputs still needed</h2>
            <p>
              Approved brand guide; Joey’s loyalty rules; Shopify and Supabase
              setup; sanitized intake sheets; confirmed break channels and
              dates; Fanatics data contract.
            </p>
            <p>
              Future store plan: eight editable aisles. Northside Retail Floor,
              Northside Breaker Storage and Northside Excess Storage remain
              separate. Second grading provider “BGP” is unconfirmed.
            </p>
            <Link href="/rewards">Open saved sample rewards wallet →</Link>
            <Link href="/staff/breaks">Open saved sample break desk →</Link>
          </section>
        </>
      )}
    </>
  );
}
export function OrdersPreview() {
  const { signed } = usePreview();
  return (
    <>
      <Intro
        eyebrow="FIXTURE ACCOUNT"
        title="Sample order history"
        copy="These are fictional order states for local review. No payment was made."
      />
      {signed ? (
        <>
          <article className="case">
            <h2>Example order A</h2>
            <p>Sample paid state · $85.00 example total</p>
          </article>
          <article className="case">
            <h2>Example order B</h2>
            <p>
              Sample partially refunded state · $125.00 example original total ·
              $25.00 example refund
            </p>
          </article>
        </>
      ) : (
        <Empty
          title="Try the sample account first"
          copy="The sample signed-in view unlocks fictional order history."
        />
      )}
      <Link className="back" href="/account">
        ← Back to account
      </Link>
    </>
  );
}
