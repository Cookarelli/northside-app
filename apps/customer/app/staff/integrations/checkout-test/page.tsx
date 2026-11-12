import Link from "next/link";
import { privateRequest } from "@/lib/server/http";
import {
  checkoutTestConfig,
  requireCheckoutTester,
} from "@/lib/server/checkout-test";
import { CheckoutTest } from "@/components/checkout-test";

export default async function Page() {
  const authorized = await privateRequest(async (_db, actor) => {
    requireCheckoutTester(actor);
    return true;
  }).catch(() => false);
  if (!authorized)
    return (
      <section className="empty">
        <h1>Development-store checkout</h1>
        <p>An invited Northside owner or admin must sign in.</p>
        <Link href="/staff/login" prefetch={false}>
          Staff sign-in
        </Link>
      </section>
    );
  let ready = false;
  try {
    checkoutTestConfig();
    ready = true;
  } catch {
    /* No private configuration in the page. */
  }
  return (
    <section className="panel">
      <h1>Development-store checkout</h1>
      <p>
        This separate test uses a Shopify development store. Northside live
        purchases remain disabled. Use only the development store’s designated
        test payment details.
      </p>
      <p>
        Enter a published variant from that store. This prepares a new guest
        cart; it does not place an order or transfer a Northside customer
        identity.
      </p>
      {ready ? (
        <CheckoutTest />
      ) : (
        <p>
          Disabled. A separate development store, private Storefront token and
          unexpired Admin grant must be configured by the operator.
        </p>
      )}
      <Link href="/staff/integrations/commerce-pilot" prefetch={false}>
        Back to Shopify checks
      </Link>
    </section>
  );
}
