import {
  mobileCatalogSchema,
  mobileProductSchema,
  mobileInfoSchema,
  mobileWalletSchema,
  mobileBreaksSchema,
  mobileDeletionSchema,
  type CatalogInput,
} from "@northside/customer-contracts/mvp";
import {
  mobileErrorSchema,
  mobileIntentSchema,
  mobileSessionSchema,
  mobileAccountSchema,
  mobileOrdersSchema,
  mobileServicesSchema,
  mobileLogoutSchema,
  type MobileIntentRequest,
  type MobileExchangeRequest,
} from "@northside/customer-contracts/mobile";
import {
  SHOPPING_SESSION_HEADER,
  shoppingActionSchema,
  shoppingErrorSchema,
  shoppingResponseSchema,
  type ShoppingAction,
} from "@northside/customer-contracts/shopping";
import {
  trackingListSchema,
  trackingDetailSchema,
  serviceTermsSchema,
  termsAcceptanceSchema,
  type TrackingService,
  type TermsAcceptance,
} from "@northside/customer-contracts/tracking";
import {
  requestConfigSchema,
  requestListSchema,
  requestReceiptSchema,
  requestClaimReceiptSchema,
  requestSchema,
  type ServiceRequestInput,
} from "@northside/customer-contracts/service-requests";
import { emitScanTrace, type ScanTraceListener } from "./scan-trace";

