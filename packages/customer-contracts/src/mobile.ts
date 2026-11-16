import { z } from "zod";
import { catalogMoneyV1Schema, catalogPageInfoV1Schema } from "./catalog";

export const MOBILE_CONTRACT_VERSION = "northside.mobile.v1" as const;
export const mobileTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mobileVariantSchema = z.enum([
  "development",
  "preview",
  "production",
]);
const timestamp = z.iso.datetime({ precision: 3 });
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !!v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
const base = { contractVersion: z.literal(MOBILE_CONTRACT_VERSION) };
export const mobileIntentRequestSchema = z.strictObject({
  variant: mobileVariantSchema,
  appState: mobileTokenSchema,
  challenge: mobileTokenSchema,
  challengeMethod: z.literal("S256"),
});
export const mobileExchangeRequestSchema = z.strictObject({
  intentId: mobileTokenSchema,
  ticket: mobileTokenSchema,
  appState: mobileTokenSchema,
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});
export const mobileRenewRequestSchema = z.strictObject({
  renewalToken: mobileTokenSchema,
});
export const mobileIntentSchema = z.strictObject({
  ...base,
  kind: z.literal("auth-intent"),
  intentId: mobileTokenSchema,
  startUrl: z.url().max(2048),
  expiresAt: timestamp,
});
export const mobileSessionSchema = z
  .strictObject({
    ...base,
    kind: z.literal("session"),
    accessToken: mobileTokenSchema,
    renewalToken: mobileTokenSchema,
    accessExpiresAt: timestamp,
    absoluteExpiresAt: timestamp,
    customerId: z.uuid(),
    providerRenewal: z.enum(["refresh_available", "browser_reauthentication"]),
  })
  .superRefine((v, ctx) => {
    if (Date.parse(v.accessExpiresAt) > Date.parse(v.absoluteExpiresAt))
      ctx.addIssue({ code: "custom", message: "access_exceeds_parent" });
  });
export const mobileAccountSchema = z.strictObject({
  ...base,
  kind: z.literal("account"),
  customer: z.strictObject({
    id: z.uuid(),
    firstName: text(255).nullable(),
    lastName: text(255).nullable(),
    email: z.email().max(320).nullable(),
  }),
  sessionExpiresAt: timestamp,
});
export const mobileOrdersSchema = z.strictObject({
  ...base,
  kind: z.literal("orders"),
  orders: z
    .array(
      z.strictObject({
        id: z.string().regex(/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,29}$/),
        name: text(100),
        processedAt: timestamp,
        financialStatus: text(100).nullable(),
        total: catalogMoneyV1Schema,
      }),
    )
    .max(12),
  pageInfo: catalogPageInfoV1Schema,
});
export const mobileServiceItemSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["grading", "consignment"]),
  title: text(2000),
  status: text(100),
});
export const mobileServicesSchema = z.strictObject({
  ...base,
  kind: z.literal("services"),
  items: z.array(mobileServiceItemSchema).max(300),
});
export const mobileLogoutSchema = z.strictObject({
  ...base,
  kind: z.literal("logout"),
  revoked: z.literal(true),
  providerLogout: z.literal("not_performed"),
});
export const mobileErrorCodeSchema = z.enum([
  "ambiguous_scan",
  "invalid_request",
  "unauthorized",
  "session_expired",
  "reauthentication_required",
  "invalid_callback",
  "invalid_exchange",
  "renewal_replayed",
  "not_found",
  "provider_unavailable",
  "invalid_provider_data",
  "not_configured",
  "rate_limited",
  "service_unavailable",
  "request_terms_changed",
  "request_service_level_changed",
  "request_conflict",
]);
export const mobileErrorSchema = z.strictObject({
  ...base,
  kind: z.literal("error"),
  error: z.strictObject({ code: mobileErrorCodeSchema }),
  requestId: z.uuid(),
});
export const mobileResponseSchema = z.union([
  mobileIntentSchema,
  mobileSessionSchema,
  mobileAccountSchema,
  mobileOrdersSchema,
  mobileServicesSchema,
  mobileLogoutSchema,
  mobileErrorSchema,
]);

export type MobileVariant = z.infer<typeof mobileVariantSchema>;
export type MobileIntentRequest = z.infer<typeof mobileIntentRequestSchema>;
export type MobileExchangeRequest = z.infer<typeof mobileExchangeRequestSchema>;
export type MobileSession = z.infer<typeof mobileSessionSchema>;
export type MobileAccount = z.infer<typeof mobileAccountSchema>;
export type MobileOrders = z.infer<typeof mobileOrdersSchema>;
export type MobileServices = z.infer<typeof mobileServicesSchema>;
export type MobileErrorCode = z.infer<typeof mobileErrorCodeSchema>;
export type MobileResponse = z.infer<typeof mobileResponseSchema>;
