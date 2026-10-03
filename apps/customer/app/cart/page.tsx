import { CartPage } from "@/components/preview";
import { LiveCart } from "@/components/commerce-controls";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return fixturesAllowed(process.env) ? <CartPage /> : <LiveCart />;
}
