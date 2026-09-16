import Link from "next/link";
import Image from "next/image";
import {
  formatMoney,
  shopLink,
  type Browse,
  type Merchandise,
} from "@/lib/commerce";
import { browse, storefront } from "@/lib/server/storefront";
export function ProductImage({ product }: { product: Merchandise }) {
  const image = product.featuredImage;
  let allowed = false;
  try {
    const url = new URL(image?.url || "");
    allowed = url.protocol === "https:" && url.hostname === "cdn.shopify.com";
  } catch {
    /* Show an honest missing-photo state. */
  }
  return allowed && image ? (
    <Image
      className="catalog-image"
      src={image.url}
      alt={image.altText || product.title}
      width={700}
      height={700}
      unoptimized
    />
  ) : (
    <div className="catalog-image missing-image">Product photo unavailable</div>
  );
}
export async function LiveShop({
  input,
  campaign,
}: {
  input: Browse;
  campaign?: string;
}) {
  const data = await Promise.resolve()
    .then(() => browse(storefront(), input))
    .catch(() => null);
  return (
    <>
      <div className="intro">
        <p className="eyebrow">THE CARD SHOP</p>
        <h1>Make room for your next find.</h1>
        <p>
          Browse Northside’s published online collection. Purchases are not open
          yet.
        </p>
      </div>
      {data &&
        process.env.COMMERCE_DATABASE_URL &&
        process.env.APP_ORIGIN &&
        campaign &&
        /^[A-Za-z0-9_-]{22,64}$/.test(campaign) && (
          <section className="notice">
            <h2>Remember this campaign?</h2>
            <p>
              With your permission, we can remember which Northside campaign
              brought you here for 30 days. This is optional.
            </p>
            <form method="post" action="/api/commerce/campaign">
              <input type="hidden" name="ref" value={campaign} />
              <button className="button" name="consent" value="yes">
                Allow campaign measurement
              </button>
              <button name="consent" value="no">
                Continue without measurement
              </button>
            </form>
          </section>
        )}
      <form className="shop-tools" action="/shop">
        <label className="search">
          Search all products
          <input
            name="q"
            defaultValue={input.q}
            maxLength={100}
            placeholder="Search the collection…"
          />
        </label>
        <label>
          Category
          <select name="category" defaultValue={input.category || ""}>
            {["", "Baseball", "Basketball", "Football", "Supplies"].map((c) => (
              <option key={c} value={c}>
                {c || "All categories"}
              </option>
            ))}
          </select>
        </label>
        {input.collection && !input.q && (
          <input type="hidden" name="collection" value={input.collection} />
        )}
        <button className="button">Apply</button>
        <Link className="back" href="/shop">
          Clear
        </Link>
      </form>
      {input.q && input.collection && (
        <p>Search results cover all collections.</p>
      )}
      {data ? (
        <>
          <nav className="collection-links" aria-label="Collections">
            <Link href={shopLink({ category: input.category })}>
              All collections
            </Link>
            {data.collections.nodes.map((c) => (
              <Link
                aria-current={
                  c.handle === input.collection && !input.q ? "page" : undefined
                }
                key={c.handle}
                href={shopLink({
                  collection: c.handle,
                  category: input.category,
                })}
              >
                {c.title}
              </Link>
            ))}
          </nav>
          {data.collections.pageInfo.hasNextPage && (
            <Link
              className="back"
              href={shopLink({
                ...input,
                collectionsAfter: data.collections.pageInfo.endCursor!,
              })}
            >
              More collections →
            </Link>
          )}
          {input.collectionsAfter && (
            <Link
              className="back"
              href={shopLink({ ...input, collectionsAfter: undefined })}
            >
              First collections
            </Link>
          )}
          {data.products.nodes.length ? (
            <div className="product-grid">
              {data.products.nodes.map((p) => (
                <Link
                  className="product"
                  key={p.id}
                  href={`/shop/${p.handle}?back=${encodeURIComponent(shopLink(input))}`}
                  prefetch={false}
                >
                  <ProductImage product={p} />
                  <div className="product-copy">
                    <small>{p.productType || "Collectibles"}</small>
                    <h3>{p.title}</h3>
                    <p>From {formatMoney(p.priceRange.minVariantPrice)}</p>
                    <small>
                      {p.availableForSale
                        ? "Available online"
                        : "Currently unavailable"}
                    </small>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>No published products found</h2>
              <p>
                Try another search or collection. Products that remain Draft are
                not shown here.
              </p>
            </div>
          )}
          <nav className="collection-links" aria-label="Product pages">
            {input.after && (
              <Link href={shopLink({ ...input, after: undefined })}>
                First page
              </Link>
            )}
            {data.products.pageInfo.hasNextPage && (
              <Link
                href={shopLink({
                  ...input,
                  after: data.products.pageInfo.endCursor!,
                })}
              >
                Next page →
              </Link>
            )}
          </nav>
        </>
      ) : (
        <div className="empty">
          <h2>Catalog unavailable</h2>
          <p>
            Shopify is awaiting connection or could not be reached. Draft
            products remain unchanged. Please try again later.
          </p>
        </div>
      )}
    </>
  );
}
