import { gradingOperationsHttp } from "@/lib/server/grading-operations-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = (request: Request) => gradingOperationsHttp(request, false);
export const POST = GET;
