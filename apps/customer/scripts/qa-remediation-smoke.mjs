// Synthetic production regression only. No live provider, checkout, inventory or worker.
import assert from "node:assert/strict";
const origin = new URL(process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001");
assert.ok(
  origin.protocol === "http:" &&
    origin.hostname === "127.0.0.1" &&
    !origin.username &&
    !origin.password &&
    origin.pathname === "/" &&
    !origin.search &&
    !origin.hash,
  "QA remediation assertions require an isolated loopback production build.",
);
let count = 0;
const fixtureDisplay =
  /Baseball hobby box|SAMPLE ARTWORK|\$125\.00|Alex • sample collector|Sample collector A|Add to demo cart|DEMO-G101/;
async function response(path, init = {}) {
  const res = await fetch(origin.origin + path, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  assert.match(res.headers.get("cache-control") || "", /no-store/, path);
  assert.ok(!fixtureDisplay.test(body), `${path}: fixture payload`);
  return { res, body };
}
for (const path of [
  "/shop/sample-baseball",
  "/shop/sample-does-not-exist",
  "/shop/sample-baseball?demo=1&back=https%3A%2F%2Fevil.example%2F&variantsAfter=untrusted",
]) {
  const { res, body } = await response(path, {
    headers: { Cookie: "__Host-ns_session=forged-qa-session" },
  });
  assert.equal(res.status, 404, path);
  assert.match(body, /That page isn.t available/);
  assert.match(body, /name="robots" content="[^"]*noindex/);
  assert.ok(!/<a\b[^>]*href=["'](?:https?:)?\/\/evil\.example/i.test(body));
  assert.ok(
    !body.includes("Loading the collection"),
    "product must not inherit the listing fallback",
  );
  console.log(
    "PASS rejected product document: strict404, no-store, noindex, no fixture payload or unsafe back link",
    path,
  );
  count++;
}
{
  const { res, body } = await response("/shop/sample-baseball", {
    method: "HEAD",
  });
  assert.equal(res.status, 404);
  assert.equal(body, "");
  console.log("PASS rejected product HEAD: strict404, no-store, empty body");
  count++;
}
{
  const { res, body } = await response("/shows");
  assert.equal(res.status, 200);
  assert.match(body, /Show details unavailable/);
  assert.match(body, /We could not load the show list/);
  assert.match(body, /action="\/shows"[^>]*method="[Gg][Ee][Tt]"/);
  assert.ok(!body.includes("No confirmed show details are published yet"));
  assert.ok(!/DATABASE_URL|password=|postgres(?:ql)?:\/\//i.test(body));
  console.log(
    "PASS failed show read: honest unavailable UI, fresh GET retry, no raw configuration",
  );
  count++;
}
{
  const { res } = await response("/cart?inStore=1");
  assert.equal(res.status, 404);
  console.log("PASS public in-store cart remains disabled");
  count++;
}
for (const method of ["GET", "POST", "DELETE"]) {
  const { res, body } = await response("/api/shopping", {
    method,
    ...(method === "POST"
      ? {
          headers: {
            "Content-Type": "application/json",
            Origin: "https://foreign.example",
          },
          body: JSON.stringify({ action: "ready", version: 1, actor: "staff" }),
        }
      : {}),
  });
  assert.equal(res.status, 404);
  assert.deepEqual(JSON.parse(body), { error: "not_found" });
  console.log(
    "PASS shopping gate rejects before payload/actor/provider use",
    method,
  );
  count++;
}
{
  const res = await fetch(origin.origin + "/manifest.webmanifest", {
    signal: AbortSignal.timeout(20000),
  });
  const manifest = await res.json();
  assert.equal(res.status, 200);
  assert.equal(manifest.theme_color, "#071526");
  assert.equal(manifest.background_color.toLowerCase(), "#ffffff");
  assert.equal(manifest.display, "standalone");
  console.log("PASS approved public PWA chrome and standalone contract");
  count++;
}
for (const path of ["/aisles", "/unavailable-qa-page"]) {
  const { res, body } = await response(path);
  assert.equal(res.status, 404);
  // Next's initial404/RSC response need not contain client-computed Shell classes.
  // Assert the wire contract here; verify chrome/color in the rendered browser DOM.
  assert.match(body, /name="robots" content="[^"]*noindex/);
  assert.match(body, /That page isn.t available/);
  console.log(
    "PASS customer unavailable response: strict404, no-store, noindex, no fixture payload",
    path,
  );
  count++;
}
console.log(
  `${count} QA remediation regression cases passed. Synthetic production only; no live provider/device acceptance.`,
);
