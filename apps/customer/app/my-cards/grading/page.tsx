import { CustomerGradingPortal } from "@/components/grading-portal";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string }>;
}) {
  const fixture = fixturesAllowed(process.env),
    actor = fixture && (await searchParams).actor === "b" ? "b" : "a";
  return <CustomerGradingPortal key={actor} fixture={fixture} actor={actor} />;
}
