import { GradingOperations } from "@/components/grading-operations";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const { card } = await searchParams;
  return (
    <GradingOperations
      fixture={fixturesAllowed(process.env)}
      initialCard={card}
    />
  );
}
