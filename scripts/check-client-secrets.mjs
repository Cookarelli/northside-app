import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
const names = (await readFile(".env.example", "utf8"))
  .split("\n")
  .map((line) => line.split("=")[0])
  .filter(
    (name) =>
      /^[A-Z_]+$/.test(name) &&
      /DATABASE_URL|SECRET|ACCESS_TOKEN|PRIVATE_TOKEN|ENCRYPTION_KEY|API_KEY|WEB_PUSH_PRIVATE_KEY/.test(
        name,
      ),
  );
const values = names.flatMap((name) =>
  process.env[name] && process.env[name].length >= 16
    ? [process.env[name]]
    : [],
);
let count = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) await walk(path);
    else if (/\.(js|map)$/.test(e.name)) {
      const source = await readFile(path, "utf8");
      assert.ok(
        !names.some((name) => source.includes(name)) &&
          !values.some((value) => source.includes(value)),
        `Server configuration found in client artifact: ${path}; values withheld`,
      );
      count++;
    }
  }
}
await walk(".next/static");
assert.ok(count > 0, "Build before checking client artifacts");
console.log(
  `PASS ${count} client artifacts checked for server configuration names and supplied secret values. Hosting/proxy logs require separate verification.`,
);
