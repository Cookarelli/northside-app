import type { Show } from "./engagement";
import type { Connection } from "./commerce";

type Collection = { handle: string; title: string };
const normalized = (title: string) =>
  title.trim().toLowerCase().replace(/\s+/g, " ");

// Merchandising labels come from published Shopify collections, never a guessed date or price.
export function homeCollections(collections: Collection[]) {
  return {
    featured: collections.find((c) =>
      [
        "featured",
        "featured products",
        "staff picks",
        "staff favorites",
      ].includes(normalized(c.title)),
    ),
    releases: collections.find((c) =>
      ["new releases", "new arrivals", "latest releases"].includes(
        normalized(c.title),
      ),
    ),
  };
}

export async function discoverHomeCollections(
  initial: Connection<Collection>,
  next: (after: string) => Promise<Connection<Collection>>,
  maxPages = 8,
) {
  let page = initial;
  const collections = [...initial.nodes];
  const cursors = new Set<string>();
  for (let count = 1; page.pageInfo.hasNextPage; count++) {
    const selected = homeCollections(collections);
    if ((selected.featured && selected.releases) || count >= maxPages) break;
    const cursor = page.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor))
      throw Error("Collection pagination unavailable");
    cursors.add(cursor);
    page = await next(cursor);
    collections.push(...page.nodes);
  }
  return {
    ...homeCollections(collections),
    complete: !page.pageInfo.hasNextPage,
  };
}

export function upcomingHomeShows(shows: Show[], now: number) {
  return shows
    .filter(
      (s) =>
        s.published &&
        s.brand === "northside" &&
        (s.starts_at === null ||
          (Number.isFinite(Date.parse(s.starts_at)) &&
            Date.parse(s.starts_at) >= now)),
    )
    .toSorted(
      (a, b) =>
        (a.starts_at ? Date.parse(a.starts_at) : Infinity) -
        (b.starts_at ? Date.parse(b.starts_at) : Infinity),
    )
    .slice(0, 3);
}
