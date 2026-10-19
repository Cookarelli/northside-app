// Preview-only, anonymous application checks. No application/provider secrets are read.
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  lstat,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const team = "team_iPL9ti94DMgRhfyzvbgjzZdG";
export const targets = Object.freeze({
  customer: Object.freeze({
    origin:
      "https://northside-customer-pilot-git-in-a7ee5f-steves-projects-e37a4ef4.vercel.app",
    project: "prj_ew70zOV4frVoFmU5nfljsNDoxHbZ",
  }),
  control: Object.freeze({
    origin:
      "https://northside-control-pilot-git-int-d1af17-steves-projects-e37a4ef4.vercel.app",
    project: "prj_Ut3V4rhKyMnfdSHK9LYlg6C9aI0E",
  }),
});
const fail = (code) => {
  throw new Error(code);
};
const maxBytes = 2 * 1024 * 1024;
const productPath = "/shop/zion-slab-case-xl-regular";
export const checks = Object.freeze([
  {
    id: "catalog",
    target: "customer",
    path: "/shop?q=Zion",
    status: 200,
    html: ["Zion Slab Case XL", productPath],
  },
  {
    id: "product",
    target: "customer",
    path: productPath,
    status: 200,
    html: ["Zion Slab Case XL", "Purchases not open yet"],
  },
  ...["me", "cards", "orders", "export"].map((name) => ({
    id: `anonymous-${name}`,
    target: "customer",
    path: `/api/private/${name}`,
    status: 401,
    error: "sign_in_required",
  })),
  {
    id: "cart-disabled",
    target: "customer",
    path: "/api/commerce/cart",
    status: 503,
    error: "purchases_disabled",
  },
  {
    id: "pickup-disabled",
    target: "customer",
    path: "/pickup",
    status: 404,
    html: ["Northside"],
  },
  {
    id: "control-private",
    target: "control",
    path: "/api/control/snapshot",
    status: 401,
    error: "Sign in required",
  },
  // Always invalid: no app client secret, signature or order identifier is supplied.
  {
    id: "webhook-signature",
    target: "customer",
    path: "/api/shopify/webhooks",
    method: "POST",
    body: "{}",
    status: 401,
    error: "invalid_webhook_signature",
  },
]);

export function assess(check, response) {
  const { status, headers, body } = response;
  if (Buffer.byteLength(body) > maxBytes) return "response_too_large";
  if (status !== check.status) return "unexpected_status";
  if (!/no-store/i.test(headers.get("cache-control") || ""))
    return "missing_no_store";
  if (check.error) {
    if (!/^application\/json\b/i.test(headers.get("content-type") || ""))
      return "not_application_json";
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return "invalid_json";
    }
    if (data?.error !== check.error || Object.keys(data).length !== 1)
      return "unexpected_application_error";
  } else {
    if (!/^text\/html\b/i.test(headers.get("content-type") || ""))
      return "not_application_html";
    if (!check.html.every((text) => body.includes(text)))
      return "missing_page_content";
    if (/SAMPLE Geneva card show|DEMO-G101|Sample collector A/.test(body))
      return "fixture_content";
  }
  return null;
}

export function verifyDeployment(data, target) {
  if (
    data.projectId !== target.project ||
    data.target !== null ||
    data.readyState !== "READY" ||
    data.meta?.githubCommitOrg !== "Cookarelli" ||
    data.meta?.githubCommitRepo !== "northside-app" ||
    data.meta?.githubCommitRef !== "integration/supervised-store" ||
    !/^[a-f0-9]{40}$/.test(data.meta?.githubCommitSha || "")
  )
    fail("deployment_identity_mismatch");
  return { id: data.id, commit: data.meta.githubCommitSha };
}

// Subprocess output is bounded and never printed: CLI diagnostics may contain credentials.
export function capture(command, args, cwd, input = "", curlBin) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      ["HOME", "PATH", "TMPDIR", "SystemRoot"]
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    );
    const child = spawn(command, args, {
      cwd,
      env: {
        ...env,
        ...(curlBin
          ? { PATH: `${curlBin}:${env.PATH || "/usr/bin:/bin"}` }
          : {}),
        CI: "1",
        NO_COLOR: "1",
        VERCEL_TELEMETRY_DISABLED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      bytes = 0,
      done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(new Error(error));
      } else resolve(out);
    };
    const timer = setTimeout(() => finish("command_timeout"), 45000);
    child.on("error", () => finish("command_unavailable"));
    child.stdout.on("data", (b) => {
      bytes += b.length;
      if (bytes > maxBytes) finish("response_too_large");
      else out += b.toString();
    });
    child.stderr.on("data", (b) => {
      bytes += b.length;
      if (bytes > maxBytes) finish("response_too_large");
    });
    child.on("close", (code) => finish(code === 0 ? null : "command_failed"));
    child.stdin.on("error", () => finish("command_failed"));
    child.stdin.end(input);
  });
}

export async function createCurlShim(directory) {
  const bin = path.join(directory, "curl-bin");
  await mkdir(bin, { mode: 0o700 });
  // Vercel prepends --url, so a trailing -q cannot suppress ~/.curlrc.
  // Fixed system curl with -q FIRST prevents user config injecting redirects,
  // cookies, trace files or additional credential destinations.
  await writeFile(
    path.join(bin, "curl"),
    '#!/bin/sh\nexec /usr/bin/curl -q "$@"\n',
    { mode: 0o700, flag: "wx" },
  );
  return bin;
}

