import { createAppConfig } from "../config/app";
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const variant = process.argv[2] ?? "development";
  const platform = process.argv[3] ?? process.env.EAS_BUILD_PLATFORM;
  const profile = process.argv[4] ?? variant;
  if (
    profile !== variant &&
    !(profile === "internal-rc" && variant === "preview" && platform === "ios")
  )
    throw new Error("The profile must match the variant. Use internal-rc only with preview ios.");
  const eas = JSON.parse(readFileSync(join(process.cwd(), "eas.json"), "utf8"));
  const profileEnvironment = (
    name: string,
    seen = new Set<string>(),
  ): Record<string, string> => {
    const selected = eas.build[name];
    if (!selected || seen.has(name))
      throw new Error("Invalid build profile inheritance.");
    seen.add(name);
    return {
      ...(selected.extends ? profileEnvironment(selected.extends, seen) : {}),
      ...selected.env,
      ...selected.ios?.env,
    };
  };
  const iosProfileEnv: Record<string, string> =
    (variant === "preview" || variant === "production") && platform === "ios"
      ? profileEnvironment(profile)
      : {};
  const config = createAppConfig({
    ...process.env,
    ...iosProfileEnv,
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
