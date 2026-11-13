import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { CameraView } from "expo-camera";
import {
  cameraCapabilities,
  nativeZoom,
  prepareBarcodeCamera,
} from "../src/shopping/camera-capabilities";

let mockTag: number | null = 12;
const mockPrepare = jest.fn<(tag: number) => Promise<unknown>>();
let mockModule: {
  northsidePrepareBarcodeCameraAsync?: typeof mockPrepare;
} | null;
jest.mock("expo", () => ({ requireOptionalNativeModule: () => mockModule }));
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  findNodeHandle: () => mockTag,
}));
const sample = {
  minZoomFactor: 1,
  maxZoomFactor: 16,
  maxAvailableZoomFactor: 8,
  currentZoomFactor: 1,
  actualFormatWidth: 1920,
  actualFormatHeight: 1080,
  deviceType: "MAIN",
  hasTorch: true,
  isTorchAvailable: true,
  continuousAutoFocusSupported: true,
  continuousAutoExposureSupported: true,
  visibleRegion: { x: 0, y: 0.2, width: 1, height: 0.6 },
};
beforeEach(() => {
  mockTag = 12;
  mockModule = { northsidePrepareBarcodeCameraAsync: mockPrepare };
  mockPrepare.mockResolvedValue(sample);
});

describe("actual camera range and native Expo zoom units", () => {
  it.each([1, 1.5, 2])(
    "converts %sx to the actual exponential range",
    (factor) => {
      const caps = cameraCapabilities(sample),
        zoom = nativeZoom(factor, caps)!;
      expect(
        caps.minZoomFactor *
          Math.pow(caps.maxZoomFactor / caps.minZoomFactor, zoom),
      ).toBeCloseTo(factor);
    },
  );
  it("uses the virtual camera's real wide-lens baseline and the raw format ceiling", () => {
    const caps = cameraCapabilities({
      ...sample,
      minZoomFactor: 2,
      maxZoomFactor: 64,
      maxAvailableZoomFactor: 8,
      currentZoomFactor: 2,
    });
    expect(nativeZoom(2, caps)).toBeCloseTo(Math.log(2) / Math.log(32));
    expect(nativeZoom(2, caps)).not.toBeCloseTo(Math.log(2) / Math.log(4));
  });
  it("disables unsupported targets instead of silently mislabelling a clamped zoom", () => {
    const caps = cameraCapabilities({ ...sample, maxAvailableZoomFactor: 1.6 });
    expect(nativeZoom(1.5, caps)).not.toBeNull();
    expect(nativeZoom(2, caps)).toBeNull();
    expect(nativeZoom(2, null)).toBeNull();
    expect(nativeZoom(NaN, caps)).toBeNull();
  });
  it("supports only 1x on a camera with no zoom range", () => {
    const caps = cameraCapabilities({
      ...sample,
      maxZoomFactor: 1,
      maxAvailableZoomFactor: 1,
    });
    expect(nativeZoom(1, caps)).toBe(0);
    expect(nativeZoom(1.5, caps)).toBeNull();
  });
  it.each([
    null,
    {},
    { ...sample, maxZoomFactor: Infinity },
    { ...sample, minZoomFactor: 0 },
    { ...sample, maxAvailableZoomFactor: 0.5 },
    { ...sample, hasTorch: "true" },
    { ...sample, visibleRegion: { x: 0, y: 0, width: 0, height: 1 } },
    { ...sample, visibleRegion: { x: 0.5, y: 0, width: 1, height: 1 } },
  ])("rejects untrusted or unusable camera capabilities %p", (value) => {
    expect(() => cameraCapabilities(value)).toThrow("camera_setup_unavailable");
  });
  it("calls the explicit native extension with the actual mounted view tag", async () => {
    await expect(prepareBarcodeCamera({} as CameraView)).resolves.toEqual(
      sample,
    );
    expect(mockPrepare).toHaveBeenCalledWith(12);
  });
  it("fails safely on an old binary or unmounted camera", async () => {
    mockModule = {};
    await expect(prepareBarcodeCamera({} as CameraView)).rejects.toThrow(
      "camera_setup_unavailable",
    );
    mockModule = { northsidePrepareBarcodeCameraAsync: mockPrepare };
    mockTag = null;
    await expect(prepareBarcodeCamera({} as CameraView)).rejects.toThrow(
      "camera_setup_unavailable",
    );
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});
