import Link from "next/link";
import { LoungeFeature } from "@/components/lounge-feature";
import { showRead } from "@/lib/server/show-public";
import { TENANT } from "@/lib/server/providers";
import type { Show } from "@/lib/engagement";
import { showListState } from "@/lib/show-list";
export default async function Page() {
  const result = await showListState(() =>
    showRead(
      async (db, sample) =>
        (
          await db.query<Show>(
            "select * from ns.show_events where tenant_id=$1 and published and brand='northside' and fixture=$2 order by title",
            [TENANT, sample],
          )
        ).rows,
    ),
  );
  return (
    <div className="engagement-workspace">
      <p className="eyebrow">NORTHSIDE COLLECTIBLES</p>
      <h1>Meet us at a show</h1>
      <p>
        Browse the collection, discover breaks and stay connected after your
        visit.
      </p>
      {result.status === "unavailable" ? (
        <section
          className="notice"
          role="alert"
          aria-labelledby="shows-unavailable"
        >
          <h2 id="shows-unavailable">Show details unavailable</h2>
          <p>
            We could not load the show list. Please try again when connected.
          </p>
          <form action="/shows" method="get">
            <button className="button secondary" type="submit">
              Try again
            </button>
          </form>
        </section>
      ) : result.shows.length ? (
        result.shows.map((s) => (
          <section className="loyalty-card" key={s.id}>
            {s.fixture && <p className="eyebrow">SAMPLE · FICTIONAL SHOW</p>}
            <h2>{s.title}</h2>
            <p>{s.description}</p>
            <Link className="button" href={"/shows/" + s.slug}>
              Explore this show
            </Link>
          </section>
        ))
      ) : (
        <p>No confirmed show details are published yet.</p>
      )}
      <LoungeFeature eager />
      <p>
        <Link href="/shop">Browse cards</Link> ·{" "}
        <Link href="/install">Install Northside</Link>
      </p>
    </div>
  );
}
