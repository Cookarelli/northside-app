import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverHomeCollections,
  homeCollections,
  upcomingHomeShows,
} from "../lib/home";
import type { Show } from "../lib/engagement";

test("Home uses published collection metadata without guessing release chronology", () => {
  const archive = { handle: "archive", title: "New releases archive" };
  const releases = {
    handle: "merchant-chosen-handle",
    title: " New   Arrivals ",
  };
  const featured = { handle: "staff", title: "Staff Picks" };
  assert.deepEqual(homeCollections([archive, releases, featured]), {
    featured,
    releases,
  });
  assert.equal(
    homeCollections([archive, { handle: "all", title: "All products" }])
      .releases,
    undefined,
  );
  assert.deepEqual(homeCollections([]), {
    featured: undefined,
    releases: undefined,
  });
});

test("Home discovers real merchandising collections on later pages using opaque cursors", async () => {
  const featured = { handle: "merchant-featured", title: "Featured products" };
  const releases = { handle: "merchant-release", title: "New releases" };
  const cursors: string[] = [];
  const result = await discoverHomeCollections(
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: "opaque-page-2" } },
    async (after) => {
      cursors.push(after);
      return {
        nodes: [featured, releases],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
    },
  );
  assert.deepEqual(cursors, ["opaque-page-2"]);
  assert.deepEqual(result, { featured, releases, complete: true });
});

test("Home never treats a bounded or broken collection search as a confirmed empty result", async () => {
  const first = {
    nodes: [],
    pageInfo: { hasNextPage: true, endCursor: "same-cursor" },
  };
  assert.equal(
    (await discoverHomeCollections(first, async () => first, 1)).complete,
    false,
  );
  await assert.rejects(
    () => discoverHomeCollections(first, async () => first),
    /pagination unavailable/,
  );
});

const event = (overrides: Partial<Show> = {}): Show => ({
  id: "event",
  slug: "event",
  brand: "northside",
  title: "Event",
  description: "",
  starts_at: null,
  location: null,
  published: true,
  fixture: false,
  version: 1,
  ...overrides,
});

test("Home events exclude private, other-brand, past and malformed entries", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const future = event({ id: "future", starts_at: "2026-11-01T12:00:00Z" });
  const unknown = event({ id: "unknown" });
  const input = [
    unknown,
    event({ published: false }),
    event({ brand: "hobby_key" }),
    event({ starts_at: "2020-01-01T00:00:00Z" }),
    event({ starts_at: "not-a-date" }),
    future,
  ];
  assert.deepEqual(upcomingHomeShows(input, now), [future, unknown]);
  assert.equal(
    input[0],
    unknown,
    "selection must not mutate the source listing",
  );
});

test("Home events retain exact confirmed timestamps and limit the preview", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const entries = [5, 2, 4, 1, 3].map((n) =>
    event({ id: String(n), starts_at: `2026-11-0${n}T19:30:00-06:00` }),
  );
  const result = upcomingHomeShows(entries, now);
  assert.deepEqual(
    result.map((s) => s.id),
    ["1", "2", "3"],
  );
  assert.equal(result[0].starts_at, "2026-11-01T19:30:00-06:00");
});
