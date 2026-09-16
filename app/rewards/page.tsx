import { LoyaltyWorkspace } from "@/components/loyalty-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <LoyaltyWorkspace fixture={fixturesAllowed(process.env)} />;
}
