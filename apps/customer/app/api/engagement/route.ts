import { engagementApi } from "@/lib/server/engagement-api";
import { fixturesAllowed } from "@/lib/policy.mjs";
export const runtime = "nodejs";
export const GET = (request: Request) =>
  fixturesAllowed(process.env)
    ? Response.json(
        { error: "live_disabled_in_fixture_mode" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      )
    : engagementApi(request);
export const POST = GET;
