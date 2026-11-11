import { createAppConfig } from "../config/app";
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const variant = process.argv[2] ?? "development";
  const platform = process.argv[3] ?? process.env.EAS_BUILD_PLATFORM;
  // Match the approved iOS-only profile; do not relax other platform guards.
  const iosPreviewEnv: Record<string, string> =
    variant === "preview" && platform === "ios"
      ? JSON.parse(readFileSync(join(process.cwd(), "eas.json"), "utf8"))
          .build.preview.ios.env
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
