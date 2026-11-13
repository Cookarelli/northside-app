import { barcodeCandidates } from "../../../../packages/customer-contracts/src/native-scan";
import { MobileFailure } from "../api/client";

/** The old preview backend accepts the exact canonical Shopify barcode.
 * Decoded input stays separate; never send expanded UPC-E as UPC-E. */
export function verifiedScanAddInput(
  raw: string,
  format: string | undefined,
  barcode: string | null,
) {
  if (
    !barcode ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._$%+\/-]{0,63}$/.test(barcode) ||
    !barcodeCandidates(raw, format).includes(barcode)
  )
    throw new MobileFailure("missing_or_unverified_variant");
  return { code: barcode, format: "code128" as const };
}
