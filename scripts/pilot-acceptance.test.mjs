import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assess,
  checks,
  targets,
  verifyDeployment,
  capture,
  createCurlShim,
} from "./pilot-acceptance.mjs";

test("Vercel-style child curl ignores user config: no injected cookies, redirects or extra URLs", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie });
    res.writeHead(302, { Location: "/follow" });
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const directory = await mkdtemp(path.join(tmpdir(), "northside-curl-test-"));
  const oldHome = process.env.HOME;
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    await writeFile(
      path.join(directory, ".curlrc"),
      `location\nheader = "Cookie: SYNTHETIC_COOKIE"\nurl = "${url}/extra"\n`,
      { mode: 0o600 },
    );
    const bin = await createCurlShim(directory);
    process.env.HOME = directory;
    const script =
      "const {spawnSync}=require('node:child_process');const r=spawnSync('curl',process.argv.slice(1),{encoding:'utf8'});process.stdout.write(r.stdout||'');process.exit(r.status??1)";
    const output = await capture(
      process.execPath,
      [
        "-e",
        script,
        "--",
        "--url",
        url + "/start",
        "--silent",
        "--max-time",
        "3",
        "--write-out",
        "%{http_code}",
      ],
      directory,
      "",
      bin,
    );
    assert.equal(output, "302");
    assert.deepEqual(seen, [{ path: "/start", cookie: undefined }]);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

const denial = checks.find((c) => c.id === "anonymous-me");
const response = (overrides = {}) => ({
  status: 401,
  body: '{"error":"sign_in_required"}',
  headers: new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
  }),
  ...overrides,
});

test("application denials must be exact JSON; platform login and unavailable DB cannot pass", () => {
  assert.equal(assess(denial, response()), null);
  for (const r of [
    response({ status: 503 }),
    response({ status: 302 }),
    response({ body: "<html>Vercel Authentication Required</html>" }),
    response({ body: '{"error":"sign_in_required","data":"private"}' }),
    response({
      headers: new Headers({
        "content-type": "text/html",
        "cache-control": "no-store",
      }),
    }),
    response({
      headers: new Headers({
        "content-type": "application/json",
        "cache-control": "public",
      }),
    }),
    response({ body: "x".repeat(2 * 1024 * 1024 + 1) }),
  ])
    assert.notEqual(assess(denial, r), null);
});
test("catalog must include the approved product and disabled purchase message", () => {
  const check = checks.find((c) => c.id === "product");
  const html = {
    status: 200,
    headers: new Headers({
      "content-type": "text/html",
      "cache-control": "no-store",
    }),
    body: "Zion Slab Case XL Purchases not open yet",
  };
  assert.equal(assess(check, html), null);
  for (const body of [
    "Sign in to Vercel",
    "Zion Slab Case XL",
    html.body + " DEMO-G101",
  ])
    assert.notEqual(assess(check, { ...html, body }), null);
});
test("runner refuses production, different project, branch, repository or incomplete deployment", () => {
  const deployment = {
    id: "dpl_sample",
    projectId: targets.customer.project,
    target: null,
    readyState: "READY",
    meta: {
      githubCommitOrg: "Cookarelli",
      githubCommitRepo: "northside-app",
      githubCommitRef: "integration/supervised-store",
      githubCommitSha: "a".repeat(40),
    },
  };
  assert.equal(verifyDeployment(deployment, targets.customer).id, "dpl_sample");
  for (const change of [
    { target: "production" },
    { projectId: targets.control.project },
    { readyState: "BUILDING" },
    { meta: { ...deployment.meta, githubCommitRef: "main" } },
    { meta: { ...deployment.meta, githubCommitRepo: "elsewhere" } },
  ])
    assert.throws(
      () => verifyDeployment({ ...deployment, ...change }, targets.customer),
      /deployment_identity_mismatch/,
    );
});
test("subprocess failure is sanitized and application secrets are not inherited", async () => {
  process.env.PILOT_TEST_SECRET = "DO_NOT_PRINT_SAMPLE";
  try {
    assert.equal(
      await capture(
        process.execPath,
        [
          "-e",
          "process.stdout.write(String(process.env.PILOT_TEST_SECRET === undefined))",
        ],
        process.cwd(),
      ),
      "true",
    );
    await assert.rejects(
      capture(
        process.execPath,
        ["-e", "process.stderr.write('DO_NOT_PRINT_SAMPLE');process.exit(1)"],
        process.cwd(),
      ),
      { message: "command_failed" },
    );
  } finally {
    delete process.env.PILOT_TEST_SECRET;
  }
});
test("deployed probes never submit a signed event, cart mutation or worker request", () => {
  const writes = checks.filter((c) => c.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/api/shopify/webhooks");
  assert.equal(writes[0].body, "{}");
  assert.equal(writes[0].error, "invalid_webhook_signature");
});
