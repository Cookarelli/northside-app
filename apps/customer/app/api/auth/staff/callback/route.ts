import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { transaction } from "@/lib/server/db";
import { TENANT, liveOnly, supabase } from "@/lib/server/providers";
import { createSession, revokeSession } from "@/lib/server/sessions";
import {
  AccessError,
  SESSION_COOKIE,
  appOrigin,
  cookieOptions,
  errorResponse,
} from "@/lib/server/security";
export async function POST(request: Request) {
  try {
    const { sameOrigin } = await import("@/lib/server/security");
    sameOrigin(request);
    liveOnly();
    const form = await request.formData();
    const token = form.get("token_hash"),
      type = form.get("type");
    if (
      typeof token !== "string" ||
      token.length > 512 ||
      !["email", "invite"].includes(String(type))
    )
      throw new AccessError(400, "invalid_invitation");
    const client = supabase();
    const result = await client.auth.verifyOtp({
      token_hash: token,
      type: type as "email" | "invite",
    });
    if (result.error || !result.data.session)
      throw new AccessError(401, "link_expired");
    const verified = await client.auth.getUser(
      result.data.session.access_token,
    );
    if (verified.error || !verified.data.user)
      throw new AccessError(401, "sign_in_failed");
    const jar = await cookies();
    const tokenValue = await transaction("auth", async (db) => {
      const member = (
        await db.query<{ id: string }>(
          "select id from ns.staff_memberships where tenant_id=$1 and auth_user_id=$2 and active",
          [TENANT, verified.data.user.id],
        )
      ).rows[0];
      if (!member) throw new AccessError(403, "staff_invitation_required");
      await revokeSession(db, jar.get(SESSION_COOKIE)?.value);
      return createSession(
        db,
        { staffId: member.id },
        "supabase",
        {
          access_token: result.data.session!.access_token,
          refresh_token: result.data.session!.refresh_token,
          subject: verified.data.user.id,
        },
        result.data.session!.expires_in,
      );
    });
    jar.set(SESSION_COOKIE, tokenValue, { ...cookieOptions, maxAge: 8 * 3600 });
    return NextResponse.redirect(new URL("/staff", appOrigin()), 303);
  } catch (e) {
    return errorResponse(e);
  }
}
