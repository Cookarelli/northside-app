import { EngagementStaff } from "@/components/engagement-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <EngagementStaff sample={fixturesAllowed(process.env)} />;
}
