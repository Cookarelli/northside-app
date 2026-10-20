import Link from "next/link";
import { showRead } from "@/lib/server/show-public";
import { TENANT } from "@/lib/server/providers";
import type { Show } from "@/lib/engagement";
export default async function Page() {
  const shows = await showRead(
    async (db, sample) =>
      (
        await db.query<Show>(
          "select * from ns.show_events where tenant_id=$1 and published and brand='northside' and fixture=$2 order by title",
          [TENANT, sample],
        )
      ).rows,
  ).catch(() => []);
  return (
    <div className="engagement-workspace">
      <p className="eyebrow">NORTHSIDE COLLECTIBLES</p>
      <h1>Meet us at a show</h1>
      <p>
        Browse the collection, discover breaks and stay connected after your
        visit.
      </p>
      {shows.length ? (
        shows.map((s) => (
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
      <p>
        <Link href="/shop">Browse cards</Link> ·{" "}
        <Link href="/install">Install Northside</Link>
      </p>
    </div>
  );
}
