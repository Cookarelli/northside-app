/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS Expo config plugin / native-source tests. */
// Deliberately pinned escape hatch for Expo Camera 58.0.14. See README.md.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = "58.0.14";
const SCRATCH_MARKER = ".northside-camera-prebuild-scratch";
const SCRATCH_CONTENT = "Northside isolated camera prebuild scratch\n";

const MODULE_METHOD = String.raw`
    // NORTHSIDE BARCODE CAMERA: only an explicit call opts this view in.
    AsyncFunction("northsidePrepareBarcodeCameraAsync") { (viewTag: Int, promise: Promise) in
      guard let view = self.appContext?.findView(withTag: viewTag, ofType: CameraView.self) else {
        promise.reject("ERR_NORTHSIDE_CAMERA_VIEW", "The barcode camera is no longer mounted.")
        return
      }
      view.northsidePrepareBarcodeCamera(promise: promise)
    }
    .runOnQueue(.main)

`;

const VIEW_METHOD = String.raw`
  // Called on main by the explicit module function. Never wait synchronously for sessionQueue.
  func northsidePrepareBarcodeCamera(promise: Promise) {
    let bounds = previewLayer.bounds
    guard bounds.width > 0, bounds.height > 0 else {
      promise.reject("ERR_NORTHSIDE_CAMERA_LAYOUT", "The barcode camera has no visible preview yet.")
      return
    }
    // Convert the WHOLE visible aspect-fill preview, including its current orientation.
    let region = previewLayer.metadataOutputRectConverted(fromLayerRect: bounds)
      .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    guard !region.isNull, !region.isEmpty,
      region.minX.isFinite, region.minY.isFinite,
      region.width.isFinite, region.height.isFinite else {
      promise.reject("ERR_NORTHSIDE_CAMERA_LAYOUT", "The visible barcode region is not ready.")
      return
    }

    sessionQueue.async { [weak self] in
      guard let self, let scanner = self.barcodeScanner else {
        promise.reject("ERR_NORTHSIDE_CAMERA_VIEW", "The barcode camera is no longer mounted.")
        return
      }
      do {
        var result = try self.sessionManager.northsidePrepareBarcodeCamera()
        try scanner.setNorthsideVisibleRegion(region)
        result["visibleRegion"] = [
          "x": Double(region.origin.x), "y": Double(region.origin.y),
          "width": Double(region.width), "height": Double(region.height)
        ]
        promise.resolve(result)
      } catch {
        promise.reject("ERR_NORTHSIDE_CAMERA_PREPARE", "The barcode camera could not be prepared.")
      }
    }
  }

`;

const SESSION_METHOD = String.raw`
  // All device reads and changes are serialized on the view's existing session queue.
  func northsidePrepareBarcodeCamera() throws -> [String: Any] {
    guard let device = captureDeviceInput?.device, let delegate,
      delegate.presetCamera == .back, delegate.active, session.isRunning else {
      throw NSError(domain: "NorthsideBarcodeCamera", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "The rear camera session is not active."])
    }
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    let focusSupported = device.isFocusModeSupported(.continuousAutoFocus)
    let exposureSupported = device.isExposureModeSupported(.continuousAutoExposure)
    if focusSupported { device.focusMode = .continuousAutoFocus }
    if exposureSupported { device.exposureMode = .continuousAutoExposure }
    let dimensions = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
    return [
      // These are the exact baseline and exponent ceiling used by updateZoom().
      "minZoomFactor": Double(minZoomFactor),
      "maxZoomFactor": Double(device.activeFormat.videoMaxZoomFactor),
      "maxAvailableZoomFactor": Double(device.maxAvailableVideoZoomFactor),
      "currentZoomFactor": Double(device.videoZoomFactor),
      // Capture-format dimensions, NOT a guarantee of decoder processing resolution.
      "actualFormatWidth": Int(dimensions.width),
      "actualFormatHeight": Int(dimensions.height),
      "deviceType": device.deviceType.rawValue,
      "hasTorch": device.hasTorch,
      "isTorchAvailable": device.isTorchAvailable,
      "continuousAutoFocusSupported": focusSupported,
      "continuousAutoExposureSupported": exposureSupported
    ]
  }

`;

