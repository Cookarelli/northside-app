import { spawnSync } from "node:child_process";
const origin = new URL(process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001");
if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error(
    "Production rejection suite is loopback-only. Use smoke:staging for remote read-only checks.",
  );
for (const file of [
  "production",
  "auth",
  "commerce",
  "grading",
  "consignment",
  "loyalty",
  "breaks",
  "store",
  "engagement",
]) {
  const result = spawnSync(process.execPath, [`scripts/${file}-smoke.mjs`], {
    stdio: "inherit",
    env: { ...process.env, SMOKE_ORIGIN: origin.origin },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
