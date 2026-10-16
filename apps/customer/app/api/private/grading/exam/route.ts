import { examHttp } from "@/lib/server/exam-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = (request: Request) => examHttp(request, false);
export const POST = GET;
export const PUT = GET;
