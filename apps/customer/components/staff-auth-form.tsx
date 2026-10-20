"use client";

import { useRef, useState, type ReactNode } from "react";
import { submitStaffAuth, type StaffAuthStep } from "../lib/staff-auth";

export function StaffAuthForm({
  step,
  disabled = false,
  children,
}: {
  step: StaffAuthStep;
  disabled?: boolean;
  children: ReactNode;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      method="post"
      action={
        step === "request"
          ? "/api/auth/staff/request"
          : "/api/auth/staff/callback"
      }
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          const destination = await submitStaffAuth(step, form);
          window.location.replace(destination);
        } catch {
          setError(
            step === "request"
              ? "The sign-in request could not be completed. Please try again."
              : "This sign-in link could not be confirmed. Request a new link from staff sign-in.",
          );
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      {children}
      <button className="button" disabled={disabled || busy}>
        {busy
          ? "Please wait…"
          : step === "request"
            ? "Email a sign-in link"
            : "Continue"}
      </button>
      {error && <p role="alert">{error}</p>}
      <noscript>
        <p>Enable JavaScript to sign in securely.</p>
      </noscript>
    </form>
  );
}
