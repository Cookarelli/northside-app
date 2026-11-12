import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { useFocusEffect, useNavigation } from "expo-router";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import {
  AppState,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  Linking,
  Keyboard,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import Constants from "expo-constants";
import {
  currentObservation,
  scanInputSchema,
  type MobileProduct,
} from "@northside/customer-contracts/mvp";
import type { ShoppingAction } from "@northside/customer-contracts/shopping";
import { CustomerScreen as Screen } from "../../components/CustomerScreen";
import { ActionLink, Button, Card } from "../../components/Controls";
import { Icon } from "../../components/Icon";
import { useMvp } from "../../mvp/Provider";
import { storefrontUi as ui } from "../../mvp/Components";
import { useCustomerAuth } from "../../auth/Provider";
import { MobileFailure } from "../../api/client";
import { useShopping } from "../../shopping/Provider";
import { CartView } from "../../shopping/CartView";
import { ScanProduct } from "../../shopping/ScanProduct";
import { shoppingMessage } from "../../shopping/messages";
import { storefront } from "../../theme";

type ScanFormat = Extract<ShoppingAction, { action: "add" }>["format"];
type Observation = { data: MobileProduct; code: string; format?: ScanFormat };
type CameraState =
  "checking" | "running" | "paused" | "denied" | "unavailable" | "web";
type ScanNavigation = ReturnType<typeof useNavigation> & {
  addListener(event: "tabPress", listener: () => void): () => void;
};

export default function ScanScreen() {
  const { api, active } = useMvp();
  const { controller: auth } = useCustomerAuth();
  const { controller: shopping, state: cart } = useShopping();
  const identity = auth.shoppingIdentity();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const navigation = useNavigation<ScanNavigation>();
  const { height } = useWindowDimensions();
  const [view, setView] = useState<"scan" | "cart">("scan");
  const [scanMode, setScanMode] = useState<"shelf" | "box">("shelf");
  const [camera, setCamera] = useState<CameraState>(
    Platform.OS === "web" ? "web" : active ? "checking" : "paused",
  );
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [manual, setManual] = useState(Platform.OS === "web");
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Observation>();
  const [selected, setSelected] = useState<string>();
  const [added, setAdded] = useState(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [result, view]);
  const generation = useRef(0),
    busy = useRef(false),
    permissionBusy = useRef(false),
    ready = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const focusRef = useRef(false),
    activeRef = useRef(active),
    wanted = useRef(false),
    viewRef = useRef(view);
  const permissionRef = useRef(permission),
    requestRef = useRef(requestPermission),
    getRef = useRef(getPermission);
  const resultRef = useRef(result);
  const boundary = useRef({ api, identity });
  const liveBoundary = useRef({ api, identity });
  const restartPermission = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    liveBoundary.current = { api, identity };
    activeRef.current = active;
    viewRef.current = view;
    permissionRef.current = permission;
    requestRef.current = requestPermission;
    getRef.current = getPermission;
    resultRef.current = result;
  }, [
    api,
    identity,
    active,
    view,
    permission,
    requestPermission,
    getPermission,
    result,
  ]);
  const valid = (g: number) =>
    generation.current === g &&
    focusRef.current &&
    activeRef.current &&
    viewRef.current === "scan";
  const pause = useCallback((state: CameraState = "paused") => {
    generation.current++;
    busy.current = false;
    ready.current = false;
    wanted.current = false;
    restartPermission.current = null;
    abort.current?.abort();
    setCamera(Platform.OS === "web" ? "web" : state);
    setPending(false);
    setResult(undefined);
    resultRef.current = undefined;
    setSelected(undefined);
    setAdded(false);
  }, []);
  async function startCamera(automatic = false) {
    if (!focusRef.current || !activeRef.current || viewRef.current !== "scan")
      return;
    if (Platform.OS === "web") {
      setCamera("web");
      return;
    }
    if (permissionBusy.current) {
      restartPermission.current = automatic;
      setCamera("checking");
      return;
    }
    pause();
    wanted.current = true;
    const g = generation.current;
    permissionBusy.current = true;
    setCamera("checking");
    setError(undefined);
    try {
      let value =
        typeof getRef.current === "function"
          ? await getRef.current()
          : permissionRef.current;
      if (!valid(g) || !wanted.current) return;
      if (
        !value?.granted &&
        value?.canAskAgain &&
        (!automatic || value.status === "undetermined")
      ) {
        value = await requestRef.current();
      }
      if (!valid(g) || !wanted.current) return;
      if (!value?.granted) {
        wanted.current = false;
        setCamera("denied");
        return;
      }
      setCameraEpoch(g);
      setCamera("running");
    } catch {
      if (valid(g)) {
        wanted.current = false;
        setCamera("unavailable");
        setError("camera_unavailable");
      }
    } finally {
      permissionBusy.current = false;
      const restart = restartPermission.current;
      restartPermission.current = null;
      if (
        restart !== null &&
        focusRef.current &&
        activeRef.current &&
        viewRef.current === "scan"
      )
        void startRef.current(restart);
    }
  }
  const startRef = useRef(startCamera);
  useLayoutEffect(() => {
    startRef.current = startCamera;
  });
  useFocusEffect(
    useCallback(() => {
      focusRef.current = true;
      setFocused(true);
      viewRef.current = "scan";
      setView("scan");
      void startRef.current(true);
      return () => {
        focusRef.current = false;
        setFocused(false);
        pause();
      };
    }, [pause]),
  );
  useEffect(
    () =>
      navigation.addListener("tabPress", () => {
        if (focusRef.current && activeRef.current) {
          viewRef.current = "scan";
          setView("scan");
          void startRef.current(true);
        }
      }),
    [navigation],
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      activeRef.current = state === "active";
      if (state !== "active") pause();
    });
    return () => sub.remove();
  }, [pause]);
  useEffect(() => {
    if (
      boundary.current.api !== api ||
      boundary.current.identity !== identity
    ) {
      boundary.current = { api, identity };
      pause();
      setCode("");
      setError(undefined);
      if (identity !== "booting" && identity !== "authenticating")
        void startRef.current(true);
    }
  }, [api, identity, pause]);
  useEffect(() => {
    if (permission && !permission.granted && camera === "running")
      // Synchronize a revoked native camera permission; this effect stops the device resource.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      pause("denied");
  }, [permission, camera, pause]);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(
      () => {
        setResult(undefined);
        resultRef.current = undefined;
        setSelected(undefined);
        setAdded(false);
        setError("refresh_required");
      },
      Math.max(0, Date.parse(result.data.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [result]);
  async function lookup(raw: string, format?: string, frame = false) {
    if (
      busy.current ||
      !focusRef.current ||
      !activeRef.current ||
      viewRef.current !== "scan"
    )
      return;
    if (frame && (!ready.current || !wanted.current || resultRef.current))
      return;
    const input = scanInputSchema.safeParse({
      code: frame ? raw : raw.trim(),
      ...(format ? { format } : {}),
    });
    if (!input.success) {
      setError("invalid_request");
      return;
    }
    const g = ++generation.current;
    Keyboard.dismiss();
    busy.current = true;
    ready.current = false;
    wanted.current = false;
    abort.current?.abort();
    abort.current = new AbortController();
    setCamera(Platform.OS === "web" ? "web" : "paused");
    setPending(true);
    setError(undefined);
    setResult(undefined);
    setAdded(false);
    try {
      if (!api) throw new MobileFailure("not_configured");
      const data = await api.scan(
        input.data.code,
        abort.current.signal,
        input.data.format,
      );
      if (!valid(g)) return;
      if (!currentObservation(data))
        throw new MobileFailure("refresh_required");
      if (data.product.publication !== "published")
        throw new MobileFailure("invalid_response");
      const requested = data.product.selectedVariantId;
      if (
        requested &&
        !data.product.variants.nodes.some((v) => v.id === requested)
      )
        throw new MobileFailure("invalid_response");
      const selection =
        requested ??
        (data.product.variants.nodes.length === 1
          ? data.product.variants.nodes[0].id
          : undefined);
      const observation = {
        data,
        code: input.data.code,
        format: input.data.format,
      };
      setResult(observation);
      resultRef.current = observation;
      setSelected(selection);
    } catch (e) {
      if (valid(g))
        setError(e instanceof MobileFailure ? e.code : "service_unavailable");
    } finally {
      if (valid(g)) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  function scanned(event: BarcodeScanningResult) {
    // A shelf's hardware barcode and merchandise QR can be visible together.
    // Filter in JS too so a queued event cannot bypass the native format choice.
    if (
      generation.current === cameraEpoch &&
      (scanMode === "shelf" ? event.type === "qr" : event.type !== "qr")
    )
      void lookup(event.data, event.type, true);
  }
  function nextItem() {
    pause();
    setCode("");
    setError(undefined);
    void startRef.current(false);
  }
  function openCart() {
    pause();
    viewRef.current = "cart";
    setView("cart");
    void shopping.read().catch(() => {});
  }
  async function add() {
    if (
      !focusRef.current ||
      !activeRef.current ||
      viewRef.current !== "scan" ||
      resultRef.current !== result ||
      liveBoundary.current.api !== api ||
      liveBoundary.current.identity !== identity ||
      auth.shoppingIdentity() !== identity
    )
      return;
    if (
      !result ||
      !selected ||
      cart.busy ||
      cart.needsRefresh ||
      cart.cart?.handoff
    )
      return;
    const g = generation.current;
    const variant = result.data.product.variants.nodes.find(
      (v) => v.id === selected,
    );
    if (!variant || !currentObservation(result.data)) {
      setError("refresh_required");
      setResult(undefined);
      resultRef.current = undefined;
      setSelected(undefined);
      return;
    }
    if (
      !result.data.product.availableForSale ||
      !variant.availability.availableForSale ||
      variant.availability.currentlyNotInStock ||
      variant.availability.state === "unavailable"
    ) {
      setError("quantity_unavailable");
      return;
    }
    try {
      const confirmed = await shopping.add(
        result.code,
        selected,
        variant.price.amountCents,
        result.format,
      );
      if (confirmed && valid(g)) setAdded(true);
    } catch (e) {
      if (valid(g)) {
        const value =
          e instanceof MobileFailure ? e.code : "service_unavailable";
        setError(value);
        if (
          [
            "scan_price_changed_review_required",
            "scanned_variant_mismatch",
            "quantity_unavailable",
            "missing_or_unverified_variant",
          ].includes(value)
        ) {
          setResult(undefined);
          resultRef.current = undefined;
          setSelected(undefined);
        }
      }
    }
  }
  const mountedEpoch = cameraEpoch;
  const count =
    cart.cart?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const canAdd =
    cart.status !== "unconfigured" &&
    cart.status !== "paused" &&
    !cart.needsRefresh &&
    !cart.cart?.handoff;
  return (
    <Screen
      scrollRef={scrollRef}
      introSize="minimal"
      eyebrow="In-store shopping"
      title="Start Shopping"
    >
      <View accessibilityRole="tablist" style={ui.row}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: view === "scan" }}
          style={[ui.chip, view === "scan" && ui.selected]}
          onPress={() => {
            viewRef.current = "scan";
            setView("scan");
            nextItem();
          }}
        >
          <Text style={[ui.label, view === "scan" && ui.selectedLabel]}>
            Scan
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: view === "cart" }}
          style={[ui.chip, view === "cart" && ui.selected]}
          onPress={openCart}
        >
          <Text style={[ui.label, view === "cart" && ui.selectedLabel]}>
            Cart{count ? ` (${count})` : ""}
          </Text>
        </Pressable>
      </View>
      {Constants.expoConfig?.extra?.mobile?.scanRehearsal === true && (
        <Text style={styles.rehearsal}>
          LOCAL REHEARSAL · SYNTHETIC TEST ITEMS
        </Text>
      )}
      {view === "cart" ? (
        <CartView
          onScan={() => {
            viewRef.current = "scan";
            setView("scan");
            nextItem();
          }}
        />
      ) : (
        <>
          {Platform.OS !== "web" && (
            <View accessibilityRole="tablist" style={ui.row}>
              {([
                ["shelf", "Shelf QR"],
                ["box", "Box barcode"],
              ] as const).map(([mode, label]) => (
                <Pressable
                  key={mode}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: scanMode === mode }}
                  style={[ui.chip, scanMode === mode && ui.selected]}
                  onPress={() => {
                    if (scanMode !== mode) {
                      setScanMode(mode);
                      nextItem();
                    }
                  }}
                >
                  <Text style={[ui.label, scanMode === mode && ui.selectedLabel]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {!result && (
            <View
              style={[
                styles.camera,
                {
                  height:
                    Platform.OS === "web"
                      ? 220
                      : Math.min(480, Math.max(280, Math.round(height * 0.44))),
                },
              ]}
            >
              {Platform.OS !== "web" &&
              focused &&
              active &&
              camera === "running" ? (
                <>
                  <CameraView
                    key={cameraEpoch}
                    testID="product-camera"
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    mode="picture"
                    barcodeScannerSettings={{
                      barcodeTypes: scanMode === "shelf" ? ["qr"] : [
                        "ean13",
                        "ean8",
                        "upc_a",
                        "upc_e",
                        "code128",
                        "code39",
                      ],
                    }}
                    onCameraReady={() => {
                      if (valid(mountedEpoch) && wanted.current)
                        ready.current = true;
                    }}
                    onMountError={() => {
                      if (valid(mountedEpoch)) {
                        pause("unavailable");
                        setError("camera_unavailable");
                      }
                    }}
                    onBarcodeScanned={scanned}
                  />
                  <View pointerEvents="none" style={styles.viewfinder} />
                  <Text style={styles.cameraHint}>
                    {scanMode === "shelf"
                      ? "Aim at the square QR on the shelf label"
                      : "Aim at the barcode printed on the product box"}
                  </Text>
                </>
              ) : (
                <View style={styles.cameraState}>
                  <Icon
                    name="scan"
                    size={60}
                    color={storefront.colors.electricBlue}
                  />
                  <Text style={styles.cameraTitle}>
                    {Platform.OS === "web"
                      ? "Enter a code to start"
                      : camera === "checking"
                        ? "Opening camera…"
                        : camera === "denied"
                          ? "Allow camera access"
                          : camera === "unavailable"
                            ? "Camera unavailable"
                            : "Camera paused"}
                  </Text>
                  {Platform.OS === "web" ? (
                    <Text style={styles.cameraNote}>
                      WEB PREVIEW · MANUAL LOOKUP
                    </Text>
                  ) : (
                    camera !== "checking" && (
                      <Button
                        appearance="storefront"
                        disabled={pending}
                        label={
                          camera === "denied"
                            ? permission?.canAskAgain === false
                              ? "Open camera settings"
                              : "Allow camera"
                            : "Resume camera"
                        }
                        onPress={() => {
                          if (
                            camera === "denied" &&
                            permission?.canAskAgain === false
                          )
                            void Linking.openSettings().catch(() =>
                              setError("camera_unavailable"),
                            );
                          else void startRef.current(false);
                        }}
                      />
                    )
                  )}
                </View>
              )}
            </View>
          )}
          {pending && (
            <Text accessibilityLiveRegion="polite" style={ui.copy}>
              Finding your item…
            </Text>
          )}
          {error && (
            <Text accessibilityRole="alert" style={ui.copy}>
              {shoppingMessage(error)}
            </Text>
          )}
          {result && (
            <ScanProduct
              data={result.data}
              selected={selected}
              onSelect={(value) => {
                if (!cart.busy) {
                  setSelected(value);
                  setAdded(false);
                }
              }}
              canAdd={canAdd}
              busy={cart.busy}
              added={added}
              onAdd={() => {
                void add();
              }}
              onNext={nextItem}
              unavailableReason={
                cart.needsRefresh
                  ? "Review your items and refresh the list before adding."
                  : cart.cart?.handoff
                    ? "Cancel the counter handoff before adding more items."
                    : undefined
              }
            />
          )}
          {cart.error && !error && (
            <Text accessibilityRole="alert" style={ui.copy}>
              {shoppingMessage(cart.error)}
            </Text>
          )}
          <Button
            appearance="storefront"
            label={
              cart.needsRefresh
                ? "Review items · refresh needed"
                : `Review items (${count})`
            }
            onPress={openCart}
          />
          {Platform.OS !== "web" && camera === "running" && (
            <Button
              appearance="storefront"
              secondary
              label="Pause camera"
              onPress={() => pause()}
            />
          )}
          <View style={styles.secondary}>
            <Button
              appearance="storefront"
              secondary
              label={manual ? "Hide manual entry" : "Enter code manually"}
              onPress={() => {
                if (!manual) pause();
                setManual((value) => !value);
              }}
            />
            <Button
              appearance="storefront"
              secondary
              label="Need help? Ask an associate"
              onPress={() => setHelp((value) => !value)}
            />
          </View>
          {manual && (
            <Card appearance="storefront">
              <Text style={ui.label}>Enter a barcode or Northside QR</Text>
              <TextInput
                accessibilityLabel="Barcode or Northside QR code"
                placeholder="Barcode or Northside QR"
                value={code}
                onChangeText={setCode}
                maxLength={2048}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  void lookup(code);
                }}
                style={ui.input}
              />
              <Button
                appearance="storefront"
                label="Look up code"
                disabled={!code.trim() || pending}
                onPress={() => {
                  void lookup(code);
                }}
              />
            </Card>
          )}
          {help && (
            <Card appearance="storefront">
              <Text style={ui.label}>Ask an associate</Text>
              <Text style={ui.copy}>
                Show your screen to a Northside associate for help with an item
                or shopping list. No photos or audio are saved.
              </Text>
              <ActionLink
                appearance="storefront"
                secondary
                href="/shop"
                label="Go to product search"
              />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  camera: {
    backgroundColor: storefront.colors.hero,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: storefront.colors.inverseDivider,
  },
  cameraState: {
    flex: 1,
    padding: 20,
    gap: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: storefront.displayFamily,
    textTransform: "uppercase",
    color: storefront.colors.white,
    textAlign: "center",
  },
  cameraNote: {
    ...storefront.type.eyebrow,
    color: storefront.colors.inverseAccent,
    textAlign: "center",
  },
  viewfinder: {
    position: "absolute",
    top: "22%",
    bottom: "22%",
    left: "12%",
    right: "12%",
    borderWidth: 2,
    borderColor: storefront.colors.electricBlue,
    borderRadius: 12,
  },
  cameraHint: {
    position: "absolute",
    bottom: 18,
    left: 12,
    right: 12,
    color: storefront.colors.white,
    backgroundColor: "#071526CC",
    padding: 10,
    textAlign: "center",
    fontSize: 14,
  },
  rehearsal: { ...storefront.type.eyebrow, color: storefront.colors.accent },
  secondary: { gap: 8 },
});
