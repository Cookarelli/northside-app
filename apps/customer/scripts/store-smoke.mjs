import assert from "node:assert/strict";
const base = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001";
for (const path of [
  "/scan",
  "/aisles",
  "/pickup",
  "/q/abcdefghijklmnopqrstuvwx",
  "/q/sample/abcdefghijklmnopqrstuvwx",
]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 404, path);
  assert.match(r.headers.get("cache-control"), /no-store/);
  console.log("PASS disabled public store route " + path);
}
for (const feature of ["scanner", "aisles", "pickup"])
  for (const method of ["GET", "POST"]) {
    const r = await fetch(
      base + "/api/store?feature=" + feature + "&actor=staff&sample=1",
      {
        method,
        headers: { origin: base, "Content-Type": "application/json" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                action: "resolve",
                code: "SAMPLE-BOX-BASE",
                enabled: true,
              }),
            }
          : {}),
      },
    );
    assert.equal(r.status, 404);
    assert.match(r.headers.get("cache-control"), /no-store/);
    console.log("PASS disabled public " + feature + " " + method);
  }
for (const method of ["GET", "POST"]) {
  const r = await fetch(base + "/api/preview/store?actor=staff", {
    method,
    headers: { origin: base, "Content-Type": "application/json" },
    ...(method === "POST"
      ? { body: '{"action":"resolve","code":"SAMPLE-BOX-BASE"}' }
      : {}),
  });
  assert.equal(r.status, 404);
  console.log("PASS production store fixture denied " + method);
}
for (const suffix of [
  "",
  "?label=00000000-0000-4000-8000-000000008050&format=png",
]) {
  const r = await fetch(base + "/api/private/store" + suffix);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("cache-control"), /no-store/);
  console.log("PASS private store session required " + suffix);
}
const cross = await fetch(base + "/api/private/store", {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "Content-Type": "application/json",
  },
  body: '{"action":"pickup"}',
});
assert.equal(cross.status, 403);
console.log("PASS cross-origin store writes denied");
const staff = await fetch(base + "/staff/store");
assert.equal(staff.status, 200);
const html = await staff.text();
for (const sample of [
  "SAMPLE basketball",
  "SAMPLE private",
  "SAMPLE workspace — saved locally",
])
  assert.ok(!html.includes(sample));
console.log("PASS production store shell has no fixture records");
const wasm = await fetch(base + "/vendor/zxing-wasm/3.1.4/zxing_reader.wasm");
assert.equal(wasm.status, 200);
assert.equal(
  Buffer.from(await wasm.arrayBuffer())
    .subarray(0, 4)
    .toString("hex"),
  "0061736d",
);
console.log("PASS same-origin scanner WASM is served");
