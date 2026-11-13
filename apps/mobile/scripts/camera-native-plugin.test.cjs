/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS Expo config plugin / native-source tests. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const plugin = require("../plugins/withNorthsideBarcodeCamera.cjs");

const sourceRoot = fs.realpathSync(process.env.NORTHSIDE_EXPO_CAMERA_SOURCE || path.dirname(
  require.resolve("expo-camera/package.json", { paths: [process.cwd(), path.join(process.cwd(), "apps/mobile")] }),
));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "northside-camera-proposal-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const camera = path.join(root, "node_modules/expo-camera");
  fs.mkdirSync(camera, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    private: true,
    expo: { autolinking: { ios: { buildFromSource: ["expo-camera"] } } },
  }));
  fs.copyFileSync(path.join(sourceRoot, "package.json"), path.join(camera, "package.json"));
  for (const patch of plugin.PATCHES) {
    const content = fs.readFileSync(path.join(sourceRoot, patch.file));
    assert.equal(digest(content), patch.originalSha256, `Test requires the exact unmodified Expo Camera 58.0.14 source: ${patch.file}`);
    const target = path.join(camera, patch.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(path.join(root, plugin.SCRATCH_MARKER), plugin.SCRATCH_CONTENT);
  return { root, camera, env: { NORTHSIDE_CAMERA_SCRATCH_ROOT: root } };
}
function assertOriginal(camera) {
  for (const patch of plugin.PATCHES) {
    assert.equal(digest(fs.readFileSync(path.join(camera, patch.file))), patch.originalSha256);
  }
}

test("patches the exact installed native implementation and is idempotent", (t) => {
  const { root, camera, env } = fixture(t);
  assert.deepEqual(plugin.patchProject(root, env), { version: "58.0.14", filesPatched: 4 });
  for (const patch of plugin.PATCHES) {
    assert.equal(digest(fs.readFileSync(path.join(camera, patch.file))), patch.patchedSha256);
  }
  assert.deepEqual(plugin.patchProject(root, env), { version: "58.0.14", filesPatched: 0 });
});

test("a changed final source file aborts before any other file is written", (t) => {
  const { root, camera, env } = fixture(t);
  const final = plugin.PATCHES.at(-1);
  fs.appendFileSync(path.join(camera, final.file), "\n// unreviewed dependency change\n");
  assert.throws(() => plugin.patchProject(root, env), /Unexpected.*source hash/);
  for (const patch of plugin.PATCHES.slice(0, -1)) {
    assert.equal(digest(fs.readFileSync(path.join(camera, patch.file))), patch.originalSha256);
  }
});

test("rejects unsupported package versions", (t) => {
  const { root, camera, env } = fixture(t);
  fs.writeFileSync(path.join(camera, "package.json"), '{"version":"58.0.15"}');
  assert.throws(() => plugin.patchProject(root, env), /exactly expo-camera 58\.0\.14/);
  assertOriginal(camera);
});

test("requires the supported source-build opt-in", (t) => {
  const { root, camera, env } = fixture(t);
  fs.writeFileSync(path.join(root, "package.json"), '{"private":true}');
  assert.throws(() => plugin.patchProject(root, env), /buildFromSource/);
  assertOriginal(camera);
});

test("refuses ordinary local prebuilds without explicit isolated-scratch opt-in", (t) => {
  const { root, camera } = fixture(t);
  assert.throws(() => plugin.patchProject(root, {}), /explicitly marked isolated/);
  assertOriginal(camera);
});

test("refuses a dependency link to another workspace", (t) => {
  const shared = fixture(t);
  const local = fixture(t);
  fs.rmSync(local.camera, { force: true, recursive: true });
  fs.symlinkSync(shared.camera, local.camera, "dir");
  assert.throws(() => plugin.patchProject(local.root, local.env), /shared installations are forbidden/);
  assertOriginal(shared.camera);
});

test("the EAS worker guard requires an actual build id and enclosing working directory", (t) => {
  const { root, camera } = fixture(t);
  fs.unlinkSync(path.join(root, plugin.SCRATCH_MARKER));
  assert.throws(() => plugin.patchProject(root, { EAS_BUILD: "true" }), /explicitly marked isolated/);
  assertOriginal(camera);
  assert.equal(plugin.patchProject(root, {
    EAS_BUILD: "true",
    EAS_BUILD_ID: "f51831f0-ea30-406a-8c5f-f8e1cc57d39c",
    EAS_BUILD_WORKINGDIR: root,
  }).filesPatched, 4);
});

test("atomic replacement preserves any shared package-store hard link", (t) => {
  const { root, camera, env } = fixture(t);
  const source = path.join(camera, plugin.PATCHES[0].file);
  const storeFile = path.join(root, "unmodified-package-store-copy.swift");
  fs.linkSync(source, storeFile);
  assert.equal(fs.statSync(source).nlink, 2);
  plugin.patchProject(root, env);
  assert.equal(digest(fs.readFileSync(storeFile)), plugin.PATCHES[0].originalSha256);
  assert.equal(digest(fs.readFileSync(source)), plugin.PATCHES[0].patchedSha256);
});

test("refuses tampered already-patched source instead of silently accepting a marker", (t) => {
  const { root, camera, env } = fixture(t);
  plugin.patchProject(root, env);
  fs.appendFileSync(path.join(camera, plugin.PATCHES[0].file), "\n// changed after patch\n");
  assert.throws(() => plugin.patchProject(root, env), /Unexpected.*source hash/);
});

test("the modified Swift files parse (syntax check only, not an iOS compile)", (t) => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift toolchain is unavailable");
  const { root, camera, env } = fixture(t);
  plugin.patchProject(root, env);
  for (const patch of plugin.PATCHES) {
    const result = spawnSync(compiler.stdout.trim(), ["-frontend", "-parse", path.join(camera, patch.file)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});
