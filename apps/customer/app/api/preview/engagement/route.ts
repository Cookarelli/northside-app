import { engagementApi } from "@/lib/server/engagement-api";
export const runtime = "nodejs";
export const GET = (request: Request) => engagementApi(request, true);
export const POST = GET;
