export function fixturesAllowed(env) {
  return env.NODE_ENV !== "production" && env.NORTHSIDE_FIXTURES === "1";
}
export const publicFlags = Object.freeze({
  purchases: false,
  loyaltyEarning: false,
  loyaltyRedemption: false,
  barcodeScanning: false,
  aisleNavigation: false,
  pickup: false,
});
