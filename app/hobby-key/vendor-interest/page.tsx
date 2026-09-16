import { notFound } from "next/navigation";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { ShowLanding } from "@/components/engagement-workspace";
import { showRead } from "@/lib/server/show-public";
import { publicShow, approvedPlacement } from "@/lib/server/measurement";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; ref?: string }>;
}) {
  const sample = fixturesAllowed(process.env);
  if (!sample && process.env.HOBBY_KEY_INTEREST_ENABLED !== "true") notFound();
  const p = await searchParams,
    slug = p.show || (sample ? "sample-hobby-key" : "vendor-interest");
  const data = await showRead(async (db, s) => ({
    show: await publicShow(db, slug, s),
    placement: await approvedPlacement(db, p.ref, s),
  })).catch(() => null);
  if (!data?.show || data.show.brand !== "hobby_key") notFound();
  return (
    <ShowLanding
      show={data.show}
      placement={
        data.placement?.event_id === data.show.id ? data.placement : null
      }
      sample={sample}
    />
  );
}
