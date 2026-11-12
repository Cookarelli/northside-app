import { notFound } from "next/navigation";
import { fixturesAllowed, publicFlags } from "@/lib/policy.mjs";
import { StaffShoppingHandoff } from "@/components/shopping-workspace";
export default function Page() {
  const sample = fixturesAllowed(process.env);
  if (!sample && !publicFlags.barcodeScanning) notFound();
  return <StaffShoppingHandoff sample={sample} />;
}
