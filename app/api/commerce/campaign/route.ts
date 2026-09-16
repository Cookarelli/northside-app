import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { transaction } from "@/lib/server/db";
import { CAMPAIGN_COOKIE, recordTouch } from "@/lib/server/campaigns";
import { commerceConfig } from "@/lib/server/shopify-config";
import {
  sameOrigin,
  appOrigin,
  cookieOptions,
  opaqueToken,
  validToken,
  errorResponse,
  hashToken,
  privateHeaders,
} from "@/lib/server/security";
import { TENANT } from "@/lib/server/providers";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    commerceConfig();
    const data = await request.formData(),
      jar = await cookies(),
      old = jar.get(CAMPAIGN_COOKIE)?.value;
    if (data.get("consent") === "yes") {
      const token = validToken(old) ? old : opaqueToken();
      await transaction("commerce", (db) =>
        recordTouch(db, token, data.get("ref"), true),
      );
      jar.set(CAMPAIGN_COOKIE, token, { ...cookieOptions, maxAge: 30 * 86400 });
    } else {
      if (validToken(old))
        await transaction("commerce", (db) =>
          db.query(
            "delete from ns.campaign_touches where tenant_id=$1 and token_hash=$2",
            [TENANT, hashToken(old)],
          ),
        );
      jar.set(CAMPAIGN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    }
    return NextResponse.redirect(new URL("/shop", appOrigin()), {
      status: 303,
      headers: privateHeaders(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
