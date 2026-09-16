import Link from "next/link";
import { AccountPage } from "@/components/preview";
import { LiveAccount } from "@/components/live-records";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return (
    <>
      <p>
        <Link href="/account/notifications">Notification preferences →</Link> ·{" "}
        <Link href="/install">Install Northside</Link>
      </p>
      {fixturesAllowed(process.env) ? <AccountPage /> : <LiveAccount />}
    </>
  );
}
