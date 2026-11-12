import { GradingWorkspace } from "@/components/grading-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
import Link from "next/link";
export default function Page() {
  return <><Link className="button" href="/staff/requests">Shared service request queue</Link><GradingWorkspace fixture={fixturesAllowed(process.env)} staff /></>;
}
