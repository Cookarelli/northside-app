import Link from "next/link";
import { notFound } from "next/navigation";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { StaffPage } from "@/components/preview";
import { StaffWorkspace } from "@/components/live-records";
import { authReadiness } from "@/lib/server/providers";
export default function Page() {
  if (fixturesAllowed(process.env))
    return (
      <>
        <Link className="button secondary" href="/staff/engagement">
          Open engagement workspace →
        </Link>
        <Link className="button" href="/staff/grading">
          Open saved grading workspace →
        </Link>
        <Link className="button secondary" href="/staff/consignment">
          Open saved consignment workspace →
        </Link>
        <Link className="button secondary" href="/staff/store">
          Open store workspace →
        </Link>
        <StaffPage />
        <Link className="button secondary" href="/staff/rewards">
          Open saved rewards workspace →
        </Link>
      </>
    );
  if (!authReadiness().staff) notFound();
  return <StaffWorkspace />;
}
