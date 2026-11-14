import type { RequestConfig } from "./service-requests";

export type GradingRequestLevel = RequestConfig["serviceLevels"][number];
type GradingRequestConfig = { serviceLevels: readonly GradingRequestLevel[] };
export type GradingRequestPreference = {
  provider: "PSA" | "SGC";
  service_level_id: string | null;
  declared_value_cents: number | null;
};
export type GradingRequestSelection =
  | { ok: true; serviceLevel: GradingRequestLevel | null; summary: string }
  | {
      ok: false;
      code:
        | "invalid_declared_value"
        | "service_unavailable"
        | "declared_value_required"
        | "declared_value_exceeded";
      message: string;
    };

/** Config contains only current active services; it is not a fee schedule. */
export function configuredGradingProviders(config: GradingRequestConfig) {
  return [...new Set(config.serviceLevels.map((level) => level.provider))];
}

/** Resolve a preference without implying physical custody, payment or dispatch. */
export function gradingRequestSelection(
  config: GradingRequestConfig,
  preference: GradingRequestPreference,
): GradingRequestSelection {
  const value = preference.declared_value_cents;
  if (
    value !== null &&
    (!Number.isInteger(value) || value < 0 || value > 100000000)
  )
    return {
      ok: false,
      code: "invalid_declared_value",
      message:
        "Declared value must be a nonnegative USD amount with at most two decimal places.",
    };
  if (preference.service_level_id === null)
    return {
      ok: true,
      serviceLevel: null,
      summary:
        "Grading request for staff review. Provider and service are preferences pending confirmation; fees remain unquoted. This request does not record physical receipt, take payment or submit cards to a grader.",
    };
  const level = config.serviceLevels.find(
    (item) =>
      item.id === preference.service_level_id &&
      item.provider === preference.provider,
  );
  if (!level)
    return {
      ok: false,
      code: "service_unavailable",
      message:
        "This grading service is no longer available. Review the current configured services or request staff review.",
    };
  if (level.declared_value_limit_cents !== null && value === null)
    return {
      ok: false,
      code: "declared_value_required",
      message:
        "Enter a declared value to request this configured grading service.",
    };
  if (
    level.declared_value_limit_cents !== null &&
    value !== null &&
    value > level.declared_value_limit_cents
  )
    return {
      ok: false,
      code: "declared_value_exceeded",
      message:
        "The declared value exceeds this service’s configured limit. Choose another configured service or request staff review.",
    };
  return {
    ok: true,
    serviceLevel: level,
    summary: `${level.provider} · ${level.name} requested for staff review. Fees remain unquoted until Northside provides an itemized quote. This request does not record physical receipt, take payment or submit cards to a grader.`,
  };
}
