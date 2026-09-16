import { privateRoute } from "@/lib/server/http";
import { exportCards } from "@/lib/server/records";
export async function GET(request: Request) {
  return privateRoute(request, exportCards, { csv: true });
}
