import { ShopPage } from "@/components/preview";
import { LiveShop } from "@/components/live-shop";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (fixturesAllowed(process.env)) return <ShopPage />;
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  return (
    <LiveShop
      input={{
        q: one("q"),
        category: one("category"),
        collection: one("collection"),
        after: one("after"),
        collectionsAfter: one("collectionsAfter"),
      }}
      campaign={one("campaign")}
    />
  );
}
