import { describe, expect, it } from "@jest/globals";
import { createAppConfig } from "../config/app";
import profiles from "../eas.json";

const host =
  "northside-customer-pilot-native-api-steves-projects-e37a4ef4.vercel.app";
const preview = profiles.build.preview;
const rc = profiles.build["internal-rc"];
const source = { ...rc.env, ...rc.ios.env };
const built = { ...source, EAS_BUILD: "true", EAS_BUILD_PLATFORM: "ios" };

describe("integrated internal iOS release candidate", () => {
  it("keeps existing preview distinct and resolves inherited RC settings into build11 and the exact native target", () => {
    expect(rc.extends).toBe("base");
    expect(rc.distribution).toBe("internal");
    expect(rc.environment).toBe("preview");
    expect(rc.ios.simulator).toBe(false);
    expect(rc.ios.developmentClient).toBe(false);
    expect("MOBILE_PREVIEW_COMMERCE_API_ORIGIN" in source).toBe(false);
    expect(preview.distribution).toBe("internal");
    expect(preview.ios.simulator).toBe(false);
    expect(preview.ios.developmentClient).toBe(false);
    const c = createAppConfig(built);
    expect(c.ios?.buildNumber).toBe("11");
    expect(c.ios?.bundleIdentifier).toBe(
      "com.northsidecollectibles.customer.preview",
    );
    expect(c.ios?.appleTeamId).toBe("NF42JBZCBW");
    expect(c.scheme).toBe("northside-collectibles-preview");
    expect(c.owner).toBe("northside-collectibles");
    expect(c.extra?.eas.projectId).toBe("ecfde92e-a01e-4158-b0ce-13908afa39ab");
    expect(c.extra?.mobile.apiOrigin).toBe(`https://${host}`);
    expect(c.extra?.mobile.authReturnUri).toBe(
      "northside-collectibles-preview://auth/return",
    );
    expect(c.extra?.mobile.releaseCandidate).toBe(true);
    expect(c.extra?.mobile.publicCatalogPreview).toBeUndefined();
    expect(c.extra?.mobile.scanCart).toBeUndefined();
    expect(c.extra?.mobile.commerceApiOrigin).toBeUndefined();
    expect(c.extra?.mobile.servicesConnected).toBe(false);
    expect(c.updates?.enabled).toBe(false);
    const old = createAppConfig({
      ...preview.env,
      ...preview.ios.env,
      EAS_BUILD: "true",
      EAS_BUILD_PLATFORM: "ios",
    });
    expect(old.ios?.buildNumber).toBe("10");
    expect(old.extra?.mobile.publicCatalogPreview).toBe(true);
    expect(old.extra?.mobile.scanCart).toBe(true);
    expect(old.extra?.mobile.apiOrigin).toBeUndefined();
    expect(old.extra?.mobile.releaseCandidate).toBeUndefined();
  });

  it.each([undefined, "android", "web"])(
    "rejects an EAS RC without explicit physical iOS platform: %s",
    (platform) => {
      expect(() =>
        createAppConfig({ ...built, EAS_BUILD_PLATFORM: platform }),
      ).toThrow();
    },
  );

  it.each([
    { MOBILE_APP_VARIANT: "development" },
    { MOBILE_APP_VARIANT: "production" },
    { MOBILE_PREVIEW_API_ORIGIN: "" },
    { MOBILE_PUBLIC_CATALOG_PREVIEW: "true" },
    { MOBILE_NATIVE_SCAN_CART: "true" },
    { MOBILE_PREVIEW_COMMERCE_API_ORIGIN: "https://other.example.test" },
    { MOBILE_IOS_INTERFACE_PREVIEW: "true" },
    { MOBILE_PRIVATE_CATALOG_PREVIEW: "true" },
    { MOBILE_SCAN_REHEARSAL: "true" },
    { MOBILE_IOS_BUILD_NUMBER: "" },
    { MOBILE_IOS_BUILD_NUMBER: "0" },
    { MOBILE_IOS_BUILD_NUMBER: "11beta" },
    { MOBILE_PREVIEW_APPLE_TEAM_ID: "OTHERTEAM01" },
    { MOBILE_PREVIEW_IOS_BUNDLE_ID: "com.example.other" },
    { MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED: "false" },
  ])("rejects incompatible RC flags or identities %j", (change) => {
    expect(() => createAppConfig({ ...built, ...change })).toThrow();
  });

  it("does not leak server configuration or claim that connected configuration proves service delivery", () => {
    const c = createAppConfig({
      ...built,
      DATABASE_URL: "SAMPLE_SECRET",
      SHOPIFY_CUSTOMER_CLIENT_SECRET: "SAMPLE_SECRET",
      SESSION_ENCRYPTION_KEY: "SAMPLE_SECRET",
    });
    expect(JSON.stringify(c)).not.toContain("SAMPLE_SECRET");
    expect(c.extra?.mobile.servicesConnected).toBe(false);
  });
});
