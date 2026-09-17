"use client";
import { useEffect, useRef, useState } from "react";
import type { ScanMethod } from "@/lib/grading-fulfillment";
let decoder: Promise<typeof import("zxing-wasm/reader")> | undefined;
async function reader() {
  decoder ??= (async () => {
    const m = await import("zxing-wasm/reader");
    await m.prepareZXingModule({
      overrides: { locateFile: (p: string) => "/vendor/zxing-wasm/3.1.4/" + p },
      fireImmediately: true,
    });
    return m;
  })();
  return decoder;
}
export function GradingCardScanner({
  onScan,
  disabled = false,
}: {
  onScan: (code: string, method: ScanMethod) => Promise<void>;
  disabled?: boolean;
}) {
  const [code, setCode] = useState(""),
    [method, setMethod] = useState<ScanMethod>("scanner"),
    [error, setError] = useState(""),
    [running, setRunning] = useState(false),
    [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef({ value: 0 }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    active = useRef(true);
  function stop() {
    generation.current.value++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    setRunning(false);
  }
  useEffect(() => {
    active.current = true;
    const lifecycle = generation.current;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current = false;
      lifecycle.value++;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  async function submit(value: string, via: ScanMethod) {
    if (busy || disabled) return;
    stop();
    setBusy(true);
    setError("");
    try {
      await onScan(value, via);
      if (active.current) setCode("");
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "Unable to check label");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function camera() {
    stop();
    const current = generation.current.value;
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          "Camera unavailable. Use a scanner, label image or enter the card ID.",
        );
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!active.current || generation.current.value !== current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      const m = await reader();
      if (generation.current.value !== current) return;
      setRunning(true);
      const canvas = document.createElement("canvas");
      const frame = async () => {
        if (!video.current || generation.current.value !== current) return;
        try {
          const v = video.current;
          if (v.readyState >= 2) {
            canvas.width = Math.min(v.videoWidth, 1280);
            canvas.height = Math.round(
              (v.videoHeight * canvas.width) / v.videoWidth,
            );
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const found = await m.readBarcodes(
              ctx.getImageData(0, 0, canvas.width, canvas.height),
              {
                formats: ["QRCode", "Code128", "Code39"],
                maxNumberOfSymbols: 1,
              },
            );
            if (generation.current.value !== current) return;
            if (found[0]?.text) {
              await submit(found[0].text, "camera");
              return;
            }
          }
          timer.current = setTimeout(frame, 350);
        } catch {
          stop();
          setError("Camera decoding failed. Use the label image or card ID.");
        }
      };
      void frame();
    } catch (e) {
      if (active.current && generation.current.value === current) {
        stop();
        setError(
          e instanceof Error && /NotAllowed|Permission/.test(e.name)
            ? "Camera permission declined. Use a scanner, label image or card ID."
            : e instanceof Error
              ? e.message
              : "Camera unavailable",
        );
      }
    }
  }
  return (
    <section className="grading-scanner">
      <h3>Scan a physical card</h3>
      <p className="small">
        Use its Northside card label. A label identifies a card; it never
        authorizes release. Product barcodes identify products, not an
        individual collector’s card.
      </p>
      <video
        ref={video}
        muted
        playsInline
        hidden={!running}
        className="store-camera"
        aria-label="Card label camera"
      />
      <div className="actions">
        <button
          className="button secondary"
          type="button"
          disabled={disabled || busy || running}
          onClick={() => void camera()}
        >
          Scan with camera
        </button>
        {running && (
          <button className="button secondary" type="button" onClick={stop}>
            Stop camera
          </button>
        )}
      </div>
      <label>
        Read a card label image
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            stop();
            try {
              if (f.size > 8_000_000) throw Error("Choose an image under 8 MB");
              const m = await reader(),
                found = await m.readBarcodes(f, { maxNumberOfSymbols: 1 });
              if (!found[0]?.text) throw Error("No readable label found");
              await submit(found[0].text, "image");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unreadable image");
            }
          }}
        />
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code, method);
        }}
        className="grading-form"
      >
        <label>
          Input method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ScanMethod)}
          >
            <option value="scanner">USB / Bluetooth scanner</option>
            <option value="manual">Manual label verification</option>
          </select>
        </label>
        <label>
          Scan label or enter full card ID
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={100}
            required
            disabled={disabled || busy}
            placeholder="NSCARD:…"
          />
        </label>
        <button className="button" disabled={disabled || busy}>
          {busy ? "Checking card…" : "Check scanned card"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
