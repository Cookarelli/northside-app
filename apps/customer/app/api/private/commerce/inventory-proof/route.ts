import { privateRoute } from "@/lib/server/http";
import { inspectVariantInventory } from "@/lib/server/inventory-proof";

export async function GET(request: Request) {
  return privateRoute(request, (_db, actor) =>
    inspectVariantInventory(
      actor,
      new URL(request.url).searchParams.get("variantId") || "",
    ),
  );
}
