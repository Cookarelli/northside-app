import { BreakWorkspace } from "@/components/break-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <BreakWorkspace fixture={fixturesAllowed(process.env)} />;
}
