import { getStore, requireRole as fixtureStaff } from "@northside/data";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { shoppingHttp } from "@/lib/server/shopping-http";
import { ShoppingCartService } from "@/lib/server/shopping-cart";
import { AccessError, privateHeaders, sameOrigin } from "@/lib/server/security";
import { resolveScan, storeGate } from "@/lib/server/store";
import { transaction, requireRole } from "@/lib/server/db";
import { TENANT } from "@/lib/server/providers";
import { customerContext } from "@/lib/server/customer-commerce";
import { privateRequest } from "@/lib/server/http";
import { storePreview } from "@/lib/server/store-preview";
import { previewActor } from "@/lib/server/grading-preview";
export const runtime = "nodejs";
const SHOPPING_COOKIE = "__Host-ns_shopping";
const sampleCookie = "ns_sample_shopping";
function sample() {
  return fixturesAllowed(process.env);
}
function cookie(request: Request) {
  const name = sample() ? sampleCookie : SHOPPING_COOKIE;
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
function gate(request: Request) {
  if (sample()) {
    previewActor(request);
    return;
  }
  storeGate("scanner");
}
function handle(request: Request) {
  const resolve = async (code: string, format?: "ean13") => {
    if (sample()) {
      const { f } = await storePreview(request);
      return f.run("a", (db) =>
        resolveScan(db, code, "sample", undefined, format),
      );
    }
    return transaction("runtime", (db) =>
      resolveScan(db, code, "live", undefined, format),
    );
  };
  return shoppingHttp(request, {
    gate,
    sameOrigin: (r) => {
      if (sample()) previewActor(r);
      else sameOrigin(r);
    },
    service: () => new ShoppingCartService(getStore(), resolve, sample()),
    owner: async () => ({
      tenant: TENANT,
      customerId: sample()
        ? null
        : (await customerContext(true))?.actor.customer_id || null,
    }),
    staff: async (r) => {
      if (sample()) {
        try {
          await fixtureStaff(r, "staff");
        } catch {
          throw new AccessError(401, "staff_sign_in_required");
        }
        return TENANT;
      }
      return privateRequest(async (_db, actor) => {
        requireRole(actor, ["owner", "admin", "operations", "read_only"]);
        return actor.tenant_id;
      });
    },
    resolve,
    token: cookie,
    remember: (response, token) => {
      response.headers.set(
        "Set-Cookie",
        sample()
          ? `${sampleCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
          : `${SHOPPING_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`,
      );
    },
  });
}
export const GET = handle;
export const POST = handle;
// Explicit recovery for expired cookies/account switches, without reading or
// returning the previous owner's cart. It cannot revoke another owner's handoff.
export async function DELETE(request: Request) {
  try {
    gate(request);
    if (sample()) previewActor(request);
    else sameOrigin(request);
    const response = Response.json(
      { cleared: true },
      { headers: privateHeaders() },
    );
    response.headers.set(
      "Set-Cookie",
      `${sample() ? sampleCookie : SHOPPING_COOKIE}=; HttpOnly; ${sample() ? "" : "Secure; "}SameSite=Lax; Path=/; Max-Age=0`,
    );
    return response;
  } catch (e) {
    const { errorResponse } = await import("@/lib/server/security");
    return errorResponse(e);
  }
}
