"use client";
import { useState } from "react";
export function lockScreens() {
  try {
    localStorage.setItem("ns-privacy-lock", "1");
    const channel = new BroadcastChannel("northside-session");
    channel.postMessage("lock");
    channel.close();
  } catch {}
  navigator.serviceWorker?.controller?.postMessage({ type: "LOGOUT" });
  document.documentElement.classList.add("privacy-hidden");
}
export async function localLogout() {
  lockScreens();
  try {
    const r = await fetch("/api/auth/logout?local=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!r.ok) throw Error();
    try {
      localStorage.removeItem("ns-privacy-lock");
    } catch {}
    return true;
  } catch {
    return false;
  } finally {
    document.documentElement.classList.remove("privacy-hidden");
  }
}
export function LogoutControl({ finish = false }: { finish?: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const done = await localLogout();
          if (done) window.location.replace("/signed-out?complete=1");
          else if (finish) {
            setBusy(false);
            setError(
              "Reconnect and try again to finish signing out. Private screens remain locked.",
            );
          } else window.location.replace("/signed-out");
        }}
      >
        {busy ? "Signing out…" : finish ? "Finish signing out" : "Sign out"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function SignedOut() {
  return (
    <div className="loyalty-workspace">
      <section className="loyalty-card">
        <h1>Private screens are closed</h1>
        <p>
          If your connection was interrupted, finish signing out below before
          someone else uses this device.
        </p>
        <LogoutControl finish />
        <p>
          <a href="/account">Go to account sign-in</a>
        </p>
      </section>
    </div>
  );
}
