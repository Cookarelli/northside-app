import { ServiceRequestQueue } from "@/components/service-requests";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <ServiceRequestQueue fixture={fixturesAllowed(process.env)} />;
}
