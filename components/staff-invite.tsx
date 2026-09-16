"use client";
import { useState } from "react";
export function StaffInvite({ owner }: { owner: boolean }) {
  const [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <section className="panel">
      <h2>Invite staff</h2>
      <p>
        Invitations grant access to Northside’s staff workspace. Customers
        continue to use Shopify.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setMessage("");
          const form = new FormData(e.currentTarget);
          try {
            const response = await fetch("/api/private/staff/invite", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: form.get("email"),
                role: form.get("role"),
              }),
            });
            setMessage(
              response.ok
                ? "Invitation accepted by the email provider."
                : "Invitation could not be completed. Check the integration and membership before retrying.",
            );
          } catch {
            setMessage(
              "Connection failed. Check invitation status before retrying.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Staff email
          <input name="email" type="email" required autoComplete="off" />
        </label>
        <label>
          Role
          <select name="role">
            <option value="read_only">Read only</option>
            <option value="operations">Operations</option>
            <option value="content_editor">Content editor</option>
            {owner && <option value="admin">Admin</option>}
          </select>
        </label>
        <button className="button" disabled={pending}>
          {pending ? "Sending…" : "Send staff invitation"}
        </button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
