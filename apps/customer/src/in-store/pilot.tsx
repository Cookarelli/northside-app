import Image from "next/image";
import Link from "next/link";

export default function InStorePilot() {
  return (
    <div className="northside-in-store">
      <div className="fixture-bar">IN-STORE PILOT · Ordering is not open</div>
      <header>
        <Link prefetch={false} href="/" className="brand">
          <Image
            src="/northside-logo.svg"
            width={207}
            height={57}
            alt="Northside Collectibles"
            priority
          />
        </Link>
        <Link prefetch={false} href="/shop" className="text-link">
          Browse the shop ↗
        </Link>
      </header>
      <main>
        <section className="page-section">
          <span className="eyebrow">GETTING READY FOR YOUR NEXT VISIT</span>
          <h1>
            In-store shopping
            <br />
            is being prepared.
          </h1>
          <p>
            Browse Northside’s published collection while the team verifies
            scanning, checkout and collection.
          </p>
          <div className="actions">
            <Link prefetch={false} href="/shop" className="button primary">
              Explore the catalog →
            </Link>
            <Link prefetch={false} href="/account" className="text-link">
              Your Northside account ↗
            </Link>
          </div>
          <div className="notice" role="status">
            Ordering, counter handoffs and merchandise collection are not
            available in this pilot. A scanned label does not reserve stock or
            confirm payment.
          </div>
        </section>
        <section className="page-section">
          <span className="eyebrow">FOR THE NORTHSIDE TEAM</span>
          <h2>Prepare the store connection.</h2>
          <p>
            Invited staff can review the existing Shopify integration and
            product mappings. Owner and admin accounts can inspect the connected
            app, permissions and webhook subscriptions.
          </p>
          <div className="actions">
            <Link
              prefetch={false}
              href="/staff/integrations"
              className="button secondary"
            >
              Integration status
            </Link>
            <Link
              prefetch={false}
              href="/staff/integrations/commerce-pilot"
              className="text-link"
            >
              Shopify pilot checks ↗
            </Link>
          </div>
        </section>
      </main>
      <footer>
        <p>Northside Collectibles · Your collection, connected.</p>
        <Link prefetch={false} href="/staff/login">
          Invited staff sign-in
        </Link>
      </footer>
    </div>
  );
}
