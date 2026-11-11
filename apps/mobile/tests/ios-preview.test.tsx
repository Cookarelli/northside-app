import { describe, expect, it } from "@jest/globals";
import { createAppConfig } from "../config/app";

const preview = {
  EAS_BUILD: "true",
  EAS_BUILD_PLATFORM: "ios",
  MOBILE_APP_VARIANT: "preview",
  MOBILE_IOS_INTERFACE_PREVIEW: "true",
  MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED: "true",
  MOBILE_PREVIEW_IOS_BUNDLE_ID: "com.northsidecollectibles.customer.preview",
  MOBILE_PREVIEW_APPLE_TEAM_ID: "NF42JBZCBW",
  MOBILE_PREVIEW_SCHEME: "northside-collectibles-preview",
  MOBILE_EXPO_OWNER: "northside-collectibles",
  MOBILE_EAS_PROJECT_ID: "ecfde92e-a01e-4158-b0ce-13908afa39ab",
};

describe("physical iOS interface preview boundary", () => {
  it("builds the real customer interface without inventing a backend or customer data", () => {
    const config = createAppConfig(preview);
    expect(config.ios?.bundleIdentifier).toBe(preview.MOBILE_PREVIEW_IOS_BUNDLE_ID);
    expect(config.ios?.appleTeamId).toBe(preview.MOBILE_PREVIEW_APPLE_TEAM_ID);
    expect(config.scheme).toBe(preview.MOBILE_PREVIEW_SCHEME);
    expect(config.extra?.eas?.projectId).toBe(preview.MOBILE_EAS_PROJECT_ID);
    expect(config.owner).toBe("northside-collectibles");
    expect(config.extra?.mobile.interfacePreview).toBe(true);
    expect(config.extra?.mobile.servicesConnected).toBe(false);
    expect(config.extra?.mobile.apiOrigin).toBeUndefined();
    expect(config.updates?.enabled).toBe(false);
  });

  it.each(["development", "production"])("cannot use interface mode for %s", variant => {
    expect(() => createAppConfig({ ...preview, MOBILE_APP_VARIANT: variant })).toThrow(/iOS preview only/);
  });
  it.each([undefined, "android", "web"])("requires explicit iOS platform, rejecting %s", platform => {
    expect(() => createAppConfig({ ...preview, EAS_BUILD_PLATFORM: platform })).toThrow(/iOS preview only/);
  });
  it("cannot connect any inherited API in interface mode", () => {
    expect(() => createAppConfig({ ...preview, MOBILE_PREVIEW_API_ORIGIN: "https://stage.example.test" })).toThrow(/no connected API/);
  });
  it.each([
    "MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED", "MOBILE_PREVIEW_IOS_BUNDLE_ID",
    "MOBILE_PREVIEW_SCHEME", "MOBILE_EXPO_OWNER", "MOBILE_EAS_PROJECT_ID",
  ])("still requires %s", key => {
    expect(() => createAppConfig({ ...preview, [key]: undefined })).toThrow(/requires approved iOS/);
  });
  it.each(["https", "javascript", "invalid scheme"])("still rejects unsafe scheme %s", scheme => {
    expect(() => createAppConfig({ ...preview, MOBILE_PREVIEW_SCHEME: scheme })).toThrow(/Invalid mobile URL scheme/);
  });
  it("does not broaden the ordinary build guard", () => {
    expect(() => createAppConfig({ ...preview, MOBILE_IOS_INTERFACE_PREVIEW: undefined })).toThrow(/EAS build requires approved/);
  });
  it("excludes server-secret canaries from the preview manifest", () => {
    const config = createAppConfig({ ...preview, SHOPIFY_ADMIN_TOKEN: "SYNTHETIC_SERVER_SECRET", DATABASE_URL: "SYNTHETIC_SERVER_SECRET" });
    expect(JSON.stringify(config)).not.toContain("SYNTHETIC_SERVER_SECRET");
  });
});
