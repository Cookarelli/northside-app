import { NorthsideExam } from "@/components/northside-exam";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <NorthsideExam
      key={id}
      cardId={id}
      fixture={fixturesAllowed(process.env)}
      staff
    />
  );
}
