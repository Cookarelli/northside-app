import { notFound } from "next/navigation";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { StaffPage } from "@/components/preview";
import { StaffWorkspace } from "@/components/live-records";
import { StaffHome } from "@/components/staff-home";
import { authReadiness } from "@/lib/server/providers";
export default function Page() {
  if (fixturesAllowed(process.env))
    return <StaffHome role="owner" fixture trainingTools={<StaffPage />} />;
  if (!authReadiness().staff) notFound();
  return <StaffWorkspace />;
}
