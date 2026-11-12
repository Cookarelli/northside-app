import { CartPage } from "@/components/preview";
import { LiveCart } from "@/components/commerce-controls";
import { fixturesAllowed, publicFlags } from "@/lib/policy.mjs";
import { ShoppingWorkspace } from "@/components/shopping-workspace";
import { notFound } from "next/navigation";
import type { Viewport } from "next";
export const viewport: Viewport = {
  themeColor: "#071526",
  viewportFit: "cover",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ inStore?: string }>;
}) {
  if ((await searchParams).inStore === "1") {
    const sample = fixturesAllowed(process.env);
    if (!sample && !publicFlags.barcodeScanning) notFound();
    return <ShoppingWorkspace sample={sample} />;
  }
  return fixturesAllowed(process.env) ? <CartPage /> : <LiveCart />;
}
