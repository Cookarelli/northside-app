import { ProductPage } from "@/components/preview";
import { getData } from "@/lib/services";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { product, storefront } from "@/lib/server/storefront";
import { ProductImage } from "@/components/live-shop";
import { ProductControls } from "@/components/commerce-controls";
import { safeShopBack } from "@/lib/commerce";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; variantsAfter?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams,
    back = safeShopBack(search.back);
  if (!fixturesAllowed(process.env)) {
    if (id.startsWith("sample-")) notFound();
    const result = await Promise.resolve()
      .then(() => product(storefront(), id, search.variantsAfter))
      .then((p) => ({ product: p, failed: false }))
      .catch(() => ({ product: null, failed: true }));
    if (result.failed)
      return (
        <div className="empty">
          <h1>Product unavailable</h1>
          <p>Shopify could not be reached. Please try again later.</p>
          <Link href={back}>Back to shop</Link>
        </div>
      );
    if (!result.product) notFound();
    const p = result.product;
    return (
      <>
        <Link className="back" href={back}>
          ← Back to shop
        </Link>
        <div className="detail-grid">
          <ProductImage product={p} />
          <section>
            <p className="eyebrow">{p.productType}</p>
            <h1>{p.title}</h1>
            <p className="lede">{p.description}</p>
            <ProductControls key={search.variantsAfter || id} product={p} />
            {p.variants.pageInfo.hasNextPage && (
              <Link
                className="back"
                href={`/shop/${id}?back=${encodeURIComponent(back)}&variantsAfter=${encodeURIComponent(p.variants.pageInfo.endCursor!)}`}
              >
                More variants →
              </Link>
            )}
            {search.variantsAfter && (
              <Link
                className="back"
                href={`/shop/${id}?back=${encodeURIComponent(back)}`}
              >
                First variants
              </Link>
            )}
          </section>
        </div>
      </>
    );
  }
  const data = await getData();
  if (!data.products.some((p) => p.id === id)) notFound();
  return <ProductPage id={id} back={back} />;
}
