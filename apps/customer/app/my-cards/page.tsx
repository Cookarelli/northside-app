import Link from "next/link";
import { CardsPage } from "@/components/preview";
import { LiveCards } from "@/components/live-records";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return (
    <>
      <Link className="button" href="/my-cards/grading">
        Open saved grading cards →
      </Link>
      <Link className="button secondary" href="/my-cards/consignment">
        Open saved consignment cards →
      </Link>
      {fixturesAllowed(process.env) ? <CardsPage /> : <LiveCards />}
    </>
  );
}
