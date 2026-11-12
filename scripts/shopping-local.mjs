// Isolated local fixture app. No private .env files, provider credentials,
// dependency installation, checkout, inventory mutations or workers.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
if (process.versions.node.split(".")[0] !== "24")
  throw Error("Use the repository's Node 24 runtime.");
if (process.env.NODE_ENV === "production" || process.env.VERCEL)
  throw Error("Local fixtures are forbidden in production.");
const root = resolve(import.meta.dirname, ".."),
  runtime = join(root, ".runtime/customer-shopping-local"),
  source = join(runtime, "source");
const patched = join(root, ".runtime/launch-implementation-20261029/source");
const dependencies = existsSync(
  join(patched, "apps/customer/node_modules/next/dist/bin/next"),
)
  ? patched
  : root;
for (const directory of ["node_modules", "apps/customer/node_modules"])
  if (!existsSync(join(dependencies, directory)))
    throw Error(
      "Installed workspace dependencies are required; this launcher never installs packages.",
    );
mkdirSync(source, { recursive: true, mode: 0o700 });
const excluded = new Set([
  "node_modules",
  ".git",
  ".next",
  ".runtime",
  "work",
  "outputs",
  "tsconfig.tsbuildinfo",
]);
for (const name of [
  "apps/customer",
  "packages",
  "package.json",
  "tsconfig.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
])
  cpSync(join(root, name), join(source, name), {
    recursive: true,
    filter: (path) =>
      !excluded.has(basename(path)) && !basename(path).startsWith(".env"),
  });
for (const directory of ["node_modules", "apps/customer/node_modules"])
  if (!existsSync(join(source, directory)))
    symlinkSync(join(dependencies, directory), join(source, directory), "dir");
const configPath = join(runtime, "local-only.json");
if (!existsSync(configPath))
  writeFileSync(
    configPath,
    JSON.stringify({
      encryptionKey: randomBytes(32).toString("base64"),
      staffPassword: randomBytes(24).toString("base64url"),
    }),
    { mode: 0o600, flag: "wx" },
  );
const config = JSON.parse(readFileSync(configPath, "utf8"));
const port = Number(process.env.NORTHSIDE_SHOPPING_PORT || 3104);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid local port");
// Fail closed on all outbound provider fetches even if an adapter regresses.
const guard = join(runtime, "local-fetch-only.cjs");
writeFileSync(
  guard,
  `const original = globalThis.fetch; globalThis.fetch = (input, options) => { const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('External network prohibited in shopping rehearsal'); return original(input, options); };\n`,
  { mode: 0o600 },
);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  NORTHSIDE_FIXTURES: "1",
  COMMERCE_MODE: "fixture",
  NORTHSIDE_DATA_SCOPE: "customer",
  DATA_MODE: "sqlite",
  NORTHSIDE_DB_PATH: join(runtime, "shopping.sqlite"),
  CUSTOMER_ORIGIN: `http://127.0.0.1:${port}`,
  STAFF_PASSWORD: config.staffPassword,
  SESSION_ENCRYPTION_KEY: config.encryptionKey,
  NODE_OPTIONS: `--require=${guard}`,
};
console.log(`Local SAMPLE shopping: http://127.0.0.1:${port}/scan`);
console.log(`Staff handoff: http://127.0.0.1:${port}/staff/store/handoff`);
console.log(
  `Local-only staff password is saved privately in ${configPath}; open in your editor, never paste into chat.`,
);
const child = spawn(
  process.execPath,
  [
    join(source, "apps/customer/node_modules/next/dist/bin/next"),
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: join(source, "apps/customer"), env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
