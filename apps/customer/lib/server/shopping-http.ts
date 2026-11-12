import "server-only";
import QRCode from "qrcode";
import type { ShoppingCart } from "../shopping";
import {
  ShoppingCartService,
  shoppingInput,
  type ShoppingOwner,
} from "./shopping-cart";
import { AccessError, errorResponse, privateHeaders } from "./security";
import type { ScanResult } from "../store";

export type ShoppingDependencies = {
  gate: (request: Request) => void;
  sameOrigin: (request: Request) => void;
  service: () => ShoppingCartService;
  owner: () => Promise<ShoppingOwner>;
  staff: (request: Request) => Promise<string>;
  resolve: (code: string, format?: "ean13") => Promise<ScanResult>;
  token: (request: Request) => string;
  remember: (response: Response, token: string) => void;
};
export async function shoppingHttp(
  request: Request,
  deps: ShoppingDependencies,
) {
  try {
    deps.gate(request);
    if (request.method !== "GET") deps.sameOrigin(request);
    let cart: ShoppingCart;
    const json = (data: unknown) =>
      Response.json(data, { headers: privateHeaders() });
    const cartJson = async (value: ShoppingCart) =>
      json({
        ...value,
        ...(value.handoff
          ? {
              qr: await QRCode.toDataURL(
                "northside-handoff:v1:" + value.handoff.reference,
                { width: 288, margin: 4 },
              ),
            }
          : {}),
      });
    if (request.method === "GET")
      cart = await deps.service().read(deps.token(request), await deps.owner());
    else if (request.method === "POST") {
      if (!request.headers.get("content-type")?.includes("application/json"))
        throw new AccessError(415, "json_required");
      const text = await request.text();
      if (text.length > 10000) throw new AccessError(413, "request_too_large");
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AccessError(400, "invalid_json");
      }
      const b = shoppingInput(raw);
      if (b.action === "inspect") {
        // Authorize first. Never accept an actor, tenant or a public QR as staff authority.
        const tenant = await deps.staff(request);
        return json(
          await deps.service().inspect(b.reference as string, tenant),
        );
      }
      if (b.action === "resolve")
        return json(
          await deps.resolve(b.code as string, b.format as "ean13" | undefined),
        );
      const owner = await deps.owner(),
        token = deps.token(request),
        service = deps.service();
      if (b.action === "start") {
        // An invalid/bound old cookie is never silently replaced. The UI offers
        // an explicit new-list action which clears only this shopping cookie.
        if (token) return cartJson(await service.read(token, owner));
        const started = await service.start(owner),
          response = json(started.cart);
        deps.remember(response, started.token);
        return response;
      }
      if (b.action === "add")
        cart = await service.add(
          token,
          owner,
          b.version as number,
          b.code as string,
          b.variantId as string,
          b.reviewedPriceCents as number,
        );
      else if (b.action === "set")
        cart = await service.set(
          token,
          owner,
          b.version as number,
          b.variantId as string,
          b.quantity as number,
        );
      else if (b.action === "ready")
        cart = await service.ready(token, owner, b.version as number);
      else if (b.action === "cancel")
        cart = await service.cancel(token, owner, b.version as number);
      else throw new AccessError(400, "invalid_shopping_input");
    } else throw new AccessError(405, "method_not_allowed");
    return cartJson(cart);
  } catch (e) {
    return errorResponse(e);
  }
}
