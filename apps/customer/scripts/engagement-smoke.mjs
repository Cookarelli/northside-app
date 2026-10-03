import assert from "node:assert/strict";
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
let count = 0;
for (const path of [
  "/install",
  "/account/notifications",
  "/staff/engagement",
  "/shows",
  "/signed-out",
]) {
  const r = await fetch(origin + path),
    html = await r.text();
  assert.equal(r.status, 200, path);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  assert.ok(
    !html.includes("SAMPLE Geneva card show") &&
      !html.includes("Sample collector A"),
    path,
  );
  console.log("PASS", path, "production has no fixture records");
  count++;
}
for (const path of [
  "/api/preview/engagement",
  "/api/preview/engagement?public=1",
  "/hobby-key/vendor-interest",
  "/go/SAMPLE_geneva_table_entrance_01",
  "/api/show-qr/SAMPLE_geneva_table_entrance_01",
  "/api/engagement?staff=1",
  "/api/engagement?staff=1&csv=1",
  "/api/engagement",
]) {
  const r = await fetch(origin + path, { redirect: "manual" });
  assert.ok(r.status >= 400, path);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  console.log("PASS", path, "fails closed");
  count++;
}
const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
assert.equal(manifest.display, "standalone");
assert.equal(manifest.icons.length, 3);
for (const size of [180, 192, 512]) {
  const r = await fetch(origin + `/pwa/icon-${size}.png`),
    b = new Uint8Array(await r.arrayBuffer());
  assert.equal(r.status, 200);
  assert.deepEqual([...b.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  count++;
}
console.log("PASS approved PNG icons");
const offline = await (await fetch(origin + "/pwa/offline.html")).text();
assert.match(offline, /offline/i);
assert.ok(!offline.includes("/api/") && !offline.includes("customer_id"));
count++;
const sw = await fetch(origin + "/sw.js");
assert.equal(sw.status, 200);
assert.match(sw.headers.get("cache-control") || "", /no-store/);
count++;
console.log(`${count} Prompt 9 production checks passed`);
