import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (!existsSync(".env.local")) throw new Error("Run pnpm setup:local first.");
process.loadEnvFile(".env.local");
function appEnv(name: string): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "HOME",
    "TMPDIR",
    "SHELL",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "NORTHSIDE_DB_PATH",
    "DATA_MODE",
    "CONTROL_ORIGIN",
    "CUSTOMER_ORIGIN",
  ];
  keys.push(
    ...(name === "customer"
      ? ["STAFF_PASSWORD", "NORTHSIDE_FIXTURES", "COMMERCE_MODE"]
      : ["OPERATOR_PASSWORD"]),
  );
  const env: NodeJS.ProcessEnv = { NORTHSIDE_DATA_SCOPE: name, NODE_ENV: process.env.NODE_ENV ?? "development" };
  for (const key of keys)
    if (process.env[key] !== undefined) env[key] = process.env[key];
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
