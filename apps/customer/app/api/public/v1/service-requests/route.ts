import { publicServiceRequestHttp } from "@/lib/server/service-requests-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = publicServiceRequestHttp;
export const POST = publicServiceRequestHttp;
export const OPTIONS = publicServiceRequestHttp;