export class MobileFailure extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
type Schema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};
// Covers the maximum bounded catalog/300-service DTOs, including UTF-8 labels.
export const MOBILE_RESPONSE_LIMIT = 4 * 1024 * 1024;
export async function boundedText(response: Response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MOBILE_RESPONSE_LIMIT)
    throw new MobileFailure("invalid_response");
  if (response.body?.getReader) {
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const value = await reader.read();
        if (value.done) break;
        bytes += value.value.length;
        if (bytes > MOBILE_RESPONSE_LIMIT)
          throw new MobileFailure("invalid_response");
        chunks.push(value.value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return new Response(joined).text();
  }
  // Native fetch implementations without streams still enforce a post-read bound.
  const value = await response.text();
  if (value.length > MOBILE_RESPONSE_LIMIT)
    throw new MobileFailure("invalid_response");
  return value;
}
export class MobileApi {
  readonly base: string;
  constructor(
    readonly origin: string,
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 12000,
    private readonly pause = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms)),
    options: { variant?: "development" | "preview" | "production" } = {},
  ) {
    const url = new URL(origin);
    if (
      (url.protocol !== "https:" &&
        !(
          options.variant === "development" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw new MobileFailure("not_configured");
    this.base = `${origin}/api/mobile/v1`;
  }
  private async send<T>(
    path: string,
    schema: Schema<T>,
    options: {
      body?: unknown;
      token?: string;
      signal?: AbortSignal;
      shoppingToken?: string;
      errorSchema?: Schema<{ error: { code: string } }>;
      scan?: { trace?: ScanTraceListener };
    } = {},
  ): Promise<T> {
    const retries = options.body === undefined ? 1 : 0;
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new MobileFailure("cancelled");
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, this.timeoutMs);
      try {
        // Browser fetch rejects a MobileApi instance as its receiver.
        const request = this.request;
        const response = await request(this.base + path, {
          method: options.body === undefined ? "GET" : "POST",
          headers: {
            Accept: "application/json",
            ...(options.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(options.token
              ? { Authorization: `Bearer ${options.token}` }
              : {}),
            ...(options.shoppingToken
              ? { [SHOPPING_SESSION_HEADER]: options.shoppingToken }
              : {}),
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        if (options.scan) {
          emitScanTrace(options.scan.trace, {
            path: "backend-registry",
            stage: "backend-request",
            endpoint: this.base + path,
            httpStatus: response.status,
            requestCache: "no-store",
          });
          if (response.status === 429) throw new MobileFailure("rate_limited");
          if (response.status >= 500) throw new MobileFailure("server_error");
          if ([401, 403].includes(response.status))
            throw new MobileFailure("scan_access_denied");
          if (
            response.status === 404 &&
            !/application\/json/i.test(
              response.headers.get("content-type") ?? "",
            )
          )
            throw new MobileFailure("scan_endpoint_unavailable");
        }
        if (
          !/application\/json/i.test(response.headers.get("content-type") ?? "")
        )
          throw new MobileFailure("invalid_response");
        // Reject oversized responses before parsing and never surface raw provider/server errors.
        const raw = await boundedText(response);
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          throw new MobileFailure("invalid_response");
        }
        if (!response.ok) {
          const parsed = (options.errorSchema ?? mobileErrorSchema).safeParse(
            value,
          );
          if (
            options.scan &&
            parsed.success &&
            parsed.data.error.code === "not_found" &&
            response.status !== 404
          )
            throw new MobileFailure("invalid_response");
          if (attempt < retries && [502, 503, 504].includes(response.status)) {
            await this.pause(250);
            continue;
          }
          throw new MobileFailure(
            options.scan &&
              response.status === 404 &&
              (!parsed.success || parsed.data.error.code !== "not_found")
              ? "scan_endpoint_unavailable"
              : parsed.success
                ? parsed.data.error.code
                : response.status === 401
                  ? "session_expired"
                  : "service_unavailable",
          );
        }
        const parsed = schema.safeParse(value);
        if (!parsed.success) throw new MobileFailure("invalid_response");
        return parsed.data;
      } catch (error) {
        if (options.signal?.aborted) throw new MobileFailure("cancelled");
        if (error instanceof MobileFailure) {
          controller.abort();
          throw error;
        }
        if (attempt < retries) {
          await this.pause(250);
          continue;
        }
        throw new MobileFailure(
          controller.signal.aborted ? "timeout" : "offline",
        );
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      }
    }
  }
  intent(input: MobileIntentRequest, signal?: AbortSignal) {
    return this.send("/auth/intents", mobileIntentSchema, {
      body: input,
      signal,
    });
  }
  exchange(input: MobileExchangeRequest, signal?: AbortSignal) {
    return this.send("/auth/exchange", mobileSessionSchema, {
      body: input,
      signal,
    });
  }
  renew(renewalToken: string, signal?: AbortSignal) {
    return this.send("/auth/renew", mobileSessionSchema, {
      body: { renewalToken },
      signal,
    });
  }
  logout(renewalToken: string) {
    return this.send("/auth/logout", mobileLogoutSchema, {
      body: { renewalToken },
    });
  }
  account(token: string, signal?: AbortSignal) {
    return this.send("/me", mobileAccountSchema, { token, signal });
  }
  orders(token: string, after?: string, signal?: AbortSignal) {
    return this.send(
      "/me/orders" + (after ? "?after=" + encodeURIComponent(after) : ""),
      mobileOrdersSchema,
      { token, signal },
    );
  }
  services(
    token: string,
    kind: "cards" | "consignments",
    signal?: AbortSignal,
  ) {
    return this.send("/me/" + kind, mobileServicesSchema, { token, signal });
  }
  tracking(token: string, service: TrackingService, signal?: AbortSignal) {
    if (!["grading", "consignment"].includes(service))
      throw new MobileFailure("invalid_request");
    return this.send(`/me/tracking/${service}`, trackingListSchema, {
      token,
      signal,
    });
  }
  serviceRequests(token: string, signal?: AbortSignal) {
    return this.send("/me/service-requests", requestListSchema, {
      token,
      signal,
    });
  }
  claimServiceRequest(
    token: string,
    id: string,
    claim_token: string,
    signal?: AbortSignal,
  ) {
    return this.send("/me/service-requests", requestClaimReceiptSchema, {
      token,
      signal,
      body: { action: "claim", id, claim_token },
    });
  }
  serviceRequestConfig(token: string, signal?: AbortSignal) {
    return this.send("/me/service-requests/config", requestConfigSchema, {
      token,
      signal,
    });
  }
  submitServiceRequest(
    token: string,
    input: ServiceRequestInput,
    platform: "ios" | "android",
    signal?: AbortSignal,
  ) {
    const p = requestSchema.safeParse(input);
    if (!p.success) throw new MobileFailure("invalid_request");
    return this.send("/me/service-requests", requestReceiptSchema, {
      token,
      signal,
      body: { action: "submit", platform, input: p.data },
    });
  }
  trackingDetail(
    token: string,
    service: TrackingService,
    id: string,
    signal?: AbortSignal,
  ) {
    if (
      !["grading", "consignment"].includes(service) ||
      !/^[0-9a-f-]{36}$/i.test(id)
    )
      throw new MobileFailure("invalid_request");
    return this.send(`/me/tracking/${service}/${id}`, trackingDetailSchema, {
      token,
      signal,
    });
  }
  acceptTerms(token: string, input: TermsAcceptance, signal?: AbortSignal) {
    const parsed = termsAcceptanceSchema.safeParse(input);
    if (!parsed.success) throw new MobileFailure("invalid_request");
    return this.send("/me/tracking/terms", serviceTermsSchema, {
      token,
      signal,
      body: parsed.data,
    });
  }
  async trackingPhoto(
    token: string,
    service: TrackingService,
    id: string,
    photo: string,
    signal?: AbortSignal,
  ) {
    if (
      !["grading", "consignment"].includes(service) ||
      [id, photo].some((v) => !/^[0-9a-f-]{36}$/i.test(v))
    )
      throw new MobileFailure("invalid_request");
    if (signal?.aborted) throw new MobileFailure("cancelled");
    const controller = new AbortController(),
      abort = () => controller.abort(),
      timer = setTimeout(abort, this.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const request = this.request,
        r = await request(
          `${this.base}/me/tracking/${service}/${id}/photos/${photo}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "image/jpeg,image/png,image/webp",
            },
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal: controller.signal,
          },
        );
      if (!r.ok) {
        if (r.status === 401) throw new MobileFailure("session_expired");
        throw new MobileFailure(
          r.status === 404 ? "not_found" : "service_unavailable",
        );
      }
      const mime = r.headers.get("content-type")?.split(";")[0];
      if (
        !mime ||
        !["image/jpeg", "image/png", "image/webp"].includes(mime) ||
        Number(r.headers.get("content-length")) > 5242880
      )
        throw new MobileFailure("invalid_response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (r.body?.getReader) {
        const reader = r.body.getReader();
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 5242880) throw new MobileFailure("invalid_response");
            chunks.push(part.value);
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
      } else {
        const bytes = new Uint8Array(await r.arrayBuffer());
        size = bytes.length;
        if (size > 5242880) throw new MobileFailure("invalid_response");
        chunks.push(bytes);
      }
      if (!size) throw new MobileFailure("invalid_response");
      let binary = "";
      for (const chunk of chunks)
        for (let offset = 0; offset < chunk.length; offset += 32768)
          binary += String.fromCharCode(
            ...chunk.subarray(offset, offset + 32768),
          );
      return `data:${mime};base64,${btoa(binary)}`;
    } catch (e) {
      if (signal?.aborted) throw new MobileFailure("cancelled");
      if (e instanceof MobileFailure) throw e;
      throw new MobileFailure(
        controller.signal.aborted ? "timeout" : "offline",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  catalog(input: CatalogInput = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input))
      if (value) params.set(key, value);
    return this.send(
      "/catalog" + (params.size ? "?" + params : ""),
      mobileCatalogSchema,
      { signal },
    );
  }
  releases(signal?: AbortSignal) {
    return this.send("/releases", mobileCatalogSchema, { signal });
  }
  product(handle: string, after?: string, signal?: AbortSignal) {
    if (!/^[a-z0-9-]{1,150}$/.test(handle))
      throw new MobileFailure("not_found");
    return this.send(
      "/catalog/" +
        handle +
        (after ? "?after=" + encodeURIComponent(after) : ""),
      mobileProductSchema,
      { signal },
    );
  }
  async scan(
    code: string,
    signal?: AbortSignal,
    format?: string,
    trace?: ScanTraceListener,
  ) {
    emitScanTrace(trace, {
      path: "backend-registry",
      stage: "backend-request",
      endpoint: this.base + "/scan",
      httpStatus: null,
      requestCache: "no-store",
    });
    const result = await this.send("/scan", mobileProductSchema, {
      body: { code, ...(format ? { format } : {}) },
      signal,
      scan: { trace },
    });
    emitScanTrace(trace, { path: "backend-registry", stage: "complete" });
    return result;
  }
  shopping(
    action: ShoppingAction,
    sessionToken?: string,
    accessToken?: string,
    signal?: AbortSignal,
  ) {
    const parsed = shoppingActionSchema.safeParse(action);
    if (
      !parsed.success ||
      (sessionToken !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(sessionToken))
    )
      throw new MobileFailure("invalid_request");
    // Every list command is POST and receives zero automatic transport retries.
    return this.send("/shopping", shoppingResponseSchema, {
      body: parsed.data,
      shoppingToken: sessionToken,
      token: accessToken,
      signal,
      errorSchema: shoppingErrorSchema,
    });
  }
  info(signal?: AbortSignal) {
    return this.send("/info", mobileInfoSchema, { signal });
  }
  wallet(token: string, signal?: AbortSignal) {
    return this.send("/me/wallet", mobileWalletSchema, { token, signal });
  }
  breaks(token: string, signal?: AbortSignal) {
    return this.send("/me/breaks", mobileBreaksSchema, { token, signal });
  }
  deletionStatus(token: string, signal?: AbortSignal) {
    return this.send("/me/deletion-request", mobileDeletionSchema, {
      token,
      signal,
    });
  }
  requestDeletion(token: string, signal?: AbortSignal) {
    return this.send("/me/deletion-request", mobileDeletionSchema, {
      token,
      body: { confirmation: "DELETE MY ACCOUNT" },
      signal,
    });
  }
}
