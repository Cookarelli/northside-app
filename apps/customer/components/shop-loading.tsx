// Listing-only fallback: product notFound() must run before any route stream.
export function ShopLoading() {
  return (
    <section
      className="ns-shop-loading"
      aria-busy="true"
      aria-label="Loading shop"
    >
      <p role="status">Loading the collection…</p>
      <div className="ns-loading-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} />
        ))}
      </div>
    </section>
  );
}
