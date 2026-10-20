import { headers } from "../../lib/receiver";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    {
      service: "northside-webhook-pilot",
      mode:
        process.env.WEBHOOK_RECEIVER_MODE === "pilot-inbox"
          ? "pilot-inbox"
          : "disabled",
      readiness: "not-checked",
      processesOrders: false,
    },
    { headers },
  );
}
