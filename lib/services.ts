import "server-only";
import { fixturesAllowed } from "./policy.mjs";
import { disconnectedServices } from "./adapters/disconnected";
import type { PreviewData } from "./contracts";
export async function getData(): Promise<PreviewData> {
  const fixture = fixturesAllowed(process.env);
  const services = fixture
    ? (await import("./adapters/fixtures")).fixtureServices
    : disconnectedServices;
  const [products, identity, grading, consignment, breaks, wallet] =
    await Promise.all([
      services.commerce.catalog(),
      services.customer.previewIdentity(),
      services.grading.cases(),
      services.consignment.cases(),
      services.breaks.schedule(),
      services.loyalty.wallet(),
    ]);
  return { fixture, products, identity, grading, consignment, breaks, wallet };
}
