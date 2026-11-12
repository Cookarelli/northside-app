"use client";
import { useState, useRef, useEffect } from "react";
import { Camera, ScanLine } from "lucide-react";
import {
  ScanDeduplicator,
  type ScanResult,
  type StoreProduct,
} from "@/lib/store";
import { publicFlags } from "@/lib/policy.mjs";
let decoder: Promise<typeof import("zxing-wasm/reader")> | undefined;
async function reader() {
  decoder ??= (async () => {
    const m = await import("zxing-wasm/reader");
    await m.prepareZXingModule({
      overrides: {
        locateFile: (path: string) => "/vendor/zxing-wasm/3.1.4/" + path,
      },
      fireImmediately: true,
    });
    return m;
  })();
  return decoder;
}
const friendly = (e: unknown) => {
  const s = e instanceof Error ? e.message : String(e);
  if (/NotAllowed|Permission|permission/.test(s))
    return "Camera access was declined. Allow it in browser settings, enter a code or choose a saved label image.";
  if (/NotFound|NotReadable|camera_unavailable/.test(s))
    return "A camera is unavailable. Enter a code or choose a saved label image.";
  if (/shopcode|foreign|unsupported|malformed/.test(s))
    return "This code is not a supported Northside label or a verified product barcode. Opaque Shopify Shopcodes cannot be treated as cart items. Check the barcode or ask staff for help.";
  return s.replaceAll("_", " ");
};
export function StoreScanner({
  endpoint,
  fixture,
  shopping,
}: {
  endpoint: string;
  fixture: boolean;
  shopping?: {
    locked: boolean;
    add: (
      code: string,
      variantId: string,
      reviewedPriceCents: number,
    ) => Promise<void>;
  };
}) {
  const [code, setCode] = useState(""),
    [resolvedCode, setResolvedCode] = useState(""),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<StoreProduct[]>([]),
    [searched, setSearched] = useState(false),
    [result, setResult] = useState<ScanResult | null>(null),
    [variant, setVariant] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [running, setRunning] = useState(false),
    [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    generation = useRef({ value: 0 }),
    inflight = useRef(false),
    dedupe = useRef(new ScanDeduplicator()),
    mounted = useRef(true);
  function stop() {
    generation.current.value++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (video.current) video.current.srcObject = null;
    setRunning(false);
  }
  useEffect(() => {
    mounted.current = true;
    const lifecycle = generation.current;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      lifecycle.value++;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  async function call(action: string, body: object) {
    const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
        cache: "no-store",
      }),
      b = await r.json();
    if (!r.ok) throw Error(b.error || "request_failed");
    return b;
  }
  async function resolve(value: string, format?: string) {
    if (inflight.current) return;
    if (!dedupe.current.accept(value.trim())) {
      setNotice("Duplicate scan ignored.");
      return;
    }
    inflight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    setResolvedCode("");
    try {
      const b = (await call("resolve", {
        code: value,
        ...(shopping && format === "EAN13" ? { format: "ean13" } : {}),
      })) as ScanResult;
      if (mounted.current) {
        setResult(b);
        setResolvedCode(b.resolved_code || value);
        setVariant(b.selected_variant || "");
        setNotice(
          shopping
            ? "Product found. Review the variant, price and availability before adding."
            : "Code checked. Choose a variant before any future cart action.",
        );
      }
    } catch (e) {
      if (mounted.current) setError(friendly(e));
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function camera() {
    stop();
    const turn = generation.current.value;
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("camera_unavailable");
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (!mounted.current || turn !== generation.current.value) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      const m = await reader();
      if (turn !== generation.current.value) return;
      setRunning(true);
      const canvas = document.createElement("canvas");
      const frame = async () => {
        if (turn !== generation.current.value || !video.current) return;
        try {
          const v = video.current;
          if (v.readyState >= 2 && !inflight.current) {
            canvas.width = Math.min(v.videoWidth, 1280);
            canvas.height = Math.round(
              (v.videoHeight * canvas.width) / v.videoWidth,
            );
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const found = await m.readBarcodes(
              ctx.getImageData(0, 0, canvas.width, canvas.height),
              {
                formats: [
                  "QRCode",
                  "EAN13",
                  "EAN8",
                  "UPCA",
                  "UPCE",
                  "Code128",
                  "Code39",
                ],
                maxNumberOfSymbols: 1,
              },
            );
            if (turn !== generation.current.value) return;
            if (found[0]?.text) {
              const text = found[0].text;
              stop();
              setCode(text);
              await resolve(text, found[0].format);
              return;
            }
          }
        } catch (e) {
          stop();
          setError(friendly(e));
          return;
        }
        timer.current = setTimeout(frame, 350);
      };
      void frame();
    } catch (e) {
      if (turn === generation.current.value && mounted.current) {
        stop();
        setError(friendly(e));
      }
    }
  }
  const chosen = result?.availability.variants.find((v) => v.id === variant),
    registeredVariant = result?.product.variants.find(
      (v) => v.variant_id === variant,
    );
  const locations = registeredVariant?.locations;
  async function add() {
    if (shopping) {
      if (inflight.current || shopping.locked || !chosen?.available) return;
      inflight.current = true;
      setBusy(true);
      setError("");
      try {
        await shopping.add(
          resolvedCode,
          chosen.id,
          Math.round(Number(chosen.price.amount) * 100),
        );
        setNotice(
          "Added to your in-store cart. Scanning does not reserve stock.",
        );
      } catch (e) {
        setError(friendly(e));
      } finally {
        inflight.current = false;
        setBusy(false);
      }
      return;
    }
    if (
      fixture ||
      !publicFlags.barcodeScanning ||
      !publicFlags.purchases ||
      !chosen?.available
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/commerce/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scan-add",
          code: resolvedCode,
          variantId: chosen.id,
          quantity: 1,
          reviewedPriceCents: Math.round(Number(chosen.price.amount) * 100),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error || "cart_unavailable");
      setNotice("Added to your Shopify cart.");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="loyalty-card ns-scanner" aria-busy={busy}>
      <h2>{shopping ? "Scan Product" : "Staff scanner preview"}</h2>
      <p>
        {fixture
          ? "SAMPLE codes and fictional availability."
          : "Live lookups use the published Shopify catalog."}{" "}
        Scanning never adjusts inventory or adds an item automatically.
      </p>
      {shopping && !running && (
        <div className="ns-camera-idle" aria-hidden="true">
          <ScanLine size={48} strokeWidth={1.5} />
          <span>SCAN. REVIEW. COLLECT.</span>
        </div>
      )}
      <video
        ref={video}
        muted
        playsInline
        className="store-camera"
        aria-label="Camera preview"
        hidden={!running}
      />
      <div className="actions">
        <button
          className="button"
          type="button"
          onClick={() => void camera()}
          disabled={running || busy}
        >
          <Camera size={18} aria-hidden="true" /> Start camera
        </button>
        <button className="button secondary" type="button" onClick={stop}>
          Stop camera
        </button>
      </div>
      <p className="small">
        Camera permission is optional. Images are decoded on this device; only
        the code text is sent for a registry lookup. The camera stops after a
        scan or when you leave this tab.
      </p>
      <label>
        Read a saved label image
        <input
          type="file"
          disabled={busy}
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            stop();
            setError("");
            try {
              if (file.size > 8_000_000)
                throw Error("Choose an image under 8 MB");
              const m = await reader(),
                found = await m.readBarcodes(file, { maxNumberOfSymbols: 1 });
              if (!found[0]?.text)
                throw Error("No readable barcode found. Try manual entry.");
              setCode(found[0].text);
              await resolve(found[0].text, found[0].format);
            } catch (err) {
              setError(friendly(err));
            }
          }}
        />
      </label>
      <form
        className="ns-scan-entry"
        onSubmit={(e) => {
          e.preventDefault();
          stop();
          void resolve(code);
        }}
      >
        <label>
          Barcode or Northside QR link
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={2048}
            placeholder={
              fixture
                ? "SAMPLE-BOX-BASE"
                : "Enter a product barcode or Northside link"
            }
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Checking…" : "Check code"}
        </button>
      </form>
      {!shopping && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              setMatches(await call("search", { query: search }));
              setSearched(true);
            } catch (err) {
              setError(friendly(err));
            }
          }}
        >
          <label>
            Search product, family or SKU
            <input
              required
              maxLength={80}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Search products
          </button>
        </form>
      )}
      <>
        {searched && !matches.length && (
          <p role="status">No registered products match this search.</p>
        )}
      </>
      <ul>
        {matches.map((p) => (
          <li key={p.id}>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                stop();
                void resolve(
                  "https://9i3hnb-jw.myshopify.com/products/" + p.handle,
                );
              }}
            >
              {p.title}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="loyalty-notice">
          {error}
        </p>
      )}
      {busy && <p role="status">Checking your selection…</p>}
      {notice && (
        <p role="status" className="loyalty-notice">
          {notice}
        </p>
      )}
      {result && (
        <article className="store-result">
          <span className="badge">
            {fixture
              ? "SAMPLE customer projection"
              : "Approved retail projection"}
          </span>
          <h3>{result.product.title}</h3>
          <div className="ns-result-image">
            {result.product.image ? (
              // Shopify image bytes are loaded by the browser, never fetched from a scanned URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.product.image.url}
                alt={result.product.image.altText || result.product.title}
                width={240}
                height={180}
                style={{ objectFit: "contain", maxWidth: "100%" }}
              />
            ) : (
              <p className="small">No product image is available.</p>
            )}
          </div>
          <p className="small">
            {fixture
              ? "Fictional stock and prices for this preview"
              : "Shopify online availability; this is not a shelf count"}{" "}
            · checked{" "}
            {new Date(result.availability.checked_at).toLocaleTimeString(
              "en-US",
              { timeZone: "America/Chicago" },
            )}{" "}
            Chicago
          </p>
          <label>
            Product variant
            <select
              disabled={busy}
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            >
              <option value="">Choose a variant</option>
              {result.availability.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title} — {v.available ? "available" : "unavailable"}
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <>
              <p className="ns-result-price">
                {fixture ? "SAMPLE " : ""}${chosen.price.amount} USD
              </p>
              <p className="ns-availability">
                {chosen.available ? "Available online" : "Unavailable for cart"}
              </p>
              <dl className="ns-product-meta">
                <div>
                  <dt>Variant</dt>
                  <dd>{chosen.title}</dd>
                </div>
                {registeredVariant?.sku && (
                  <div>
                    <dt>SKU</dt>
                    <dd>{registeredVariant.sku}</dd>
                  </div>
                )}
              </dl>
              <h4>Approved retail locations</h4>
              {locations?.length ? (
                <ul>
                  {locations.map((l, i) => (
                    <li key={i}>
                      {[l.aisle, l.side, l.zone, l.label]
                        .filter(Boolean)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No approved retail location is available.</p>
              )}
            </>
          )}
          <button
            className="button"
            disabled={
              busy ||
              (shopping
                ? shopping.locked
                : fixture ||
                  !publicFlags.barcodeScanning ||
                  !publicFlags.purchases) ||
              !chosen?.available
            }
            onClick={() => void add()}
          >
            {shopping
              ? busy
                ? "Adding…"
                : "Add to cart"
              : "Add to Shopify cart — disabled"}
          </button>
          <p className="small">
            {shopping
              ? "This is an unpaid shopping list. Staff confirm the items, stock and final total at the register."
              : "Customer scanning, walking directions and pickup are not active. No walking distance or shelf position is inferred from the schematic."}
          </p>
        </article>
      )}
    </section>
  );
}
