"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { installGuidance, type InstallEvent } from "@/lib/pwa";
let deferredInstall: InstallEvent | null = null;
export function PwaManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault();
      deferredInstall = e as InstallEvent;
    };
    window.addEventListener("beforeinstallprompt", capture);
    if (!("serviceWorker" in navigator) || !isSecureContext)
      return () => window.removeEventListener("beforeinstallprompt", capture);
    let keep = true,
      controlled = !!navigator.serviceWorker.controller;
    const change = () => {
      if (controlled) window.location.reload();
      controlled = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", change);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (!keep) return;
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (
              keep &&
              next.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setWaiting(next);
          });
        });
      })
      .catch(() => {
        /* Normal browsing remains available without a service worker. */
      });
    return () => {
      keep = false;
      window.removeEventListener("beforeinstallprompt", capture);
      navigator.serviceWorker.removeEventListener("controllerchange", change);
    };
  }, []);
  return waiting ? (
    <aside className="pwa-update" role="status">
      An app update is ready. Save your changes first.{" "}
      <button
        className="button secondary"
        onClick={() => waiting.postMessage({ type: "ACTIVATE_UPDATE" })}
      >
        Update and reload
      </button>
    </aside>
  ) : null;
}
export function InstallApp() {
  const [event, setEvent] = useState<InstallEvent | null>(null),
    [state, setState] = useState({
      standalone: false,
      prompt: false,
      ios: false,
      secure: true,
    }),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const update = () =>
      setState((s) => ({
        ...s,
        standalone:
          media.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
        ios:
          /iPhone|iPad|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
        secure: isSecureContext,
      }));
    const prompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setState((s) => ({ ...s, prompt: true }));
    };
    const installed = () => {
      deferredInstall = null;
      setNotice(
        "This browser reported an app installation. This is not confirmation for other devices.",
      );
      setEvent(null);
      update();
    };
    update();
    queueMicrotask(() => {
      if (deferredInstall) {
        setEvent(deferredInstall);
        setState((s) => ({ ...s, prompt: true }));
      }
    });
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", installed);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", installed);
      media.removeEventListener("change", update);
    };
  }, []);
  return (
    <section className="loyalty-card">
      <h2>Keep Northside close</h2>
      <p>{installGuidance(state)}</p>
      {event && !state.standalone && (
        <button
          className="button"
          onClick={async () => {
            try {
              const result = await event.prompt();
              deferredInstall = null;
              setEvent(null);
              setState((s) => ({ ...s, prompt: false }));
              setNotice(
                result.outcome === "accepted"
                  ? "Install prompt accepted. Device installation is not independently verified."
                  : "Installation dismissed. You can keep browsing.",
              );
              if (result.outcome === "accepted")
                window.dispatchEvent(
                  new CustomEvent("northside-measure", {
                    detail: { event: "install_prompt_accepted" },
                  }),
                );
            } catch {
              setNotice(
                "The install prompt is unavailable. Use the browser menu if offered.",
              );
            }
          }}
        >
          Install Northside
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      <p>
        <Link href="/">Continue browsing</Link> ·{" "}
        <Link href="/account/notifications">Notification preferences</Link>
      </p>
      <p className="small">
        Offline mode contains only a public connection page and brand artwork.
        Private account information and checkout require a connection. Native
        Apple and Google app releases are a later phase; real iPhone and Android
        installation tests remain pending.
      </p>
    </section>
  );
}
