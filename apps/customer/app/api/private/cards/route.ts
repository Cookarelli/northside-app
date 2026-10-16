import { privateRoute } from "@/lib/server/http";
import { listCards } from "@/lib/server/records";
export async function GET(request: Request) {
  return privateRoute(request, listCards);
}
