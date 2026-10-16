import { BreakWorkspace } from "@/components/break-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { notFound, redirect } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fixture = fixturesAllowed(process.env);
  if (id === "sample-break" && fixture)
    redirect("/breaks/00000000-0000-4000-8000-000000007001");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    notFound();
  return <BreakWorkspace id={id} fixture={fixture} />;
}
