import { describe, expect, it } from "@jest/globals";
import { apiOrigin, createAppConfig } from "../config/app";

describe("public native configuration boundary", () => {
  it("keeps sample scan rehearsal confined to local development and out of EAS builds", () => {
    const local = { MOBILE_SCAN_REHEARSAL: "true", MOBILE_DEVELOPMENT_API_ORIGIN: "http://127.0.0.1:8098" };
    expect(createAppConfig(local).extra?.mobile.scanRehearsal).toBe(true);
    expect(createAppConfig({}).extra?.mobile.scanRehearsal).toBeUndefined();
    for (const env of [{ MOBILE_SCAN_REHEARSAL: "true" }, { ...local, EAS_BUILD: "true" }, { ...local, MOBILE_APP_VARIANT: "preview" }, { ...local, MOBILE_DEVELOPMENT_API_ORIGIN: "https://stage.example.test" }]) expect(() => createAppConfig(env)).toThrow(/rehearsal/);
  });
  it("runs locally without inventing registered production identities or a backend", () => {
    const config = createAppConfig({});
    expect(config.ios?.bundleIdentifier).toBeUndefined();
    expect(config.android?.package).toBeUndefined();
    expect(config.scheme).toBeUndefined();
    expect(config.extra?.mobile.apiOrigin).toBeUndefined();
    expect(config.extra?.mobile.servicesConnected).toBe(false);
    expect(config.extra?.mobile.apiBasePath).toBe("/api/mobile/v1");
  });

  it.each(["development", "preview", "production"])(
    "selects only the %s API origin and identifier",
    (variant) => {
      const config = createAppConfig({
        MOBILE_APP_VARIANT: variant,
        MOBILE_DEVELOPMENT_API_ORIGIN: "http://127.0.0.1:3000",
        MOBILE_PREVIEW_API_ORIGIN: "https://preview.example.test",
        MOBILE_PRODUCTION_API_ORIGIN: "https://production.example.test",
        MOBILE_DEVELOPMENT_IOS_BUNDLE_ID: "com.example.northside.dev",
        MOBILE_PREVIEW_IOS_BUNDLE_ID: "com.example.northside.preview",
        MOBILE_PRODUCTION_IOS_BUNDLE_ID: "com.example.northside.customer",
      });
      const origins = {
        development: "http://127.0.0.1:3000",
        preview: "https://preview.example.test",
        production: "https://production.example.test",
      };
      expect(config.extra?.mobile.apiOrigin).toBe(
        origins[variant as keyof typeof origins],
      );
      expect(config.extra?.mobile.variant).toBe(variant);
    },
  );

  it.each([
    "http://production.example.test",
    "https://user:password@example.test",
    "https://example.test/api",
    "https://example.test?token=private",
    "https://example.test#private",
    "https://localhost",
    "not-a-url",
  ])("rejects unsafe production origin %s", (value) => {
    expect(() => apiOrigin(value, "production")).toThrow();
  });

  it("allows cleartext loopback only for development", () => {
    expect(apiOrigin("http://localhost:3000", "development")).toBe(
      "http://localhost:3000",
    );
    expect(() => apiOrigin("http://localhost:3000", "preview")).toThrow();
    expect(() => apiOrigin("http://192.168.1.5:3000", "development")).toThrow();
  });

  it("does not fall back from missing production origin to development", () => {
    expect(
      createAppConfig({
        MOBILE_APP_VARIANT: "production",
        MOBILE_DEVELOPMENT_API_ORIGIN: "http://localhost:3000",
      }).extra?.mobile.apiOrigin,
    ).toBeUndefined();
  });

  it("rejects accidental variant identity and origin collisions", () => {
    expect(() =>
      createAppConfig({
        MOBILE_DEVELOPMENT_IOS_BUNDLE_ID: "com.example.same",
        MOBILE_PRODUCTION_IOS_BUNDLE_ID: "com.example.same",
      }),
    ).toThrow(/separate identifiers/);
    expect(() =>
      createAppConfig({
        MOBILE_DEVELOPMENT_API_ORIGIN: "https://same.example.test",
        MOBILE_PRODUCTION_API_ORIGIN: "https://same.example.test/",
      }),
    ).toThrow(/separate API origins/);
  });

  it("projects no provider tokens, private identities or unrelated environment data", () => {
    const config = createAppConfig({
      SHOPIFY_ADMIN_TOKEN: "private-token-synthetic",
      DATABASE_URL: "private-db-synthetic",
      EXPO_PUBLIC_ACCIDENTAL_SECRET: "private-public-synthetic",
      CUSTOMER_ID: "private-customer-synthetic",
    });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("synthetic");
    expect(serialized).not.toContain("SHOPIFY");
    expect(serialized).not.toContain("DATABASE");
    expect(config.updates?.enabled).toBe(false);
  });

  it.each([
    { MOBILE_APP_VARIANT: "unknown" },
    { MOBILE_DEVELOPMENT_IOS_BUNDLE_ID: "invalid id" },
    { MOBILE_DEVELOPMENT_ANDROID_PACKAGE: "invalid" },
    { MOBILE_DEVELOPMENT_SCHEME: "https://example.test" },
    { MOBILE_DEVELOPMENT_SCHEME: "javascript" },
    { MOBILE_DEVELOPMENT_SCHEME: "https" },
    { MOBILE_EAS_PROJECT_ID: "made-up" },
  ])("rejects malformed build settings %j", (env) => {
    expect(() => createAppConfig(env)).toThrow();
  });

  it("blocks EAS until approval and actual organization/project inputs are supplied", () => {
    expect(() => createAppConfig({ EAS_BUILD: "true" })).toThrow(
      /requires approved/,
    );
    const settings = {
      EAS_BUILD: "true",
      MOBILE_IDENTIFIERS_APPROVED: "true",
      MOBILE_EXPO_OWNER: "example-company",
      MOBILE_EAS_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
      MOBILE_DEVELOPMENT_IOS_BUNDLE_ID: "com.example.northside.dev",
      MOBILE_DEVELOPMENT_ANDROID_PACKAGE: "com.example.northside.dev",
      MOBILE_DEVELOPMENT_SCHEME: "example-northside-dev",
      MOBILE_DEVELOPMENT_API_ORIGIN: "https://dev.example.test",
    };
    expect(createAppConfig(settings).ios?.bundleIdentifier).toBe(
      "com.example.northside.dev",
    );
    expect(() =>
      createAppConfig({ ...settings, MOBILE_IDENTIFIERS_APPROVED: "false" }),
    ).toThrow();
  });

  it.each(["ios", "android"])(
    "requires the selected %s identifier without inventing another platform registration",
    (platform) => {
      const settings = {
        EAS_BUILD: "true",
        EAS_BUILD_PLATFORM: platform,
        MOBILE_IDENTIFIERS_APPROVED: "true",
        MOBILE_EXPO_OWNER: "example-company",
        MOBILE_EAS_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
        MOBILE_PREVIEW_SCHEME: "example-northside-preview",
        MOBILE_PREVIEW_API_ORIGIN: "https://stage.example.test",
        MOBILE_APP_VARIANT: "preview",
        [platform === "ios"
          ? "MOBILE_PREVIEW_IOS_BUNDLE_ID"
          : "MOBILE_PREVIEW_ANDROID_PACKAGE"]: "com.example.northside.preview",
      };
      const config = createAppConfig(settings);
      expect(config.extra?.mobile.apiOrigin).toBe("https://stage.example.test");
      expect(config.extra?.mobile.interfacePreview).toBeUndefined();
      expect(
        platform === "ios" ? config.android?.package : config.ios?.bundleIdentifier,
      ).toBeUndefined();
      const selectedKey = platform === "ios"
        ? "MOBILE_PREVIEW_IOS_BUNDLE_ID"
        : "MOBILE_PREVIEW_ANDROID_PACKAGE";
      expect(() => createAppConfig({ ...settings, [selectedKey]: undefined })).toThrow(/requires approved/);
      expect(() => createAppConfig({ ...settings, EAS_BUILD_PLATFORM: undefined })).toThrow(/requires approved/);
      expect(() => createAppConfig({ ...settings, EAS_BUILD_PLATFORM: "web" })).toThrow(/Unsupported EAS/);
      for (const key of ["MOBILE_IDENTIFIERS_APPROVED", "MOBILE_PREVIEW_SCHEME", "MOBILE_PREVIEW_API_ORIGIN", "MOBILE_EXPO_OWNER", "MOBILE_EAS_PROJECT_ID"]) {
        expect(() => createAppConfig({ ...settings, [key]: undefined })).toThrow(/requires approved/);
      }
      expect(() => createAppConfig({
        ...settings,
        [platform === "ios" ? "MOBILE_PREVIEW_ANDROID_PACKAGE" : "MOBILE_PREVIEW_IOS_BUNDLE_ID"]: "invalid id",
      })).toThrow(/Invalid mobile application identifier/);
    },
  );

  it("pins supported OS targets and requests camera-only scanning permission", () => {
    const config = createAppConfig({});
    expect(config.plugins).toContainEqual([
      "expo-build-properties",
      {
        ios: { deploymentTarget: "16.4" },
        android: {
          minSdkVersion: 28,
          compileSdkVersion: 37,
          targetSdkVersion: 36,
        },
      },
    ]);
    expect(config.android?.blockedPermissions).not.toContain(
      "android.permission.CAMERA",
    );
    expect(config.plugins).toContainEqual([
      "expo-camera",
      {
        cameraPermission:
          "Allow Northside to scan product barcodes and QR codes. No photos or audio are recorded.",
        recordAudioAndroid: false,
        microphonePermission: false,
      },
    ]);
    expect(config.android?.blockedPermissions).toContain(
      "android.permission.RECORD_AUDIO",
    );
    expect(config.android?.blockedPermissions).toContain(
      "android.permission.READ_EXTERNAL_STORAGE",
    );
    expect(config.android?.blockedPermissions).toContain(
      "android.permission.WRITE_EXTERNAL_STORAGE",
    );
    expect(config.ios?.infoPlist?.NSCameraUsageDescription).toBeUndefined();
  });
});
