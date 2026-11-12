import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CalendarDays, PackageOpen } from "lucide-react";
import { browse, storefront } from "@/lib/server/storefront";
import { getData } from "@/lib/services";
import { formatMoney, shopLink, type Merchandise } from "@/lib/commerce";
import { ProductImage } from "@/components/live-shop";
import { showRead } from "@/lib/server/show-public";
import { TENANT } from "@/lib/server/providers";
import type { Show } from "@/lib/engagement";
import { discoverHomeCollections, upcomingHomeShows } from "@/lib/home";

function SectionHeading({
  title,
  href = "/shop",
}: {
  title: string;
  href?: string;
}) {
  return (
    <div className="ns-section-heading">
      <h2>{title}</h2>
      <Link className="ns-text-link" href={href} prefetch={false}>
        View all <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}

function CatalogState({
  error = false,
  releases = false,
}: {
  error?: boolean;
  releases?: boolean;
}) {
  return (
    <div className="ns-catalog-state" role={error ? "status" : undefined}>
      <PackageOpen size={28} aria-hidden="true" />
      <div>
        <h3>
          {error
            ? "The collection is taking a moment."
            : releases
              ? "Something new is on the way."
              : "Your next find is coming."}
        </h3>
        <p>
          {error
            ? "Products couldn’t be loaded. Visit the shop to try again."
            : releases
              ? "Published new releases will appear here. Check the shop for the current collection."
              : "There are no published products to show yet. Check back for the latest from Northside."}
        </p>
        <Link className="ns-text-link" href="/shop" prefetch={false}>
          {error ? "Try the shop" : "Explore the shop"}{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function HomeProductCard({
  product,
  back = "/shop",
}: {
  product: Merchandise;
  back?: string;
}) {
  return (
    <Link
      className="ns-product"
      href={`/shop/${product.handle}?back=${encodeURIComponent(back)}`}
      prefetch={false}
    >
      <div className="ns-product-image">
        <ProductImage product={product} />
      </div>
      <div className="ns-product-copy">
        <p className="ns-product-type">
          {product.productType || "Collectibles"}
        </p>
        <h3>{product.title}</h3>
        <p className="ns-product-price">
          From {formatMoney(product.priceRange.minVariantPrice)}
        </p>
        <p className="ns-availability">
          {product.availableForSale
            ? "Available online"
            : "Currently unavailable"}
        </p>
        <span className="ns-product-action">
          View product <ArrowRight size={16} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

export async function HomeMerchandising({ sample }: { sample: boolean }) {
  if (sample) {
    const data = await getData();
    return (
      <div className="ns-content ns-merchandising">
        <section aria-labelledby="sample-featured">
          <div className="ns-section-heading">
            <h2 id="sample-featured">Featured products</h2>
            <Link className="ns-text-link" href="/shop">
              View all <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <p className="ns-sample-label">
            LOCAL SAMPLE COLLECTION · Illustrations and example prices
          </p>
          <div className="ns-products">
            {data.products.slice(0, 4).map((p) => (
              <Link
                className="ns-product"
                key={p.id}
                href={`/shop/${p.id}?back=%2Fshop`}
              >
                <div className="ns-product-image ns-sample-product">
                  <Image
                    src="/shopping-sample.svg"
                    alt="Fictional sample packaging"
                    width={300}
                    height={300}
                  />
                  <span>SAMPLE</span>
                </div>
                <div className="ns-product-copy">
                  <p className="ns-product-type">{p.category} · Sample</p>
                  <h3>{p.name}</h3>
                  <p className="ns-product-price">
                    {formatMoney({
                      amount: String(p.priceCents / 100),
                      currencyCode: "USD",
                    })}
                  </p>
                  <p className="ns-availability">
                    Example price · not for purchase
                  </p>
                  <span className="ns-product-action">
                    View sample <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {!data.products.length && <CatalogState />}
        </section>
        <section className="ns-new-releases">
          <SectionHeading title="New releases" />
          <CatalogState releases />
        </section>
      </div>
    );
  }

  const result = await Promise.resolve()
    .then(async () => {
      const query = storefront();
      const initial = await browse(query, {});
      const collections = await discoverHomeCollections(
        initial.collections,
        (after) =>
          browse(query, { collectionsAfter: after }).then(
            (page) => page.collections,
          ),
      );
      // Reuse the current Storefront browse contract. Independent collection reads run together.
      const [featured, releases] = await Promise.all([
        collections.featured
          ? browse(query, { collection: collections.featured.handle }).catch(
              () => null,
            )
          : collections.complete
            ? initial
            : null,
        collections.releases
          ? browse(query, { collection: collections.releases.handle }).catch(
              () => null,
            )
          : collections.complete
            ? undefined
            : null,
      ]);
      return { featured, releases, collections };
    })
    .catch(() => null);

  const featuredHref = result?.collections.featured
    ? shopLink({ collection: result.collections.featured.handle })
    : "/shop";
  const releasesHref = result?.collections.releases
    ? shopLink({ collection: result.collections.releases.handle })
    : "/shop";
  return (
    <div className="ns-content ns-merchandising">
      <section aria-label="Featured products">
        <SectionHeading title="Featured products" href={featuredHref} />
        {result?.featured?.products.nodes.length ? (
          <div className="ns-products">
            {result.featured.products.nodes.slice(0, 4).map((p) => (
              <HomeProductCard product={p} back={featuredHref} key={p.id} />
            ))}
          </div>
        ) : (
          <CatalogState error={!result || result.featured === null} />
        )}
      </section>
      <section className="ns-new-releases" aria-label="New releases">
        <SectionHeading title="New releases" href={releasesHref} />
        {result?.releases?.products.nodes.length ? (
          <div className="ns-products">
            {result.releases.products.nodes.slice(0, 4).map((p) => (
              <HomeProductCard product={p} back={releasesHref} key={p.id} />
            ))}
          </div>
        ) : (
          <CatalogState releases error={!result || result.releases === null} />
        )}
      </section>
    </div>
  );
}

export function MerchandisingLoading() {
  return (
    <div className="ns-content ns-merchandising" aria-busy="true">
      <h2>Featured products</h2>
      <p role="status">Loading the collection…</p>
      <div className="ns-products ns-skeletons" aria-hidden="true">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} />
        ))}
      </div>
    </div>
  );
}

async function readHomeEvents() {
  return showRead(
    async (db, sample) =>
      (
        await db.query<Show>(
          "select * from ns.show_events where tenant_id=$1 and published and brand='northside' and fixture=$2 order by starts_at asc nulls last",
          [TENANT, sample],
        )
      ).rows,
  )
    .then((rows) => upcomingHomeShows(rows, Date.now()))
    .catch(() => null);
}

export async function HomeEvents() {
  const shows = await readHomeEvents();
  return (
    <div className="ns-event-panel">
      <p className="ns-kicker">ON THE CALENDAR</p>
      <h3>Meet us at a show.</h3>
      {shows?.length ? (
        <ul className="ns-event-list">
          {shows.map((show) => (
            <li key={show.id}>
              <CalendarDays size={22} aria-hidden="true" />
              <div>
                {show.fixture && (
                  <span className="ns-sample-label">SAMPLE EVENT</span>
                )}
                <h4>
                  <Link href={`/shows/${show.slug}`} prefetch={false}>
                    {show.title}
                  </Link>
                </h4>
                <p>
                  {show.starts_at ? (
                    <time dateTime={show.starts_at}>
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "America/Chicago",
                        timeZoneName: "short",
                      }).format(new Date(show.starts_at))}
                    </time>
                  ) : (
                    "Date to be confirmed"
                  )}
                  {show.location ? ` · ${show.location}` : ""}
                </p>
              </div>
              <ArrowRight size={18} aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : (
        <p role={shows === null ? "status" : undefined}>
          {shows === null
            ? "Events are temporarily unavailable. Please check back soon."
            : "No upcoming shows are published yet. Check back for the next gathering."}
        </p>
      )}
      <Link className="ns-text-link" href="/shows" prefetch={false}>
        Explore events <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}
