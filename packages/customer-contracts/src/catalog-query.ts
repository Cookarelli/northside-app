import { z } from "zod";

const noControls = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const filterText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(noControls)
    .refine((value) => value.trim().length > 0);
const cursor = filterText(1500);

/**
 * V1 browse inputs, matching the existing Storefront Browse field names.
 * q is literal search text; category is Shopify productType, not taxonomy ID.
 * The future server producer must escape filters using its existing adapter.
 */
export const catalogBrowseRequestV1Schema = z
  .strictObject({
    q: filterText(100).optional(),
    category: filterText(80).optional(),
    collection: z
      .string()
      .regex(/^[a-z0-9-]{1,150}$/)
      .optional(),
    after: cursor.optional(),
    collectionsAfter: cursor.optional(),
  })
  .superRefine((input, ctx) => {
    // Existing browse() ignores collection when q is present. Refuse that
    // ambiguous request rather than promise combined collection search.
    if (input.q !== undefined && input.collection !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["collection"],
        message: "search_and_collection_are_mutually_exclusive",
      });
  });

export type CatalogBrowseRequestV1 = z.infer<
  typeof catalogBrowseRequestV1Schema
>;
export type CatalogBrowseValidationResultV1 =
  | { success: true; data: CatalogBrowseRequestV1 }
  | { success: false; error: { code: "invalid_catalog_query" } };

/** No network, query execution, authorization, global clock or input echo. */
export function validateCatalogBrowseRequestV1(
  input: unknown,
): CatalogBrowseValidationResultV1 {
  const result = catalogBrowseRequestV1Schema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: { code: "invalid_catalog_query" } };
}
