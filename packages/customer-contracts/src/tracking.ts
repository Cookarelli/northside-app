import { z } from "zod";
import { MOBILE_CONTRACT_VERSION } from "./mobile";

export const trackingServiceSchema = z.enum(["grading", "consignment"]);
const stamp = z.iso.datetime({ precision: 3 });
const copy = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
export const serviceTermsSchema = z.strictObject({
  service: trackingServiceSchema,
  current: z
    .strictObject({
      id: z.uuid(),
      version: copy(80).min(1),
      title: copy(200).min(1),
      body: copy(16000).min(1),
      publishedAt: stamp,
    })
    .nullable(),
  acceptedAt: stamp.nullable(),
});
export const trackingSummarySchema = z.strictObject({
  id: z.uuid(),
  cardId: z.uuid(),
  service: trackingServiceSchema,
  title: copy(2000).min(1),
  status: copy(100).min(1),
  receivedDate: z.iso.date().nullable(),
  recordedAt: stamp,
  updatedAt: stamp,
});
export const trackingListSchema = z.strictObject({
  contractVersion: z.literal(MOBILE_CONTRACT_VERSION),
  kind: z.literal("card-tracking"),
  service: trackingServiceSchema,
  cards: z.array(trackingSummarySchema).max(500),
  terms: serviceTermsSchema,
});
export const trackingDetailSchema = z.strictObject({
  contractVersion: z.literal(MOBILE_CONTRACT_VERSION),
  kind: z.literal("card-tracking-detail"),
  card: trackingSummarySchema.extend({
    customerNotes: copy(3000),
    providerCardReference: copy(200).nullable(),
    result: copy(3000).nullable(),
    certificate: copy(200).nullable(),
    history: z
      .array(
        z.strictObject({
          id: z.uuid(),
          label: copy(3000),
          source: copy(100),
          occurredAt: stamp,
        }),
      )
      .max(2000),
    photos: z
      .array(
        z.strictObject({
          id: z.uuid(),
          kind: copy(100),
          format: z.enum(["grading", "file"]),
        }),
      )
      .max(500),
  }),
  terms: serviceTermsSchema,
});
export const termsAcceptanceSchema = z.strictObject({
  service: trackingServiceSchema,
  terms_id: z.uuid(),
  card_id: z.uuid(),
  confirmed: z.literal(true),
});
export type TrackingService = z.infer<typeof trackingServiceSchema>;
export type ServiceTerms = z.infer<typeof serviceTermsSchema>;
export type TrackingList = z.infer<typeof trackingListSchema>;
export type TrackingDetail = z.infer<typeof trackingDetailSchema>;
export type TermsAcceptance = z.infer<typeof termsAcceptanceSchema>;
