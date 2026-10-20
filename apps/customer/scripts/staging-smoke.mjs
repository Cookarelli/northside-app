// Anonymous GET requests only. No cookies, redirects, checkout, webhook, login or worker calls.
import assert from "node:assert/strict";
const input = process.argv[2];
if (!input)
  throw Error("Usage: pnpm smoke:staging https://the-selected-staging-origin");
const url = new URL(input);
assert.ok(
  (url.protocol === "https:" ||
    (url.protocol === "http:" && url.hostname === "127.0.0.1")) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash,
  "Supply only the selected HTTPS origin, or loopback for local verification.",
);
let count = 0;
async function check(path, statuses) {
  const res = await fetch(url.origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(
    statuses.includes(res.status),
    `${path}: unexpected ${res.status}; protected deployments need an approved browser test, never treat a sign-in redirect as a pass`,
  );
  assert.match(res.headers.get("cache-control") || "", /no-store/, path);
  const html = await res.text();
  assert.ok(
    !/SAMPLE Geneva card show|DEMO-G101|Sample collector A|Alex • sample collector|SAMPLE Northside card break/.test(
      html,
    ),
    `${path}: fixture records`,
  );
  assert.ok(
    !/https:\/\/(?:www\.)?(?:facebook|instagram)\.com\/(?:example|placeholder|sample)(?:[\s"/]|$)/i.test(
      html,
    ),
    `${path}: placeholder stream`,
  );
  count++;
  console.log("PASS", path, res.status);
  return html;
}
for (const path of [
  "/",
  "/shop",
  "/cart",
  "/breaks",
  "/my-cards",
  "/rewards",
  "/account",
  "/install",
  "/shows",
  "/staff/login",
])
  await check(path, [200]);
for (const path of [
  "/scan",
  "/aisles",
  "/pickup",
  "/q/sample/invalid",
  "/hobby-key/vendor-interest",
  "/go/SAMPLE_geneva_table_entrance_01",
])
  await check(path, path.startsWith("/go/") ? [404, 503] : [404]);
for (const feature of [
  "grading",
  "consignment",
  "loyalty",
  "breaks",
  "store",
  "engagement",
])
  await check(`/api/preview/${feature}`, [404]);
for (const path of [
  "/api/private/grading",
  "/api/private/consignment",
  "/api/private/loyalty",
  "/api/private/store",
  "/api/engagement?staff=1",
])
  await check(path, [401, 503]);
const manifest = JSON.parse(await check("/manifest.webmanifest", [200]));
assert.equal(manifest.display, "standalone");
assert.equal(manifest.icons.length, 3);
await check("/sw.js", [200]);
console.log(
  `${count} read-only release-gate checks passed. No authenticated integration was verified.`,
);
