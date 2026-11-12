import { ServiceRequestForm } from "@/components/service-requests";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <ServiceRequestForm fixture={fixturesAllowed(process.env)} staff />;
}
