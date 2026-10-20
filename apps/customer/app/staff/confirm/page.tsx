import { authReadiness } from "@/lib/server/providers";
import { StaffAuthForm } from "@/components/staff-auth-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  if (!authReadiness().staff)
    return (
      <div className="empty">
        <h1>Staff sign-in unavailable</h1>
        <p>Supabase is not configured.</p>
      </div>
    );
  return (
    <section className="panel">
      <h1>Continue to your staff account</h1>
      <p>
        Confirm to use this one-time email link. Only an active invited
        membership can access staff records.
      </p>
      <StaffAuthForm step="confirm">
        <input
          type="hidden"
          name="token_hash"
          value={query.token_hash?.slice(0, 512) || ""}
        />
        <input
          type="hidden"
          name="type"
          value={query.type === "invite" ? "invite" : "email"}
        />
      </StaffAuthForm>
    </section>
  );
}
