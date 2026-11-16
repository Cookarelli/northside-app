import "server-only";
import { getStore } from "@northside/data";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { transaction } from "../db";
import { TENANT } from "../providers";
import { AccessError, SESSION_COOKIE, validToken } from "../security";
import { ShoppingCartService, type ShoppingOwner } from "../shopping-cart";
import { cents, buyerIP } from "../shopify-config";
import { storefront } from "../storefront";
import {
  NativeStorefrontCartService,
  nativeCartPorts,
} from "./storefront-cart";
import { lookupCartScan } from "./active-scan";
import { nativeScanCartGate, nativeScanCartSelected } from "./scan-cart-gate";
import { storeGate } from "../store";
import { nativeParent } from "./service";
import {
  approvedCollection,
  nativeScanTargetOn,
  readProduct,
  resolveNativeCandidates,
  verifyScanProduct,
} from "./catalog";
import { MOBILE_CONTRACT_VERSION } from "../../../../../packages/customer-contracts/src/mobile";
import {
  SHOPPING_SESSION_HEADER,
  shoppingActionSchema,
  shoppingCartSchema,
  shoppingResponseSchema,
  shoppingErrorCodeSchema,
} from "../../../../../packages/customer-contracts/src/shopping";
import type { ScanResult } from "../../store";
import type { ShoppingCart } from "../../shopping";
import type { MobileProduct } from "../../../../../packages/customer-contracts/src/mvp";
import type { ShoppingCart as ContractCart } from "../../../../../packages/customer-contracts/src/shopping";

export type ShoppingScanDependencies = {
  approval: () => string;
  resolve: Parameters<typeof resolveNativeCandidates>[2];
  product: (handle: string, approval: string) => Promise<MobileProduct>;
};
const liveScan: ShoppingScanDependencies = {
  approval: approvedCollection,
  resolve: (candidate) =>
    transaction("runtime", (db) => nativeScanTargetOn(db, candidate)),
  product: (handle, approval) =>
    readProduct(handle, undefined, undefined, undefined, approval),
};

/** Resolves only the existing registry and approved published Storefront reads.
 * The canonical barcode is saved so EAN-13 to UPC normalization is not lost on
 * later quantity or readiness checks. No raw inventory leaves this module. */
export async function resolveShoppingScan(
  code: string,
  format?: string,
  deps: ShoppingScanDependencies = liveScan,
) {
  const approval = deps.approval();
  const canonical = new WeakMap<object, string>();
  const match = await resolveNativeCandidates(
    code,
    format,
    async (candidate) => {
      const value = await deps.resolve(candidate);
      if (value) canonical.set(value, candidate);
      return value;
    },
  );
  const product = await deps.product(match.result.product.handle, approval);
  verifyScanProduct(match, product.product);
  const canonicalCode = canonical.get(match);
  if (!canonicalCode) throw new AccessError(503, "invalid_provider_data");
  // The approval read is later than the registry proof. Never accept a changed
  // provider amount or a withdrawn/sold-out variant between these two reads.
  const scan: ScanResult = structuredClone(match.result);
  scan.product.title = product.product.title;
  scan.product.image = product.product.featuredImage;
  scan.product.variants = scan.product.variants.filter((mapping) =>
    product.product.variants.nodes.some(
      (variant) => variant.id === mapping.variant_id,
    ),
  );
  scan.availability.variants = scan.availability.variants
    .filter((variant) =>
      product.product.variants.nodes.some(
        (current) => current.id === variant.id,
      ),
    )
    .map((variant) => {
      const current = product.product.variants.nodes.find(
        (item) => item.id === variant.id,
      )!;
      if (current.price.amountCents !== cents(variant.price))
        throw new AccessError(409, "scan_price_changed_review_required");
      return {
        ...variant,
        title: current.title,
        available:
          variant.available &&
          product.product.availableForSale &&
          current.availability.availableForSale &&
          !current.availability.currentlyNotInStock,
      };
    });
  return { canonicalCode, scan };
}

