import { gradingPortalHttp } from "@/lib/server/grading-portal-http";
export const runtime = "nodejs";
export const GET = (request: Request) => gradingPortalHttp(request, false);
export const POST = GET;
