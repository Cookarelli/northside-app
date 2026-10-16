import { CustomerGradingPortal } from "@/components/grading-portal";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ actor?: string }>;
}) {
  const { id } = await params,
    fixture = fixturesAllowed(process.env),
    actor = fixture && (await searchParams).actor === "b" ? "b" : "a";
  return (
    <CustomerGradingPortal
      key={`${actor}:${id}`}
      cardId={id}
      fixture={fixture}
      actor={actor}
    />
  );
}
