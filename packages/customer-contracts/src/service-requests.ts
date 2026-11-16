import { z } from "zod";

export const SERVICE_REQUEST_VERSION = "1" as const;
const copy = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const required = (max: number) => copy(max).refine((v) => v.length > 0);
export const requestStates = [
  "new",
  "review",
  "assigned",
  "follow_up",
  "intake",
  "in_progress",
  "completed",
] as const;
const requestItems = z
  .array(
    z.strictObject({
      description: required(500),
      quantity: z.number().int().min(1).max(100000),
    }),
  )
  .min(1)
  .max(100)
  .optional();
const requestPhotos = z
  .array(z.uuid().transform((v) => v.toLowerCase()))
  .max(10)
  .refine(
    (v) => new Set(v).size === v.length,
    "Duplicate photographs are not allowed",
  )
  .optional();
const payloadBytes = (value: unknown) => {
  let size = 0;
  for (const character of JSON.stringify(value)) {
    const point = character.codePointAt(0)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
};
export const storedRequestSchema = z
  .strictObject({
    request_id: z.uuid(),
    claim_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    kind: z.enum(["inquiry", "service_request"]),
    service: z.enum(["grading", "consignment"]),
    contact: z.strictObject({
      name: required(200),
      email: z.email().max(254),
      phone: required(80),
    }),
    details: z.record(z.string(), z.unknown()),
    terms_id: z.uuid().nullable(),
    terms_accepted: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const schema =
      v.kind === "inquiry"
        ? z.strictObject({ question: required(3000) })
        : v.service === "consignment"
          ? z
              .strictObject({
                listing_count: z.number().int().min(1).max(100000),
                items: requestItems,
                photo_ids: requestPhotos,
                delivery_method: z.enum([
                  "already_dropped_off",
                  "shipped",
                  "planning_delivery",
                ]),
                inbound_carrier: copy(200),
                inbound_tracking_number: copy(200),
                instructions: required(3000),
              })
              .refine(
                (d) =>
                  d.delivery_method === "shipped" ||
                  (!d.inbound_carrier && !d.inbound_tracking_number),
                "Shipment details only apply to shipped cards",
              )
          : z.strictObject({
              provider: z.enum(["PSA", "SGC"]),
              items: requestItems,
              photo_ids: requestPhotos,
              service_level_id: z.uuid().nullable(),
              declared_value_cents: z
                .number()
                .int()
                .min(0)
                .max(100000000)
                .nullable(),
              address: z.strictObject({
                line1: required(200),
                line2: copy(200),
                city: required(100),
                region: required(100),
                postal_code: required(32),
                country: required(100),
              }),
              instructions: copy(3000),
            });
    if (payloadBytes(v) > 7500)
      ctx.addIssue({
        code: "custom",
        path: ["details"],
        message:
          "Request details are too long; shorten item descriptions or instructions",
      });
    const parsed = schema.safeParse(v.details);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: "custom",
          path: ["details", ...issue.path],
          message: issue.message,
        });
    if (v.kind === "service_request" && (!v.terms_id || !v.terms_accepted))
      ctx.addIssue({
        code: "custom",
        path: ["terms_accepted"],
        message: "Explicit acceptance of current approved terms is required",
      });
    if (v.kind === "inquiry" && (v.terms_id || v.terms_accepted))
      ctx.addIssue({
        code: "custom",
        path: ["terms_id"],
        message: "Inquiries do not accept service terms",
      });
  })
  .transform((v) =>
    Array.isArray(v.details.photo_ids)
      ? {
          ...v,
          details: {
            ...v.details,
            photo_ids: v.details.photo_ids.map((id) =>
              (id as string).toLowerCase(),
            ),
          },
        }
      : v,
  );
export const maxConsignmentAdvancePercent = 30;

