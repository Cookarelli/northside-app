import { cardTrackingHttp } from "@/lib/server/card-tracking-http";
export const runtime = "nodejs";
export const GET = (request: Request) => cardTrackingHttp(request);
export const POST = GET;
