import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const root = process.cwd();
if (existsSync(".env.local")) {
  console.log(".env.local already exists; left unchanged.");
  process.exit(0);
}
mkdirSync(".runtime", { recursive: true, mode: 0o700 });
const lines = {
  NORTHSIDE_DB_PATH: resolve(root, ".runtime/northside.sqlite"),
  DATA_MODE: "sqlite",
  COMMERCE_MODE: "fixture",
  NORTHSIDE_FIXTURES: "1",
  CONTROL_ORIGIN: "http://127.0.0.1:3101",
  CUSTOMER_ORIGIN: "http://127.0.0.1:3100",
  OPERATOR_PASSWORD: randomBytes(24).toString("base64url"),
  STAFF_PASSWORD: randomBytes(24).toString("base64url"),
  WORKER_RUNTIME: "simulated",
};
writeFileSync(
  ".env.local",
  Object.entries(lines)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
chmodSync(".env.local", 0o600);
console.log(
  "Created ignored .env.local with random local operator/staff passwords. View it in your editor, never paste it into chat. Start with pnpm dev.",
);
