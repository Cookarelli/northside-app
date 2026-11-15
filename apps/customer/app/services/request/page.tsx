import { ServiceRequestForm } from "@/components/service-requests";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ service?: string | string[] }>;
}) {
  const selected = (await searchParams).service;
  const initialService = selected === "consignment" ? "consignment" : "grading";
  return (
    <ServiceRequestForm
      key={initialService}
      initialService={initialService}
      fixture={fixturesAllowed(process.env)}
    />
  );
}
