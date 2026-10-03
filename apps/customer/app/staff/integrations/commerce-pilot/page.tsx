import Link from "next/link";
import { privateRequest } from "@/lib/server/http";
import {
  inspectCommercePilot,
  requireCommerceInspector,
} from "@/lib/server/commerce-pilot";
import { formatMoney } from "@/lib/commerce";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ product?: string | string[] }>;
}) {
  const actor = await privateRequest(async (_db, current) => {
    requireCommerceInspector(current);
    return current;
  }).catch(() => null);
  if (!actor)
    return (
      <section className="empty">
        <h1>Shopify pilot checks</h1>
        <p>
          Sign in with an invited Northside owner or admin account. Live staff
          authentication and database configuration are required.
        </p>
        <Link prefetch={false} href="/staff/login">
          Invited staff sign-in
        </Link>
      </section>
    );
  const { product } = await searchParams;
  const productId =
    typeof product === "string" && product.length <= 100 ? product : undefined;
  const report = await inspectCommercePilot(actor, productId);
  return (
    <div className="engagement-workspace">
      <div className="intro">
        <p className="eyebrow">OWNER / ADMIN · READ-ONLY INSPECTION</p>
        <h1>Shopify pilot checks</h1>
        <p>
          Checked {report.checkedAt} using API {report.version}. These reads do
          not create a cart, change merchandise or establish payment.
        </p>
      </div>
      <section className="panel">
        <h2>Installed app and permissions</h2>
        {report.installation.state === "observed" ? (
          <>
            <p>
              <strong>{report.installation.data.app.title}</strong> ·{" "}
              {report.installation.data.shop}
            </p>
            <p>
              App: <code>{report.installation.data.app.id}</code>
              <br />
              Installation:{" "}
              <code>{report.installation.data.installationId}</code>
            </p>
            <p>
              Shopify plan: {report.installation.data.plan.publicDisplayName}.
              Development shop:{" "}
              {report.installation.data.plan.partnerDevelopment ? "Yes" : "No"}.
              Shopify Plus:{" "}
              {report.installation.data.plan.shopifyPlus ? "Yes" : "No"}.
            </p>
            <p>
              Granted Admin scopes:{" "}
              {report.installation.data.scopes.join(", ") || "None returned"}.
            </p>
            <p>
              These scopes describe this Admin installation. Verify the separate
              Headless channel/token and Customer Account grant independently.
              The plan result does not prove pickup or POS capability.
            </p>
          </>
        ) : (
          <p>
            Unavailable. Configure the supported app installation and unexpired
            authorized grant for the expected Northside shop. No installed app
            or plan has been verified.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Published catalog</h2>
        {report.catalog.state === "observed" ? (
          <>
            <p>
              {report.catalog.data.products.nodes.length
                ? "Published products returned from Storefront."
                : "Storefront responded with no published products. Check channel publication; Draft products stay private."}
            </p>
            <ul>
              {report.catalog.data.products.nodes.map((p) => (
                <li key={p.id}>
                  <Link
                    prefetch={false}
                    href={{
                      pathname: "/staff/integrations/commerce-pilot",
                      query: { product: p.id },
                    }}
                  >
                    {p.title}
                  </Link>{" "}
                  · <code>{p.id}</code>
                </li>
              ))}
            </ul>
            {report.catalog.data.products.pageInfo.hasNextPage && (
              <p>
                This is the first catalog page. Use the shop’s search and
                pagination to inspect more merchandise.
              </p>
            )}
          </>
        ) : (
          <p>
            Unavailable. Configure the private Storefront token for the exact
            published sales channel, including inventory-read permission. No
            sample catalog is substituted.
          </p>
        )}
        <form method="get" action="/staff/integrations/commerce-pilot">
          <label>
            Exact Shopify product ID
            <input
              name="product"
              defaultValue={productId || ""}
              placeholder="gid://shopify/Product/…"
              maxLength={100}
              required
            />
          </label>
          <button className="button">Read published variants</button>
        </form>
        {report.selectedProduct?.state === "unavailable" && (
          <p role="status">
            This product could not be verified through Storefront. Check its
            exact ID, publication, inventory permissions and variant count.
          </p>
        )}
        {report.selectedProduct?.state === "observed" && (
          <>
            <h3>{report.selectedProduct.data.title}</h3>
            <p>
              Current online sellable availability is not a retail-floor stock
              count or reservation.
            </p>
            <div className="engagement-table">
              <table>
                <caption>
                  Published variants observed during this request
                </caption>
                <thead>
                  <tr>
                    <th>Variant / identity</th>
                    <th>SKU / barcode</th>
                    <th>Price</th>
                    <th>Online availability</th>
                  </tr>
                </thead>
                <tbody>
                  {report.selectedProduct.data.variants.nodes.map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.title}
                        <br />
                        <code>{v.id}</code>
                      </td>
                      <td>
                        {v.sku || "No SKU"}
                        <br />
                        {v.barcode || "No barcode"}
                      </td>
                      <td>{formatMoney(v.price)}</td>
                      <td>
                        {!v.availableForSale
                          ? "Unavailable"
                          : v.currentlyNotInStock
                            ? "Backorder only"
                            : v.quantityAvailable === null
                              ? "Quantity unknown"
                              : `${v.quantityAvailable} sellable`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p>
          <Link prefetch={false} href="/staff/store">
            Open the existing product, barcode and stable QR registry →
          </Link>
        </p>
      </section>
      <section className="panel">
        <h2>Webhook subscriptions</h2>
        {report.webhooks.state === "observed" ? (
          <>
            {!report.webhooks.data.expectedEndpointConfigured && (
              <p>
                The verified app origin is missing, so no endpoint match can be
                established.
              </p>
            )}
            <ul>
              {report.webhooks.data.subscriptions.map((s, i) => (
                <li key={`${s.topic}-${i}`}>
                  {s.topic} · API {s.version} ·{" "}
                  {s.matchesEndpoint
                    ? "Exact configured endpoint"
                    : "Endpoint not matched"}{" "}
                  · {s.matchesVersion ? "Pinned version" : "Version differs"}
                </li>
              ))}
            </ul>
            <p>
              Required topics not observed at the exact target/version:{" "}
              {report.webhooks.data.missingTopics.join(", ") ||
                "None in this API result"}
              .
            </p>
            {!report.webhooks.data.complete && (
              <p>
                The API returned another page. This inventory is incomplete.
              </p>
            )}
          </>
        ) : (
          <p>
            Unavailable. The app installation must be verified before its
            subscriptions can be inspected.
          </p>
        )}
        <p>
          API-listed subscriptions do not prove HTTPS delivery, app-configured
          subscriptions, HMAC acceptance, durable processing or the running
          order worker. Verify those separately at the canonical{" "}
          <code>/api/shopify/webhooks</code> endpoint.
        </p>
      </section>
      <section className="notice">
        <h2>Checkout and collection remain disabled</h2>
        <p>
          The existing shop and cart own checkout, buyer identity and
          server-stored cart handles. Real guest/customer checkout, taxes,
          discounts, retail fulfillment, signed payment delivery and staff
          hardware still need evidence. A checkout preference cannot enforce
          pickup, and a Storefront cart cannot automatically become a POS cart.
        </p>
        <p>
          Canonical purchase gate:{" "}
          {report.purchasesEnabled ? "Enabled" : "Disabled"}. Pickup gate:{" "}
          {report.pickupEnabled ? "Enabled" : "Disabled"}. No observation on
          this page activates either gate.
        </p>
        <Link prefetch={false} href="/shop">
          Browse the canonical shop →
        </Link>
      </section>
      <Link prefetch={false} href="/staff/integrations" className="back">
        ← Integration status
      </Link>
    </div>
  );
}
