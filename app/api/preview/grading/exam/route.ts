import { examHttp } from "@/lib/server/exam-http";
export const runtime = "nodejs";
export const GET = (request: Request) => examHttp(request, true);
export const POST = GET;
export const PUT = GET;
