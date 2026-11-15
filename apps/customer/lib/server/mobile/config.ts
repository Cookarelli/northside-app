import "server-only";
import { AccessError, appOrigin } from "../security";
import {
  NORTHSIDE_NATIVE_API_PREVIEW_HOST,
  nativeCustomerServicesApproved,
} from "../../native-api-ingress";
import { liveOnly } from "../providers";
import type { MobileVariant } from "../../../../../packages/customer-contracts/src/mobile";

export type MobileConfiguration = {
  variant: MobileVariant;
  origin: string;
  returnUri: string;
  callbackUri: string;
};

export function mobileConfiguration(
  variant: MobileVariant,
): MobileConfiguration {
  liveOnly();
  const environment = process.env.NORTHSIDE_MOBILE_ENVIRONMENT;
  if (
    (environment !== "staging" && environment !== "production") ||
    (environment === "production"
      ? variant !== "production"
      : variant === "production")
  ) {
    throw new AccessError(503, "not_configured");
  }
  let origin = appOrigin();
  const nativeOrigin = process.env.NORTHSIDE_MOBILE_AUTH_ORIGIN;
  if (nativeOrigin) {
    if (
      environment !== "staging" ||
      variant !== "preview" ||
      !nativeCustomerServicesApproved(process.env) ||
      process.env.NORTHSIDE_NATIVE_API_HOST !==
        NORTHSIDE_NATIVE_API_PREVIEW_HOST ||
      nativeOrigin !== `https://${NORTHSIDE_NATIVE_API_PREVIEW_HOST}`
    )
      throw new AccessError(503, "not_configured");
    origin = nativeOrigin;
  }
  const value =
    process.env[`NORTHSIDE_MOBILE_${variant.toUpperCase()}_RETURN_URI`];
  if (!value) throw new AccessError(503, "not_configured");
  try {
    const uri = new URL(value);
    if (
      uri.href !== value ||
      uri.username ||
      uri.password ||
      uri.port ||
      uri.search ||
      uri.hash ||
      (uri.protocol === "https:"
        ? uri.pathname !== "/mobile/auth/return"
        : !/^[a-z][a-z0-9+.-]{2,80}:$/.test(uri.protocol) ||
          ["http:", "javascript:", "data:", "file:", "ftp:"].includes(
            uri.protocol,
          ) ||
          uri.hostname !== "auth" ||
          uri.pathname !== "/return")
    )
      throw Error();
    return {
      variant,
      origin,
      returnUri: value,
      callbackUri: `${origin}/api/mobile/v1/auth/callback`,
    };
  } catch {
    throw new AccessError(503, "not_configured");
  }
}