async function directProbe() {
  const r = await fetch(targets.customer.origin + "/api/shopify/webhooks", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  let bytes = 0;
  const chunks = [];
  for await (const chunk of r.body ?? []) {
    bytes += chunk.length;
    if (bytes > maxBytes) fail("response_too_large");
    chunks.push(chunk);
  }
  return {
    status: r.status,
    headers: r.headers,
    body: Buffer.concat(chunks).toString(),
  };
}

export async function run(cli) {
  if (!cli || !path.isAbsolute(cli) || !cli.endsWith(".js"))
    fail("provide_absolute_vercel_cli_js_path");
  const runtime = path.join(root, ".runtime");
  await mkdir(runtime, { mode: 0o700, recursive: true });
  const stat = await lstat(runtime);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid()
  )
    fail("private_runtime_directory_required");
  const temp = await mkdtemp(path.join(runtime, "pilot-acceptance-"));
  const report = {
    at: new Date().toISOString(),
    scope: "anonymous-preview-and-invalid-webhook-only",
    deployments: {},
    checks: [],
    pending: [
      "Physical QR/camera and customer/staff authenticated journeys are separate manual evidence.",
      "Two-customer and existing-object private Storage isolation require approved test identities and a file.",
      "Real Shopify signed delivery/replay and hosted order processing remain unverified; no worker started.",
      "Purchases, collection, POS and real workers remain disabled; this report cannot authorize launch.",
    ],
  };
  try {
    const curlBin = await createCurlShim(temp);
    const contexts = {};
    for (const [name, target] of Object.entries(targets)) {
      const cwd = path.join(temp, name);
      await mkdir(path.join(cwd, ".vercel"), { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(cwd, ".vercel/project.json"),
        JSON.stringify({ projectId: target.project, orgId: team }),
        { mode: 0o600 },
      );
      const call = (args, input) =>
        capture(
          process.execPath,
          [cli, ...args, "--scope", team],
          cwd,
          input,
          curlBin,
        );
      const inspect = async () =>
        verifyDeployment(
          JSON.parse(
            await call([
              "api",
              `/v13/deployments/${new URL(target.origin).hostname}?teamId=${team}`,
              "--method",
              "GET",
              "--raw",
            ]),
          ),
          target,
        );
      report.deployments[name] = {
        origin: target.origin,
        ...(await inspect()),
      };
      contexts[name] = { cwd, inspect };
    }
    for (const check of checks) {
      const target = targets[check.target],
        context = contexts[check.target];
      const headerFile = path.join(context.cwd, "headers.txt");
      await writeFile(headerFile, "", { mode: 0o600 });
      const args = [
        cli,
        "curl",
        check.path,
        "--deployment",
        target.origin,
        "--scope",
        team,
        "--",
        "--silent",
        "--show-error",
        "--max-time",
        "30",
        "--max-filesize",
        String(maxBytes),
        "--dump-header",
        headerFile,
        "--write-out",
        "\n%{http_code}",
      ];
      if (check.method)
        args.push(
          "--request",
          check.method,
          "--header",
          "Content-Type: application/json",
          "--data-binary",
          "@-",
        );
      try {
        const out = await capture(
          process.execPath,
          args,
          context.cwd,
          check.body,
          curlBin,
        );
        const split = out.lastIndexOf("\n"),
          status = Number(out.slice(split + 1));
        const headers = new Headers();
        const raw = await readFile(headerFile, "utf8");
        const final = raw
          .trim()
          .split(/\r?\n\r?\n/)
          .at(-1);
        for (const line of final.split(/\r?\n/).slice(1)) {
          const colon = line.indexOf(":");
          if (colon > 0)
            headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
        }
        const reason = assess(check, {
          status,
          headers,
          body: out.slice(0, split),
        });
        report.checks.push({
          id: check.id,
          result: reason ? "FAIL" : "PASS",
          status,
          reason,
        });
      } catch {
        report.checks.push({
          id: check.id,
          result: "FAIL",
          reason: "transport_failed_or_limit_exceeded",
        });
      }
    }
    // Shopify has no operator's Vercel login. Probe that distinct ingress once.
    try {
      const response = await directProbe();
      const reason = assess(
        checks.find((c) => c.id === "webhook-signature"),
        response,
      );
      report.checks.push({
        id: "shopify-public-ingress",
        result: reason ? "BLOCKED" : "PASS",
        status: response.status,
        reason: reason
          ? "public_request_did_not_reach_signature_verifier"
          : null,
      });
    } catch {
      report.checks.push({
        id: "shopify-public-ingress",
        result: "BLOCKED",
        reason: "public_ingress_unverified",
      });
    }
    for (const [name, context] of Object.entries(contexts)) {
      const after = await context.inspect();
      if (after.id !== report.deployments[name].id)
        fail("deployment_changed_during_run");
    }
    report.result = report.checks.some((c) => c.result === "FAIL")
      ? "FAIL"
      : report.checks.some((c) => c.result === "BLOCKED")
        ? "BLOCKED"
        : "PASS_LIMITED_SCOPE";
    const reportFile = path.join(temp, "report.json");
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    // Remove potentially sensitive CLI files; retain only the allowlisted report.
    for (const name of Object.keys(targets))
      await rm(path.join(temp, name), { recursive: true, force: true });
    await rm(curlBin, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${reportFile}`);
    return report.result === "FAIL" ? 1 : report.result === "BLOCKED" ? 2 : 0;
  } catch {
    await rm(temp, { recursive: true, force: true });
    fail("acceptance_setup_or_deployment_check_failed");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await run(process.argv[2]);
  } catch {
    console.error(
      "Acceptance could not complete. Check CLI login, exact Preview identity and private runtime permissions. No raw provider diagnostics emitted.",
    );
    process.exitCode = 1;
  }
}
