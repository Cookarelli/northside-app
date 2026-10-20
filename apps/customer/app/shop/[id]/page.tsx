import { ProductPage } from "@/components/preview";
import { getData } from "@/lib/services";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
      <div className="mobile-product">
        <Link className="back product-back" href={back}>
          <ArrowLeft size={18} aria-hidden="true" /> Shop
        </Link>
        <div className="detail-grid product-layout">
          <div className="product-gallery">
            <ProductImage product={p} />
            <p className="fine">NORTHSIDE COLLECTIBLES</p>
          </div>
          <section>
            <p className="eyebrow">{p.productType}</p>
            <h1>{p.title}</h1>

            <ProductControls key={search.variantsAfter || id} product={p} />
            {p.description && (
              <details className="collector-disclosure">
                <summary>About this item</summary>
                <p>{p.description}</p>
              </details>
            )}
            <p className="product-assurance">
              <ShieldCheck size={18} aria-hidden="true" /> Price and
              availability from Shopify
            </p>
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
      </div>
    );
  }
  const data = await getData();
  if (!data.products.some((p) => p.id === id)) notFound();
  return <ProductPage id={id} back={back} />;
}
