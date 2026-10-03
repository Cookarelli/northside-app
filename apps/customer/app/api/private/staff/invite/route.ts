import { privateRoute, jsonBody } from "@/lib/server/http";
import { requireRole, transaction } from "@/lib/server/db";
import { supabase } from "@/lib/server/providers";
import { AccessError, appOrigin } from "@/lib/server/security";
export async function POST(request: Request) {
  return privateRoute(request, async (_db, actor) => {
    requireRole(actor, ["owner", "admin"]);
    const body = await jsonBody(request);
    const allowed =
      actor.staff_role === "owner"
        ? ["admin", "operations", "content_editor", "read_only"]
        : ["operations", "content_editor", "read_only"];
    if (
      typeof body.email !== "string" ||
      body.email.length > 254 ||
      !body.email.includes("@") ||
      !allowed.includes(body.role)
    )
      throw new AccessError(400, "invalid_invitation");
    return transaction("auth", async (db) => {
      const inviter = (
        await db.query<{ role: string }>(
          "select role from ns.staff_memberships where tenant_id=$1 and id=$2 and active",
          [actor.tenant_id, actor.staff_id],
        )
      ).rows[0];
      if (inviter?.role !== actor.staff_role)
        throw new AccessError(403, "staff_permission_required");
      const result = await supabase(true).auth.admin.inviteUserByEmail(
        body.email,
        { redirectTo: appOrigin() + "/staff" },
      );
      if (result.error || !result.data.user)
        throw new AccessError(503, "invitation_not_sent");
      await db.query(
        "insert into ns.staff_memberships(tenant_id,auth_user_id,role,invited_by) values($1,$2,$3,$4)",
        [actor.tenant_id, result.data.user.id, body.role, actor.staff_id],
      );
      return { invited: true };
    });
  });
}
