import { GradingWorkspace } from "@/components/grading-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <GradingWorkspace fixture={fixturesAllowed(process.env)} staff />;
}