const REGION_METHOD = String.raw`
  // Metadata output owns this ROI. Other CameraViews retain their original behavior.
  func setNorthsideVisibleRegion(_ region: CGRect) throws {
    if let provider = barcodeProvider {
      let providerTypes = Set(provider.supportedTypes)
      let requested = settings[BARCODE_TYPES_KEY] ?? []
      if requested.contains(where: { providerTypes.contains($0.rawValue) }) {
        // Provider video frames do not pass through AVCaptureMetadataOutput's ROI.
        throw NSError(domain: "NorthsideBarcodeCamera", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "A separate barcode provider cannot honor this region."])
      }
    }
    northsideVisibleRegion = region
    metadataOutput?.rectOfInterest = region
  }

`;

const PATCHES = [
  {
    file: "ios/CameraViewModule.swift",
    originalSha256: "383e39a5262a31624039055fbd074e3ce5579883cb26eec12c5d2bccfe60f742",
    patchedSha256: "fcfa1644219be1de0861f24d95ece9e8ce8240a445cfe2785edce3a898eaead5",
    replacements: [["    AsyncFunction(\"scanFromURLAsync\")", MODULE_METHOD + "    AsyncFunction(\"scanFromURLAsync\")"]],
  },
  {
    file: "ios/Current/CameraView.swift",
    originalSha256: "9d4625286734f33613008b199a3005af2140f9c29750967cff9a2833dac2e7c7",
    patchedSha256: "6f584dc121b8a1b6a2986f285161659c18c28fd0464af57e29555a12e7954eb2",
    replacements: [["  func getAvailableLenses() -> [LensInfo] {", VIEW_METHOD + "  func getAvailableLenses() -> [LensInfo] {"]],
  },
  {
    file: "ios/Current/CameraSessionManager.swift",
    originalSha256: "88b90aa8fd9063271a7f70f7fe79c64558cbfad2608f80db97a1f40febc67b0b",
    patchedSha256: "e42516b26d559148627e156f3b131464994e3d125206d49cf2ab0849e0d86779",
    replacements: [["  func getAvailableLenses() -> [LensInfo] {", SESSION_METHOD + "  func getAvailableLenses() -> [LensInfo] {"]],
  },
  {
    file: "ios/Current/BarcodeScanner.swift",
    originalSha256: "639357df9c3750561e959bdb47910f4e590498c5588b37a828b7bd23cdc55deb",
    patchedSha256: "11f75f12fd6c44f250fe47609784956b3e05d93a9f754b008f6c64c08bb88f6c",
    replacements: [
      ["  private var metadataOutput: AVCaptureMetadataOutput?", "  private var northsideVisibleRegion: CGRect?\n  private var metadataOutput: AVCaptureMetadataOutput?"],
      ["  func setPreviewLayer(layer: AVCaptureVideoPreviewLayer) {", REGION_METHOD + "  func setPreviewLayer(layer: AVCaptureVideoPreviewLayer) {"],
      ["      let output = AVCaptureMetadataOutput()\n", "      let output = AVCaptureMetadataOutput()\n      if let northsideVisibleRegion { output.rectOfInterest = northsideVisibleRegion }\n"],
    ],
  },
];

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}
function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}
function buildPatchedSource(source, patch) {
  let result = source;
  for (const [before, after] of patch.replacements) {
    if (result.split(before).length !== 2) throw new Error(`Expected one native anchor in ${patch.file}`);
    result = result.replace(before, after);
  }
  return result;
}
function assertIsolatedLocation(projectRoot, packageRoot, env) {
  const dependencyDirectory = path.join(projectRoot, "node_modules");
  // pnpm links can point at ANOTHER workspace: never patch through such links.
  if (!isWithin(packageRoot, dependencyDirectory)) {
    throw new Error("Expo Camera must be installed inside this isolated project's own node_modules; shared installations are forbidden.");
  }
  const cloudRoot = env.EAS_BUILD_WORKINGDIR && fs.realpathSync(env.EAS_BUILD_WORKINGDIR);
  const cloud = env.EAS_BUILD === "true" &&
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(env.EAS_BUILD_ID || "") &&
    cloudRoot && isWithin(projectRoot, cloudRoot);
  const scratch = env.NORTHSIDE_CAMERA_SCRATCH_ROOT &&
    fs.realpathSync(env.NORTHSIDE_CAMERA_SCRATCH_ROOT) === projectRoot &&
    fs.existsSync(path.join(projectRoot, SCRATCH_MARKER)) &&
    fs.readFileSync(path.join(projectRoot, SCRATCH_MARKER), "utf8") === SCRATCH_CONTENT;
  if (!cloud && !scratch) throw new Error("Native patching requires an EAS worker or an explicitly marked isolated prebuild scratch copy.");
}
function patchProject(projectRootInput, env = process.env) {
  const projectRoot = fs.realpathSync(projectRootInput);
  const appPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const autolinking = appPackage.expo?.autolinking;
  const sourceModules = (autolinking?.apple ?? autolinking?.ios)?.buildFromSource;
  if (!Array.isArray(sourceModules) || !sourceModules.includes("expo-camera")) {
    throw new Error('Set package.json expo.autolinking.ios.buildFromSource to include "expo-camera"; precompiled binaries would omit this extension.');
  }
  const packageFile = require.resolve("expo-camera/package.json", { paths: [projectRoot] });
  const packageRoot = fs.realpathSync(path.dirname(packageFile));
  assertIsolatedLocation(projectRoot, packageRoot, env);
  if (JSON.parse(fs.readFileSync(packageFile, "utf8")).version !== VERSION) {
    throw new Error(`Northside camera extension supports exactly expo-camera ${VERSION}.`);
  }
  // Validate every file before ANY write. A dependency update or partial patch fails closed.
  const plan = PATCHES.map((patch) => {
    const file = path.join(packageRoot, patch.file);
    if (fs.lstatSync(file).isSymbolicLink() || !isWithin(fs.realpathSync(file), packageRoot)) {
      throw new Error(`Unsafe native source path: ${patch.file}`);
    }
    const source = fs.readFileSync(file, "utf8");
    const digest = sha256(source);
    if (digest === patch.patchedSha256) return { file, source, changed: false };
    if (digest !== patch.originalSha256) throw new Error(`Unexpected expo-camera ${VERSION} source hash: ${patch.file}`);
    const result = buildPatchedSource(source, patch);
    if (sha256(result) !== patch.patchedSha256) throw new Error(`Native patch hash mismatch: ${patch.file}`);
    return { file, source: result, changed: true };
  });
  for (const entry of plan.filter((entry) => entry.changed)) {
    // Atomic replacement also breaks hard links to package-store files before changing content.
    const temporary = `${entry.file}.northside-${process.pid}.tmp`;
    fs.writeFileSync(temporary, entry.source, { mode: fs.statSync(entry.file).mode, flag: "wx" });
    try { fs.renameSync(temporary, entry.file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { version: VERSION, filesPatched: plan.filter((entry) => entry.changed).length };
}

function withNorthsideBarcodeCamera(config) {
  const { withDangerousMod } = require("expo/config-plugins");
  return withDangerousMod(config, ["ios", async (modConfig) => {
    patchProject(modConfig.modRequest.projectRoot);
    return modConfig;
  }]);
}

module.exports = withNorthsideBarcodeCamera;
module.exports.patchProject = patchProject;
module.exports.PATCHES = PATCHES;
module.exports.buildPatchedSource = buildPatchedSource;
module.exports.SCRATCH_MARKER = SCRATCH_MARKER;
module.exports.SCRATCH_CONTENT = SCRATCH_CONTENT;
