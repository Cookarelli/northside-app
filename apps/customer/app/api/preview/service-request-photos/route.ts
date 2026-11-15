import { requestPhotoHttp } from "@/lib/server/service-request-photo-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => requestPhotoHttp(request, true);
export const POST = GET;
