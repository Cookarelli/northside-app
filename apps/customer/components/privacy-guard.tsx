"use client";
import { useEffect } from "react";
export function PrivacyGuard() {
  useEffect(() => {
    const publicExit = () => location.pathname === "/signed-out";
    const locked = () => {
      try {
        return localStorage.getItem("ns-privacy-lock") === "1";
      } catch {
        return false;
      }
    };
    const close = () => {
      if (publicExit()) return;
      document.documentElement.classList.add("privacy-hidden");
      location.replace("/signed-out");
    };
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) {
        document.documentElement.classList.add("privacy-hidden");
        location.reload();
      } else if (locked()) close();
    };
    const hide = () => document.documentElement.classList.add("privacy-hidden");
    const changed = (e: StorageEvent) => {
      if (e.key === "ns-privacy-lock" && e.newValue === "1") close();
    };
    const message = (e: MessageEvent) => {
      if (e.data?.type === "SESSION_LOCKED") close();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("northside-session")
        : null;
    if (channel) channel.onmessage = close;
    if (locked()) close();
    else document.documentElement.classList.remove("privacy-hidden");
    window.addEventListener("pageshow", restore);
    window.addEventListener("pagehide", hide);
    window.addEventListener("storage", changed);
    navigator.serviceWorker?.addEventListener("message", message);
    return () => {
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("storage", changed);
      navigator.serviceWorker?.removeEventListener("message", message);
      channel?.close();
    };
  }, []);
  return null;
}
