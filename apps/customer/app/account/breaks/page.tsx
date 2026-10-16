import { BreakWorkspace } from "@/components/break-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <BreakWorkspace personal fixture={fixturesAllowed(process.env)} />;
}
