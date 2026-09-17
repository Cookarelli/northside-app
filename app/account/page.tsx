import Link from "next/link";
import { AccountPage } from "@/components/preview";
import { LiveAccount } from "@/components/live-records";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { safeReturn } from "@/lib/server/security";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const returnTo = safeReturn((await searchParams).returnTo);
  return (
    <>
      <p>
        <Link href="/account/notifications">Notification preferences →</Link> ·{" "}
        <Link href="/install">Install Northside</Link>
      </p>
      {fixturesAllowed(process.env) ? (
        <AccountPage />
      ) : (
        <LiveAccount returnTo={returnTo} />
      )}
    </>
  );
}
