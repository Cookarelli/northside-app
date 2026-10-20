import { BreakWorkspace } from "@/components/break-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <BreakWorkspace staff fixture={fixturesAllowed(process.env)} />;
}
