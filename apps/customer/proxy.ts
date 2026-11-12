import { NextResponse, type NextRequest } from "next/server";
import { nativeIngressAllowed } from "./lib/native-api-ingress";

export function proxy(request: NextRequest) {
  if (
    !nativeIngressAllowed(
      request.url,
      request.method,
      process.env.NORTHSIDE_NATIVE_API_HOST,
      request.headers.get("host"),
    )
  )
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  return NextResponse.next();
}
