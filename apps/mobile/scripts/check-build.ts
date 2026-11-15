import { createAppConfig } from "../config/app";
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const variant = process.argv[2] ?? "development";
  const platform = process.argv[3] ?? process.env.EAS_BUILD_PLATFORM;
  const profile = process.argv[4] ?? "preview";
  if (
    !["preview", "internal-rc"].includes(profile) ||
    (profile === "internal-rc" && (variant !== "preview" || platform !== "ios"))
  )
    throw new Error("Use internal-rc only with preview ios.");
  const eas = JSON.parse(readFileSync(join(process.cwd(), "eas.json"), "utf8"));
  const iosPreviewEnv: Record<string, string> =
    variant === "preview" && platform === "ios"
      ? {
          ...eas.build.base.env,
          ...eas.build.preview.env,
          ...eas.build.preview.ios.env,
          ...(profile === "internal-rc"
            ? { ...eas.build[profile].env, ...eas.build[profile].ios.env }
            : {}),
        }
      : {};
  const config = createAppConfig({
    ...process.env,
    ...iosPreviewEnv,
    EAS_BUILD: "true",
    MOBILE_APP_VARIANT: variant,
    ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}),
  });
  console.log(
    `Build configuration ready for ${config.extra?.mobile.variant}. No build was started.`,
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Build configuration is incomplete.",
  );
  process.exitCode = 1;
}
