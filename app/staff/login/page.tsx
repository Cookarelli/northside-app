import { authReadiness } from "@/lib/server/providers";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string }>;
}) {
  const ready = authReadiness().staff && !fixturesAllowed(process.env);
  const { requested } = await searchParams;
  return (
    <section className="panel">
      <p className="eyebrow">INVITED STAFF ONLY</p>
      <h1>Staff sign-in</h1>
      <p>
        Customer accounts use Shopify. Staff sign in through Northside’s
        Supabase invitation.
      </p>
      {requested && (
        <p role="status">
          If your address belongs to an invited account, check your email for
          the sign-in link. Delivery is not confirmed here.
        </p>
      )}
      <form action="/api/auth/staff/request" method="post">
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={!ready}
          />
        </label>
        <button className="button" disabled={!ready}>
          Email a sign-in link
        </button>
      </form>
      {!ready && (
        <p className="notice">
          Real staff authentication is not configured for this preview. No
          invitation or email will be sent.
        </p>
      )}
    </section>
  );
}
