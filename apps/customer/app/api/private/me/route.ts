import { privateRoute } from "@/lib/server/http";
export async function GET(request: Request) {
  return privateRoute(request, async (_db, actor) => ({
    kind: actor.customer_id ? "customer" : "staff",
    role: actor.staff_role,
  }));
}
