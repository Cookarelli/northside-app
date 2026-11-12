import { notFound } from "next/navigation";
import type { Viewport } from "next";
export const viewport: Viewport = {
  themeColor: "#071526",
  viewportFit: "cover",
};
import { fixturesAllowed, publicFlags } from "@/lib/policy.mjs";
import { ShoppingWorkspace } from "@/components/shopping-workspace";
export default function Page() {
  const sample = fixturesAllowed(process.env);
  if (!sample && !publicFlags.barcodeScanning) notFound();
  return <ShoppingWorkspace sample={sample} scanner />;
}
