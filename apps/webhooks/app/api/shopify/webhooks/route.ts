import { handle } from "../../../../lib/receiver";
import { saveReceipt } from "../../../../lib/inbox";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 5;
export async function POST(request: Request) {
  return handle(request, saveReceipt);
}
