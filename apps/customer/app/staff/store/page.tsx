import { StoreWorkspace } from "@/components/store-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <StoreWorkspace fixture={fixturesAllowed(process.env)} />;
}
