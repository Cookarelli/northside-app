import { CustomerGradingPortal } from "@/components/grading-portal";
import { fixturesAllowed } from "@/lib/policy.mjs";
import Link from "next/link";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string }>;
}) {
  const fixture = fixturesAllowed(process.env),
    actor = fixture && (await searchParams).actor === "b" ? "b" : "a";
  return <><Link className="button" href="/my-cards/requests">Service requests & dated history</Link><CustomerGradingPortal key={actor} fixture={fixture} actor={actor} /></>;
}
