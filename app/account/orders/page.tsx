import Link from "next/link";
import { loadCustomerAccount } from "@/lib/server/customer-commerce";
import { formatMoney } from "@/lib/commerce";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { OrdersPreview } from "@/components/preview";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  if (fixturesAllowed(process.env)) return <OrdersPreview />;
  const { after } = await searchParams;
  const customer = await loadCustomerAccount(after).catch(() => null);
  return (
    <>
      <div className="intro">
        <p className="eyebrow">YOUR NORTHSIDE</p>
        <h1>Your orders</h1>
        <p>Orders come from your signed-in Shopify customer account.</p>
      </div>
      {customer ? (
        <>
          {customer.orders.nodes.length ? (
            customer.orders.nodes.map((o) => (
              <article className="case" key={o.id}>
                <h2>{o.name}</h2>
                <p>
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeZone: "America/Chicago",
                  }).format(new Date(o.processedAt))}
                </p>
                <p>
                  {o.financialStatus?.replaceAll("_", " ") ||
                    "Payment status unavailable"}{" "}
                  · {formatMoney(o.totalPrice)}
                </p>
              </article>
            ))
          ) : (
            <div className="empty">
              <h2>No orders yet</h2>
              <p>No orders were returned for your verified account.</p>
            </div>
          )}
          <nav className="collection-links" aria-label="Order pages">
            {after && (
              <Link href="/account/orders" prefetch={false}>
                First page
              </Link>
            )}
            {customer.orders.pageInfo.hasNextPage && (
              <Link
                href={`/account/orders?after=${encodeURIComponent(customer.orders.pageInfo.endCursor!)}`}
                prefetch={false}
              >
                Older orders →
              </Link>
            )}
          </nav>
        </>
      ) : (
        <div className="empty">
          <h2>Order history unavailable</h2>
          <p>
            Sign in to your account. If you are already signed in, Shopify may
            be awaiting connection or temporarily unavailable.
          </p>
        </div>
      )}
      <Link className="back" href="/account" prefetch={false}>
        ← Back to account
      </Link>
    </>
  );
}
