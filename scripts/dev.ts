import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (!existsSync(".env.local")) throw new Error("Run pnpm setup:local first.");
process.loadEnvFile(".env.local");
function appEnv(name: string) {
  const env = { ...process.env, NORTHSIDE_DATA_SCOPE: name };
  delete env.WORKER_CREDENTIAL;
  delete env.WORKER_TOKEN;
  if (name === "customer") {
    delete env.OPERATOR_PASSWORD;
  } else {
    for (const key of Object.keys(env))
      if (key === "STAFF_PASSWORD" || key.startsWith("SHOPIFY_"))
        delete env[key];
  }
  return env;
}
const children = ["customer", "control"].map((name) =>
  spawn("pnpm", ["--filter", `@northside/${name}`, "dev"], {
    stdio: "inherit",
    env: appEnv(name),
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
children.forEach((child) => {
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
});
