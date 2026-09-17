import { NorthsideExam } from "@/components/northside-exam";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ actor?: string }>;
}) {
  const { id } = await params,
    { actor } = await searchParams;
  return (
    <NorthsideExam
      key={`${id}:${actor}`}
      cardId={id}
      fixture={fixturesAllowed(process.env)}
      staff={false}
      sampleActor={actor}
    />
  );
}
