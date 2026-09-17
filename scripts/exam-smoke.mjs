import assert from "node:assert/strict";
const origin = new URL(process.env.SMOKE_ORIGIN || "http://127.0.0.1:3001");
if (
  origin.hostname !== "127.0.0.1" ||
  origin.protocol !== "http:" ||
  origin.pathname !== "/" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
)
  throw Error("Exam rejection checks are loopback-only.");
const card = "00000000-0000-4000-8000-000000000001";
let count = 0;
for (const [path, method, expected, requestOrigin] of [
  [`/api/preview/grading/exam?card=${card}&actor=staff`, "GET", 404],
  [`/api/preview/grading/exam?card=${card}&actor=staff`, "POST", 404],
  [`/api/preview/grading/exam?card=${card}&actor=staff`, "PUT", 404],
  [`/api/private/grading/exam?card=${card}`, "GET", 401],
  [`/api/private/grading/exam?card=${card}&photo=${card}`, "GET", 401],
  [`/api/private/grading/exam?card=${card}&report=${card}`, "GET", 401],
  [
    `/api/private/grading/exam?card=${card}`,
    "POST",
    403,
    "https://foreign.invalid",
  ],
  [
    `/api/private/grading/exam?card=${card}&photo=${card}`,
    "PUT",
    403,
    "https://foreign.invalid",
  ],
]) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: { origin: requestOrigin || origin.origin },
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  count++;
}
console.log(
  `PASS ${count} exam production checks: fixture denial, authenticated photos/reports, same-origin writes, no-store.`,
);