export type MobileShoppingDependencies = {
  gate: () => void;
  service: (
    request?: Request,
  ) =>
    | Pick<
        ShoppingCartService,
        "start" | "read" | "add" | "set" | "ready" | "cancel"
      >
    | NativeStorefrontCartService;
  owner: (accessToken: string | undefined) => Promise<ShoppingOwner>;
  canonicalCode: (code: string, format?: string) => Promise<string>;
  encodeQr?: (value: string) => Promise<string>;
};
const live: MobileShoppingDependencies = {
  gate() {
    if (nativeScanCartSelected()) return nativeScanCartGate();
    storeGate("scanner");
    approvedCollection();
    if (process.env.NORTHSIDE_MOBILE_SCAN_READS_APPROVED !== "true")
      throw new AccessError(503, "not_configured");
  },
  service: (request) =>
    nativeScanCartSelected()
      ? new NativeStorefrontCartService(
          getStore(),
          nativeCartPorts(
            storefront(request ? buyerIP(request.headers) : undefined),
          ),
        )
      : new ShoppingCartService(
          getStore(),
          async (code) => (await resolveShoppingScan(code)).scan,
          false,
        ),
  owner: async (accessToken) => ({
    tenant: TENANT,
    customerId: accessToken
      ? (await nativeParent(accessToken)).actor.customer_id
      : null,
  }),
  canonicalCode: async (code, format) => {
    if (nativeScanCartSelected()) {
      try {
        const { product } = await lookupCartScan(code, format);
        const v = product.variants.nodes.find(
          (v) => v.id === product.selectedVariantId,
        );
        if (!v?.identifiers.barcode)
          throw new AccessError(409, "missing_or_unverified_variant");
        return v.identifiers.barcode;
      } catch (error) {
        if (!(error instanceof AccessError) || error.code !== "unsupported_qr")
          throw error;
      }
    }
    return (await resolveShoppingScan(code, format)).canonicalCode;
  },
};
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: `Authorization, ${SHOPPING_SESSION_HEADER}`,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function accessToken(request: Request) {
  if (
    (request.headers.get("cookie") ?? "")
      .split(";")
      .some((part) => part.trim().startsWith(SESSION_COOKIE + "="))
  )
    throw new AccessError(401, "unauthorized");
  if (!request.headers.has("authorization")) return undefined;
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) throw new AccessError(401, "unauthorized");
  return match[1];
}
function sessionToken(request: Request) {
  if (!request.headers.has(SHOPPING_SESSION_HEADER)) return undefined;
  const token = request.headers.get(SHOPPING_SESSION_HEADER);
  if (!validToken(token))
    throw new AccessError(401, "shopping_session_expired");
  return token;
}
function projection(cart: ShoppingCart | ContractCart) {
  const provider =
    "source" in cart && cart.source === "shopify_cart"
      ? (cart as ContractCart)
      : undefined;
  const result = shoppingCartSchema.safeParse({
    version: cart.version,
    sample: cart.sample,
    phase: cart.phase,
    lines: cart.lines.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      title: line.title,
      variantTitle: line.variantTitle,
      image: line.image,
      quantity: line.quantity,
      priceCents: line.priceCents,
      ...(provider
        ? {
            sku: "sku" in line ? line.sku : null,
            lineTotalCents:
              "lineTotalCents" in line ? line.lineTotalCents : undefined,
            availability:
              "availability" in line ? line.availability : undefined,
          }
        : {}),
    })),
    subtotalCents: cart.subtotalCents,
    currency: cart.currency,
    paymentStatus: cart.paymentStatus,
    handoff: cart.handoff,
    ...(provider
      ? {
          source: provider.source,
          cost: provider.cost,
          observedAt: provider.observedAt,
          expiresAt: provider.expiresAt,
        }
      : {}),
  });
  if (!result.success) throw new AccessError(503, "invalid_provider_data");
  return result.data;
}
function failure(error: unknown) {
  const known = error instanceof AccessError;
  const proposed = known
    ? shoppingErrorCodeSchema.safeParse(error.code)
    : undefined;
  const code = proposed?.success
    ? proposed.data
    : known && [400, 413, 415].includes(error.status)
      ? "invalid_request"
      : known && error.status === 401
        ? "unauthorized"
        : known && error.status === 404
          ? "not_found"
          : "service_unavailable";
  return Response.json(
    {
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "error",
      error: { code },
      requestId: randomUUID(),
    },
    { status: known ? error.status : 503, headers },
  );
}

/** Body must already have passed the existing bounded mobile JSON reader.
 * Injected dependencies are exclusively for isolated local acceptance servers
 * and tests; request fields never select an adapter, fixture actor or tenant. */
export async function mobileShoppingHandler(
  request: Request,
  raw: unknown,
  deps: MobileShoppingDependencies = live,
) {
  try {
    if (request.method !== "POST" || new URL(request.url).search)
      throw new AccessError(400, "invalid_request");
    deps.gate();
    const input = shoppingActionSchema.safeParse(raw);
    if (!input.success) throw new AccessError(400, "invalid_request");
    const owner = await deps.owner(accessToken(request));
    const token = sessionToken(request),
      action = input.data,
      service = deps.service(request);
    let cart: ShoppingCart | ContractCart, createdToken: string | undefined;
    if (action.action === "start") {
      if (token) cart = await service.read(token, owner);
      else {
        const started = await service.start(owner);
        cart = started.cart;
        createdToken = started.token;
      }
    } else {
      if (!token) throw new AccessError(401, "shopping_session_expired");
      if (action.action === "read") cart = await service.read(token, owner);
      else if (action.action === "add") {
        // Commit guest-to-customer binding before any provider lookup, even if
        // canonicalization fails. A failed add must not leave a guest handle.
        if (service instanceof NativeStorefrontCartService)
          await service.bind(token, owner);
        else await service.read(token, owner);
        const canonicalCode = await deps.canonicalCode(
          action.code,
          action.format,
        );
        cart = await service.add(
          token,
          owner,
          action.version,
          canonicalCode,
          action.variantId,
          action.reviewedPriceCents,
        );
      } else if (action.action === "set")
        cart = await service.set(
          token,
          owner,
          action.version,
          action.variantId,
          action.quantity,
        );
      else if (action.action === "ready")
        cart = await service.ready(token, owner, action.version);
      else cart = await service.cancel(token, owner, action.version);
    }
    const safe = projection(cart);
    const qr = safe.handoff
      ? await (
          deps.encodeQr ??
          ((value) => QRCode.toDataURL(value, { width: 288, margin: 4 }))
        )("northside-handoff:v1:" + safe.handoff.reference)
      : undefined;
    const result = shoppingResponseSchema.safeParse({
      contractVersion: MOBILE_CONTRACT_VERSION,
      kind: "shopping",
      cart: safe,
      ...(createdToken ? { sessionToken: createdToken } : {}),
      ...(qr ? { qr } : {}),
    });
    if (!result.success) throw new AccessError(503, "invalid_provider_data");
    return Response.json(result.data, { headers });
  } catch (error) {
    return failure(error);
  }
}
