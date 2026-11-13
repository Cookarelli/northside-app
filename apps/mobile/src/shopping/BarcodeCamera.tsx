import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  nativeZoom,
  prepareBarcodeCamera,
  type CameraCapabilities,
} from "./camera-capabilities";
import { RETAIL_BARCODE_FORMATS } from "./barcode-scanner";
import { storefront } from "../theme";

const settings = { barcodeTypes: [...RETAIL_BARCODE_FORMATS] };
const mainRearLens = "AVCaptureDeviceTypeBuiltInWideAngleCamera";

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("camera_setup_unavailable")),
          2500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Inline capture UI. Re-mounting this component releases camera/torch and resets zoom. */
export function BarcodeCamera({
  frameStyle,
  onLayout,
  onReady,
  onError,
  onBarcodeScanned,
}: {
  frameStyle: StyleProp<ViewStyle>;
  onLayout: (event: LayoutChangeEvent) => void;
  onReady: () => void;
  onError: (code: string) => void;
  onBarcodeScanned: (event: BarcodeScanningResult) => void;
}) {
  const camera = useRef<CameraView>(null);
  const alive = useRef(true),
    revision = useRef(0),
    ready = useRef(false);
  const setup = useRef(0),
    lensDiscoveryDone = useRef(false);
  const nativeReady = useRef<number | null>(null);
  const errorRef = useRef(onError);
  useLayoutEffect(() => {
    errorRef.current = onError;
  });
  const [session, setSession] = useState(0);
  const [lens, setLens] = useState<string>();
  const [caps, setCaps] = useState<CameraCapabilities | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  useEffect(() => {
    alive.current = true;
    revision.current = 0;
    return () => {
      alive.current = false;
      ready.current = false;
      revision.current++;
      // Epoch counter, not a rendered node: invalidate the latest native setup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setup.current++;
    };
  }, []);

  useEffect(() => {
    const epoch = session;
    const timer = setTimeout(() => {
      if (
        alive.current &&
        revision.current === epoch &&
        nativeReady.current !== epoch
      )
        errorRef.current("camera_unavailable");
    }, 10000);
    return () => clearTimeout(timer);
  }, [session]);
  const valid = (epoch: number) => alive.current && revision.current === epoch;
  async function configure(epoch: number, operation: number) {
    const current = () => valid(epoch) && setup.current === operation;
    const view = camera.current;
    if (!view) throw Error("camera_setup_unavailable");
    if (Platform.OS === "ios") {
      if (!lensDiscoveryDone.current && !lens) {
        const lenses = await view.getAvailableLensesAsync();
        if (!current()) return;
        lensDiscoveryDone.current = true;
        const main = lenses.find((item) => item.deviceType === mainRearLens);
        if (main) {
          // New input: re-mount/fence callbacks, rather than accepting old-lens events.
          ready.current = false;
          const next = ++revision.current;
          setLens(main.deviceType);
          setCaps(null);
          setPrepared(false);
          setSession(next);
          return;
        }
      }
      const observed = await prepareBarcodeCamera(view);
      if (!current()) return;
      if (lens && observed.deviceType !== lens)
        throw Error("camera_setup_unavailable");
      setCaps(observed);
      setZoom((current) =>
        nativeZoom(current, observed) === null ? 1 : current,
      );
      setTorch(
        (current) => current && observed.hasTorch && observed.isTorchAvailable,
      );
    }
    if (current()) {
      ready.current = true;
      setPrepared(true);
      onReady();
    }
  }
  function initialize(epoch: number) {
    if (!valid(epoch)) return;
    nativeReady.current = epoch;
    const operation = ++setup.current;
    ready.current = false;
    void bounded(configure(epoch, operation)).catch(() => {
      if (valid(epoch) && setup.current === operation) {
        ready.current = false;
        onError("camera_setup_unavailable");
      }
    });
  }
  function refresh(epoch: number) {
    if (!valid(epoch) || nativeReady.current !== epoch || Platform.OS !== "ios")
      return;
    const operation = ++setup.current;
    ready.current = false;
    setPrepared(false);
    void bounded(configure(epoch, operation)).catch(() => {
      if (valid(epoch) && setup.current === operation) {
        ready.current = false;
        onError("camera_setup_unavailable");
      }
    });
  }
  const value = nativeZoom(zoom, caps) ?? 0;
  return (
    <>
      <View
        style={styles.controls}
        accessibilityRole="toolbar"
        accessibilityLabel="Camera controls"
      >
        {[1, 1.5, 2].map((level) => (
          <Pressable
            key={level}
            accessibilityRole="button"
            accessibilityLabel={`Zoom ${level}×`}
            accessibilityState={{
              selected: zoom === level,
              disabled: !caps || nativeZoom(level, caps) === null,
            }}
            disabled={!caps || nativeZoom(level, caps) === null}
            onPress={() => setZoom(level)}
            style={[
              styles.control,
              zoom === level && styles.selected,
              (!caps || nativeZoom(level, caps) === null) && styles.disabled,
            ]}
          >
            <Text
              style={[styles.label, zoom === level && styles.selectedLabel]}
            >
              {level}×
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={torch ? "Turn torch off" : "Turn torch on"}
          accessibilityState={{
            selected: torch,
            disabled: !caps?.hasTorch || !caps.isTorchAvailable,
          }}
          disabled={!caps?.hasTorch || !caps.isTorchAvailable}
          onPress={() => setTorch((current) => !current)}
          style={[
            styles.control,
            styles.torch,
            torch && styles.selected,
            (!caps?.hasTorch || !caps.isTorchAvailable) && styles.disabled,
          ]}
        >
          <Text style={[styles.label, torch && styles.selectedLabel]}>
            Torch {torch ? "on" : "off"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.guidance}>
        Keep the barcode sharp. If moving closer makes it blurry, move back and
        try 2×.
      </Text>
      <Text style={styles.note}>
        Digital zoom · Torch may cause glare on electronic labels.
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {prepared ? "Ready · Aim at the product barcode" : "Opening camera…"}
      </Text>
      <View
        testID="barcode-camera-frame"
        onLayout={onLayout}
        style={frameStyle}
      >
        <CameraView
          ref={camera}
          key={session}
          testID="product-camera"
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          pictureSize={Platform.OS === "ios" ? "1920x1080" : undefined}
          selectedLens={lens}
          // In Expo Camera 58, 'off' means continuous AF; 'on' focuses once and locks.
          autofocus="off"
          zoom={value}
          enableTorch={torch && !!caps?.hasTorch && caps.isTorchAvailable}
          barcodeScannerSettings={settings}
          onCameraReady={() => initialize(session)}
          onMountError={() => {
            if (valid(session)) {
              ready.current = false;
              onError("camera_unavailable");
            }
          }}
          responsiveOrientationWhenOrientationLocked={Platform.OS === "ios"}
          onResponsiveOrientationChanged={() => refresh(session)}
          onLayout={() => refresh(session)}
          onBarcodeScanned={(event) => {
            if (valid(session) && ready.current) onBarcodeScanned(event);
          }}
        />
        <View
          pointerEvents="none"
          testID="barcode-full-view-guide"
          style={styles.guide}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  control: {
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 9,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: storefront.colors.electricBlue,
    borderRadius: 8,
  },
  selected: { backgroundColor: storefront.colors.hero },
  disabled: { opacity: 0.4 },
  torch: { marginLeft: "auto" },
  label: { color: storefront.colors.hero, fontSize: 14, fontWeight: "700" },
  selectedLabel: { color: storefront.colors.white },
  guidance: { fontSize: 14, lineHeight: 19, color: storefront.colors.hero },
  note: { fontSize: 11, lineHeight: 14, color: storefront.colors.hero },
  status: { fontSize: 12, lineHeight: 16, color: storefront.colors.hero },
  guide: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 2,
    borderColor: storefront.colors.electricBlue,
    borderRadius: 16,
  },
});
