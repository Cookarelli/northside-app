import { serviceRequestHttp } from "@/lib/server/service-requests-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => serviceRequestHttp(request, true);
export const POST = GET;
