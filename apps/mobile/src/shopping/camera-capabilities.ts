import { requireOptionalNativeModule } from "expo";
import { findNodeHandle, Platform } from "react-native";
import type { CameraView } from "expo-camera";

export type CameraCapabilities = {
  minZoomFactor: number;
  maxZoomFactor: number;
  maxAvailableZoomFactor: number;
  currentZoomFactor: number;
  actualFormatWidth: number;
  actualFormatHeight: number;
  deviceType: string;
  hasTorch: boolean;
  isTorchAvailable: boolean;
  continuousAutoFocusSupported: boolean;
  continuousAutoExposureSupported: boolean;
  visibleRegion: { x: number; y: number; width: number; height: number };
};

export function cameraCapabilities(value: unknown): CameraCapabilities {
  if (!value || typeof value !== "object")
    throw Error("camera_setup_unavailable");
  const v = value as Record<string, unknown>;
  const numbers = [
    "minZoomFactor",
    "maxZoomFactor",
    "maxAvailableZoomFactor",
    "currentZoomFactor",
    "actualFormatWidth",
    "actualFormatHeight",
  ] as const;
  if (
    numbers.some(
      (key) =>
        typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] <= 0,
    ) ||
    typeof v.deviceType !== "string" ||
    !v.deviceType ||
    [
      "hasTorch",
      "isTorchAvailable",
      "continuousAutoFocusSupported",
      "continuousAutoExposureSupported",
    ].some((key) => typeof v[key] !== "boolean")
  )
    throw Error("camera_setup_unavailable");
  const result = v as CameraCapabilities;
  const region = result.visibleRegion;
  if (
    !region ||
    [region.x, region.y, region.width, region.height].some(
      (n) => !Number.isFinite(n),
    ) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1.000001 ||
    region.y + region.height > 1.000001
  )
    throw Error("camera_setup_unavailable");
  if (
    result.maxZoomFactor < result.minZoomFactor ||
    result.maxAvailableZoomFactor < result.minZoomFactor
  )
    throw Error("camera_setup_unavailable");
  return result;
}

/** Expo 58 iOS uses factor = min * (formatMax/min)^zoom, NOT linear zoom. */
export function nativeZoom(
  relative: number,
  caps: CameraCapabilities | null,
): number | null {
  if (!caps || !Number.isFinite(relative) || relative < 1) return null;
  const factor = caps.minZoomFactor * relative;
  if (factor > Math.min(caps.maxZoomFactor, caps.maxAvailableZoomFactor) + 1e-6)
    return null;
  if (relative === 1) return 0;
  if (caps.maxZoomFactor === caps.minZoomFactor) return null;
  return Math.max(
    0,
    Math.min(
      1,
      Math.log(relative) / Math.log(caps.maxZoomFactor / caps.minZoomFactor),
    ),
  );
}

/** Explicit Northside native extension; stock expo-camera does not expose this range. */
export async function prepareBarcodeCamera(
  view: CameraView,
): Promise<CameraCapabilities> {
  const cameraModule = requireOptionalNativeModule<{
    northsidePrepareBarcodeCameraAsync?: (tag: number) => Promise<unknown>;
  }>("ExpoCamera");
  const tag = findNodeHandle(view);
  if (
    Platform.OS !== "ios" ||
    typeof tag !== "number" ||
    !cameraModule?.northsidePrepareBarcodeCameraAsync
  )
    throw Error("camera_setup_unavailable");
  return cameraCapabilities(
    await cameraModule.northsidePrepareBarcodeCameraAsync(tag),
  );
}
