import { NextResponse } from "next/server";
import { liveOnly, supabase } from "@/lib/server/providers";
import {
  AccessError,
  appOrigin,
  errorResponse,
  sameOrigin,
} from "@/lib/server/security";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    liveOnly();
    const form = await request.formData();
    const email = form.get("email");
    if (typeof email !== "string" || email.length > 254 || !email.includes("@"))
      throw new AccessError(400, "invalid_email");
    await supabase().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: appOrigin() + "/api/auth/staff/callback",
      },
    });
    return NextResponse.redirect(
      new URL("/staff/login?requested=1", appOrigin()),
      303,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
