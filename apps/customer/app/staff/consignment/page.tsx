import { ConsignmentWorkspace } from "@/components/consignment-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <ConsignmentWorkspace fixture={fixturesAllowed(process.env)} staff />;
}
