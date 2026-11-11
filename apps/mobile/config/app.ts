import type { ExpoConfig } from "expo/config";

export type AppVariant = "development" | "preview" | "production";
type Environment = Readonly<Record<string, string | undefined>>;
const variants: AppVariant[] = ["development", "preview", "production"];
const bundleId = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){2,}$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function apiOrigin(
  value: string | undefined,
  variant: AppVariant,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local =
      variant === "development" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (variant !== "development" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(
      "Invalid mobile API origin; use a public HTTPS origin without a path or credentials.",
    );
  }
}

/** Explicit public projection. Never spread environment variables into extra. */
export function createAppConfig(env: Environment): ExpoConfig {
  const variant = env.MOBILE_APP_VARIANT ?? "development";
  if (!variants.includes(variant as AppVariant))
    throw new Error("Unknown mobile app variant.");
  const selected = variant as AppVariant;
  const prefix = `MOBILE_${selected.toUpperCase()}`;
  const origin = apiOrigin(env[`${prefix}_API_ORIGIN`], selected);
  const interfacePreview = env.MOBILE_IOS_INTERFACE_PREVIEW === "true";
  const publicCatalogPreview = env.MOBILE_PUBLIC_CATALOG_PREVIEW === "true";
  const scanCart = env.MOBILE_NATIVE_SCAN_CART === "true";
  const commerceOrigin = apiOrigin(
    env[`${prefix}_COMMERCE_API_ORIGIN`],
    selected,
  );
  if (
    (scanCart || commerceOrigin) &&
    (!scanCart ||
      !commerceOrigin ||
      selected !== "preview" ||
      !publicCatalogPreview ||
      origin)
  )
    throw new Error(
      "Native scan/cart requires a separate approved preview commerce origin and public catalog mode.",
    );
  const privateCatalogPreview = env.MOBILE_PRIVATE_CATALOG_PREVIEW === "true";
  if (
    publicCatalogPreview &&
    (selected !== "preview" ||
      origin ||
      interfacePreview ||
      privateCatalogPreview ||
      (env.EAS_BUILD === "true" && env.EAS_BUILD_PLATFORM !== "ios"))
  )
    throw new Error(
      "Public catalog is an isolated preview with no customer API; EAS requires iOS.",
    );
  const scanRehearsal = env.MOBILE_SCAN_REHEARSAL === "true";
  if (
    scanRehearsal &&
    (selected !== "development" ||
      !origin ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) ||
      env.EAS_BUILD === "true")
  )
    throw new Error(
      "Scan rehearsal requires a loopback development API and cannot be built with EAS.",
    );
  if (
    privateCatalogPreview &&
    (selected !== "preview" ||
      origin ||
      interfacePreview ||
      env.EAS_BUILD === "true")
  )
    throw new Error("Private catalog is a disconnected browser preview only.");
  if (
    interfacePreview &&
    (selected !== "preview" || env.EAS_BUILD_PLATFORM !== "ios" || origin)
  )
    throw new Error(
      "Interface preview is iOS preview only and must have no connected API origin.",
    );
  const iosId = env[`${prefix}_IOS_BUNDLE_ID`];
  const appleTeamId = env[`${prefix}_APPLE_TEAM_ID`];
  const androidId = env[`${prefix}_ANDROID_PACKAGE`];
  const scheme = env[`${prefix}_SCHEME`];
  if (appleTeamId && !/^[A-Z0-9]{10}$/.test(appleTeamId))
    throw new Error("Invalid Apple Developer team identifier.");
  for (const id of [iosId, androidId]) {
    if (id && !bundleId.test(id))
      throw new Error("Invalid mobile application identifier.");
  }
  if (
    scheme &&
    (!/^[a-z][a-z0-9+.-]{2,80}$/.test(scheme) ||
      ["http", "https", "javascript", "data", "file", "ftp"].includes(scheme))
  )
    throw new Error("Invalid mobile URL scheme.");
  for (const other of variants.filter((v) => v !== selected)) {
    const otherPrefix = `MOBILE_${other.toUpperCase()}`;
    if (
      (iosId && iosId === env[`${otherPrefix}_IOS_BUNDLE_ID`]) ||
      (androidId && androidId === env[`${otherPrefix}_ANDROID_PACKAGE`]) ||
      (scheme && scheme === env[`${otherPrefix}_SCHEME`])
    ) {
      throw new Error(
        "Mobile variants must use separate identifiers and URL schemes.",
      );
    }
    if (
      origin &&
      env[`${otherPrefix}_API_ORIGIN`] &&
      origin === apiOrigin(env[`${otherPrefix}_API_ORIGIN`], other)
    ) {
      throw new Error("Mobile variants must use separate API origins.");
    }
  }
  const projectId = env.MOBILE_EAS_PROJECT_ID;
  const owner = env.MOBILE_EXPO_OWNER;
  const buildPlatform = env.EAS_BUILD_PLATFORM;
  if (
    env.EAS_BUILD === "true" &&
    buildPlatform &&
    buildPlatform !== "ios" &&
    buildPlatform !== "android"
  )
    throw new Error("Unsupported EAS build platform.");
  if (projectId && !uuid.test(projectId))
    throw new Error("Invalid EAS project identifier.");
  if (owner && !/^[a-z0-9][a-z0-9-]{1,38}$/.test(owner))
    throw new Error("Invalid Expo organization name.");
  if (env.EAS_BUILD === "true" && publicCatalogPreview) {
    if (
      iosId !== "com.northsidecollectibles.customer.preview" ||
      appleTeamId !== "NF42JBZCBW" ||
      scheme !== "northside-collectibles-preview" ||
      owner !== "northside-collectibles" ||
      projectId !== "ecfde92e-a01e-4158-b0ce-13908afa39ab" ||
      env.MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED !== "true"
    )
      throw new Error(
        "Public catalog preview requires the verified Northside iOS team, identifiers and Expo project.",
      );
  } else if (env.EAS_BUILD === "true" && interfacePreview) {
    if (
      !iosId ||
      !scheme ||
      !projectId ||
      !owner ||
      env.MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED !== "true"
    )
      throw new Error(
        "iOS interface preview requires approved iOS identifiers, company Expo owner and project ID.",
      );
  } else if (
    env.EAS_BUILD === "true" &&
    ((buildPlatform !== "android" && !iosId) ||
      (buildPlatform !== "ios" && !androidId) ||
      !scheme ||
      !origin ||
      !projectId ||
      !owner ||
      env.MOBILE_IDENTIFIERS_APPROVED !== "true")
  ) {
    throw new Error(
      "EAS build requires approved variant identifiers, scheme, API origin, company Expo owner and project ID.",
    );
  }
  return {
    name:
      selected === "production"
        ? "Northside Collectibles"
        : `Northside ${selected === "preview" ? "Preview" : "Dev"}`,
    slug: "northside-customer",
    version: "0.1.0",
    orientation: "default",
    userInterfaceStyle: "light",
    icon: "./assets/icon.png",
    ...(scheme ? { scheme } : {}),
    ...(owner ? { owner } : {}),
    ios: {
      supportsTablet: false,
      ...(iosId ? { bundleIdentifier: iosId } : {}),
      ...(appleTeamId ? { appleTeamId } : {}),
      buildNumber: scanCart ? "3" : publicCatalogPreview ? "2" : "1",
    },
    android: {
      ...(androidId ? { package: androidId } : {}),
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#FFFFFF",
      },
      blockedPermissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.READ_CONTACTS",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
      ],
    },
    web: {
      bundler: "metro",
      output: "single",
      name: "Northside Collectibles",
      favicon: "./assets/icon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-camera",
        {
          cameraPermission:
            "Allow Northside to scan product barcodes and QR codes. No photos or audio are recorded.",
          recordAudioAndroid: false,
          microphonePermission: false,
        },
      ],
      [
        "expo-secure-store",
        { configureAndroidBackup: true, faceIDPermission: false },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/splash.png",
          imageWidth: 260,
          resizeMode: "contain",
          backgroundColor: "#FFFFFF",
        },
      ],
      [
        "expo-build-properties",
        {
          ios: { deploymentTarget: "16.4" },
          android: {
            minSdkVersion: 28,
            compileSdkVersion: 37,
            targetSdkVersion: 36,
          },
        },
      ],
    ],
    updates: { enabled: false },
    extra: {
      mobile: {
        variant: selected,
        ...(origin ? { apiOrigin: origin } : {}),
        ...(scheme ? { authReturnUri: `${scheme}://auth/return` } : {}),
        apiBasePath: "/api/mobile/v1",
        catalogContractVersion: "northside.catalog.v1",
        servicesConnected: false,
        ...(publicCatalogPreview ? { publicCatalogPreview: true } : {}),
        ...(scanCart
          ? { scanCart: true, commerceApiOrigin: commerceOrigin }
          : {}),
        ...(interfacePreview ? { interfacePreview: true } : {}),
        ...(privateCatalogPreview ? { privateCatalogPreview: true } : {}),
        ...(scanRehearsal ? { scanRehearsal: true } : {}),
      },
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
}
