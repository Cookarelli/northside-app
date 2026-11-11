/** Integer USD cents, half-up to the cent. Buyer premium is never an input. */
export function consignmentPayoutCents(hammerCents: number, totalBps: number) {
  if (
    !Number.isSafeInteger(hammerCents) ||
    hammerCents < 0 ||
    !Number.isInteger(totalBps) ||
    totalBps < 0 ||
    totalBps > 20000
  )
    throw new Error("Invalid hammer amount or total basis points");
  const amount =
    (BigInt(hammerCents) * BigInt(totalBps) + BigInt(5000)) / BigInt(10000);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Payout exceeds exact currency range");
  return Number(amount);
}