// Preserve the original payload for recovery, including drafts saved by older apps.
export function isRetiredGradingAdvance(input: z.infer<typeof storedRequestSchema>) {
  return input.service === "grading" && input.kind === "inquiry" &&
    typeof input.details.question === "string" &&
    input.details.question.startsWith("Card advance inquiry (grading): ");
}

export const requestSchema = storedRequestSchema.refine(
  (input) => !isRetiredGradingAdvance(input),
  { path: ["details", "question"], message: "Northside Cash advances are available for consigned cards only." },
);
export type ServiceRequestInput = z.infer<typeof requestSchema>;
export type RequestConfig = {
  contractVersion: "1";
  customerScope?: string | null;
  location: {
    address: string;
    receivingPostalCode: null;
    receivingStartsAt: null;
    receivingActive: false;
  };
  terms: {
    id: string;
    service: "grading" | "consignment";
    version: string;
    title: string;
    body: string;
  }[];
  serviceLevels: {
    id: string;
    provider: "PSA" | "SGC";
    name: string;
    declared_value_limit_cents: number | null;
  }[];
};
export type ServiceRequestView = {
  id: string;
  reference: string;
  kind: string;
  service: string;
  source: string;
  submission_id?: string;
  contact: Record<string, string>;
  details: Record<string, unknown>;
  state: string;
  version: number;
  created_at: string;
  updated_at: string;
  staff_owner: string | null;
  follow_up_at: string | null;
  received_at: string | null;
  customer_id: string | null;
  terms_id: string | null;
  terms_version: string | null;
  terms_hash: string | null;
  terms_accepted_at: string | null;
  intake_result: Record<string, unknown> | null;
  history: { state: string; message: string; created_at: string }[];
};
const termSchema = z.object({
  id: z.uuid(),
  service: z.enum(["grading", "consignment"]),
  version: required(80),
  title: required(200),
  body: required(16000),
});
export const requestConfigSchema = z.object({
  contractVersion: z.literal("1"),
  customerScope: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  location: z.object({
    address: required(300),
    receivingPostalCode: z.null(),
    receivingStartsAt: z.null(),
    receivingActive: z.literal(false),
  }),
  terms: z.array(termSchema).max(2),
  serviceLevels: z
    .array(
      z.object({
        id: z.uuid(),
        provider: z.enum(["PSA", "SGC"]),
        name: required(200),
        declared_value_limit_cents: z.number().int().nonnegative().nullable(),
      }),
    )
    .max(200),
});
export const requestReceiptSchema = z.object({
  contractVersion: z.literal("1"),
  id: z.uuid(),
  reference: required(100),
  state: required(40),
  duplicate: z.boolean(),
  next_steps: required(1000),
});
export const requestClaimReceiptSchema = z.object({
  claim_id: z.uuid(),
  pending_staff_verification: z.literal(true),
});
export const requestListSchema = z.object({
  contractVersion: z.literal("1"),
  requests: z
    .array(
      z.object({
        id: z.uuid(),
        reference: required(100),
        kind: z.enum(["inquiry", "service_request"]),
        service: z.enum(["grading", "consignment"]),
        source: required(40),
        submission_id: z.uuid().optional(),
        contact: z.record(z.string(), z.string()),
        details: z.record(z.string(), z.unknown()),
        state: required(40),
        version: z.number().int().positive(),
        created_at: z.iso.datetime(),
        updated_at: z.iso.datetime(),
        staff_owner: z.uuid().nullable(),
        follow_up_at: z.iso.datetime().nullable(),
        received_at: z.iso.datetime().nullable(),
        customer_id: z.uuid().nullable(),
        terms_id: z.uuid().nullable(),
        terms_version: z.string().nullable(),
        terms_hash: z.string().nullable(),
        terms_accepted_at: z.iso.datetime().nullable(),
        intake_result: z.record(z.string(), z.unknown()).nullable(),
        history: z.array(
          z.object({
            state: required(40),
            message: copy(3000),
            created_at: z.iso.datetime(),
          }),
        ),
      }),
    )
    .max(500),
});
