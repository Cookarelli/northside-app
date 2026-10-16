import { notFound } from "next/navigation";
import { ShowLanding } from "@/components/engagement-workspace";
import { showRead } from "@/lib/server/show-public";
import { publicShow, approvedPlacement } from "@/lib/server/measurement";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params,
    { ref } = await searchParams;
  const data = await showRead(async (db, sample) => ({
    show: await publicShow(db, slug, sample),
    placement: await approvedPlacement(db, ref, sample),
    sample,
  })).catch(() => null);
  if (!data?.show || data.show.brand !== "northside") notFound();
  return (
    <ShowLanding
      show={data.show}
      placement={
        data.placement?.event_id === data.show.id ? data.placement : null
      }
      sample={data.sample}
    />
  );
}
