import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { useFocusEffect, useNavigation } from "expo-router";
import { useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
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
  type MobileScan,
} from "@northside/customer-contracts/mvp";
import type { ShoppingAction } from "@northside/customer-contracts/shopping";
import { CustomerScreen as Screen } from "../../components/CustomerScreen";
import { ActionLink, Button, Card } from "../../components/Controls";
import { Icon } from "../../components/Icon";
import { useMvp } from "../../mvp/Provider";
import { money, storefrontUi as ui } from "../../mvp/Components";
import { useCustomerAuth } from "../../auth/Provider";
import { MobileFailure } from "../../api/client";
import { useShopping } from "../../shopping/Provider";
import { CartView } from "../../shopping/CartView";
import {
  ScanProduct,
  scannedVariantAvailable,
} from "../../shopping/ScanProduct";
import { shoppingMessage } from "../../shopping/messages";
import { BarcodeCamera } from "../../shopping/BarcodeCamera";
import { storefront } from "../../theme";
import {
  barcodeCandidates,
  isProductBarcode,
  validGtin,
} from "../../../../../packages/customer-contracts/src/native-scan";
import {
  isRetailBarcodeFormat,
  barcodePreviewHeight,
} from "../../shopping/barcode-scanner";
import { verifiedScanAddInput } from "../../shopping/verified-scan";

function scanMessage(error: string) {
  if (error === "camera_setup_unavailable")
    return "Camera controls could not initialize. Retry the camera or install the updated preview. You can enter the barcode manually.";
  if (error === "invalid_request" || error === "unsupported_qr")
    return "Enter a product barcode, up to 255 characters.";
  if (error === "not_found")
    return "Product not found. No active product matches this barcode. Check the product barcode on the ESL display or original box, or ask an associate.";
  if (error === "server_error" || error === "scan_endpoint_unavailable")
    return "The store lookup service returned an error. Retry the barcode lookup or ask an associate.";
  if (error === "rate_limited")
    return "The store is receiving too many requests. Wait a moment, then retry the barcode lookup.";
  if (error === "product_unavailable")
    return "This approved item is currently unavailable in the app. Retry or ask an associate.";
  if (error === "scan_access_denied")
    return "The app could not access the store lookup service. Retry or ask an associate.";
  if (["offline", "timeout", "service_unavailable"].includes(error))
    return "Connection unavailable. Check your connection and retry the barcode lookup.";
  return shoppingMessage(error);
}

type ScanFormat = Extract<ShoppingAction, { action: "add" }>["format"];
type Observation = { data: MobileScan; code: string; format?: ScanFormat };
type CameraState =
  "checking" | "running" | "paused" | "denied" | "unavailable" | "web";
type ScanNavigation = ReturnType<typeof useNavigation> & {
  addListener(event: "tabPress", listener: () => void): () => void;
};

type CameraFrame = { data: string; type: string; seenAt: number };
const missTtlMs = 30_000;
const queuedFrameTtlMs = 2_000;

export default function ScanScreen() {
  const { api, active } = useMvp();
  const { controller: auth } = useCustomerAuth();
  const { controller: shopping, state: cart } = useShopping();
  const identity = auth.shoppingIdentity();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const navigation = useNavigation<ScanNavigation>();
  const { height } = useWindowDimensions();
  const [view, setView] = useState<"scan" | "cart">("scan");
  const [camera, setCamera] = useState<CameraState>(
    Platform.OS === "web" ? "web" : active ? "checking" : "paused",
  );
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [cameraTop, setCameraTop] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [showAimHint, setShowAimHint] = useState(false);
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
  }, [result, view, focused]);
  const generation = useRef(0),
    busy = useRef(false),
    permissionBusy = useRef(false),
    ready = useRef(false);
  const cameraLookup = useRef<string | null>(null);
  const queuedFrame = useRef<CameraFrame | null>(null);
  const deferredFrame = useRef<CameraFrame | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentMisses = useRef(new Map<string, number>());
  const abort = useRef<AbortController | null>(null);
  const focusRef = useRef(false),
    activeRef = useRef(active),
    wanted = useRef(false),
    resumeOnActive = useRef(false),
    viewRef = useRef(view);
  const permissionRef = useRef(permission),
    requestRef = useRef(requestPermission),
    getRef = useRef(getPermission);
  const resultRef = useRef(result);
  const [lastLookup, setLastLookup] = useState<{
    code: string;
    format?: ScanFormat;
  } | null>(null);
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
    cameraLookup.current = null;
    queuedFrame.current = null;
    deferredFrame.current = null;
    if (selectionTimer.current !== null) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
    recentMisses.current.clear();
    setShowAimHint(false);
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
    if (
      !focusRef.current ||
      !activeRef.current ||
      viewRef.current !== "scan" ||
      (automatic && !resumeOnActive.current)
    )
      return;
    resumeOnActive.current = true;
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
      resumeOnActive.current = true;
      setManual(Platform.OS === "web");
      setFocused(true);
      viewRef.current = "scan";
      setView("scan");
      void startRef.current(true);
      return () => {
        focusRef.current = false;
        resumeOnActive.current = false;
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
          resumeOnActive.current = true;
          setManual(Platform.OS === "web");
          setView("scan");
          void startRef.current(true);
        }
      }),
    [navigation],
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      activeRef.current = state === "active";
      if (state !== "active") {
        pause();
      } else if (resumeOnActive.current) void startRef.current(true);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Stop capture and cancel in-flight lookup immediately on native permission revocation.
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
    ) {
      return;
    }
    if (frame && (!ready.current || !wanted.current || resultRef.current)) {
      return;
    }
    setLastLookup(null);
    const value = frame ? raw : raw.trim();
    if (!isProductBarcode(value)) {
      setError("invalid_request");
      return;
    }
    const input = scanInputSchema.safeParse({
      code: value,
      ...(format ? { format } : {}),
    });
    if (!input.success) {
      setError("invalid_request");
      return;
    }
    let candidates: string[];
    try {
      candidates = barcodeCandidates(input.data.code, input.data.format);
    } catch {
      setError("invalid_request");
      return;
    }
    setLastLookup(input.data);
    const g = frame ? generation.current : ++generation.current;
    const frameKey = format + ":" + value;
    if (frame) {
      cameraLookup.current = frameKey;
    } else {
      resumeOnActive.current = false;
      ready.current = false;
      wanted.current = false;
      setCamera(Platform.OS === "web" ? "web" : "paused");
    }
    Keyboard.dismiss();
    busy.current = true;
    abort.current?.abort();
    abort.current = new AbortController();
    setPending(true);
    setShowAimHint(false);
    setError(undefined);
    setResult(undefined);
    setAdded(false);
    let cameraMiss = false;
    try {
      if (!api) throw new MobileFailure("not_configured");
      const data = await api.scan(
        input.data.code,
        abort.current.signal,
        input.data.format,
      );
      if (!valid(g)) return;
      if (!currentObservation(data)) {
        throw new MobileFailure("refresh_required");
      }
      if (data.kind === "active-item") {
        const item = data.product;
        if (!candidates.includes(item.barcode)) {
          throw new MobileFailure("invalid_response");
        }
        const observation = {
          data,
          code: input.data.code,
          format: input.data.format,
        };
        setSelected(undefined);
        resultRef.current = observation;
        setResult(observation);
        return;
      }
      if (data.product.publication !== "published") {
        throw new MobileFailure("invalid_response");
      }
      // Verify the returned Shopify VARIANT BARCODE even against an older backend.
      const matches = data.product.variants.nodes.filter(
        (v) =>
          v.identifiers.barcode !== null &&
          candidates.includes(v.identifiers.barcode),
      );
      if (
        matches.length !== 1 ||
        (data.product.selectedVariantId &&
          data.product.selectedVariantId !== matches[0].id)
      ) {
        throw new MobileFailure("invalid_response");
      }
      const selection = matches[0].id;
      const observation = {
        data: {
          ...data,
          product: { ...data.product, selectedVariantId: selection },
        },
        code: input.data.code,
        format: input.data.format,
      };
      setResult(observation);
      resultRef.current = observation;
      setSelected(selection);
    } catch (e) {
      if (valid(g)) {
        const failure =
          e instanceof MobileFailure ? e.code : "service_unavailable";
        cameraMiss = frame && failure === "not_found";
        if (cameraMiss) {
          setShowAimHint(true);
          const misses = recentMisses.current;
          // Keep reads bounded while moving past unpaired tags.
          misses.delete(frameKey);
          if (misses.size >= 32) misses.delete(misses.keys().next().value!);
          misses.set(frameKey, Date.now() + missTtlMs);
        } else {
          setError(failure);
        }
      }
    } finally {
      if (valid(g)) {
        busy.current = false;
        setPending(false);
        cameraLookup.current = null;
        const next = queuedFrame.current;
        queuedFrame.current = null;
        if (frame && !cameraMiss) {
          ready.current = false;
          wanted.current = false;
          resumeOnActive.current = false;
          setCamera("paused");
        } else if (
          cameraMiss &&
          next &&
          Date.now() - next.seenAt <= queuedFrameTtlMs
        ) {
          void lookup(next.data, next.type, true);
        }
      }
    }
  }
  function scanned(event: BarcodeScanningResult) {
    // Fence queued callbacks as well as the native decoder. QR is not this tab's workflow.
    if (
      !focusRef.current ||
      !activeRef.current ||
      viewRef.current !== "scan" ||
      generation.current !== cameraEpoch ||
      !ready.current ||
      !wanted.current
    )
      return;

    if (!isRetailBarcodeFormat(event.type)) return;
    const { data, type } = event;
    const frameKey = type + ":" + data;
    if ((recentMisses.current.get(frameKey) ?? 0) > Date.now()) {
      return;
    }
    const candidate = { data, type, seenAt: Date.now() };
    if (cameraLookup.current !== null) {
      if (frameKey !== cameraLookup.current) queuedFrame.current = candidate;

      return;
    }

    // Shelf displays can print a UPC as Code 128. Give that retail code first
    // chance while keeping custom Shopify barcodes eligible for exact lookup.
    if (type === "code128" && !validGtin(data)) {
      if (deferredFrame.current) {
        if (data !== deferredFrame.current.data)
          queuedFrame.current = candidate;
        return;
      }
      deferredFrame.current = candidate;
      selectionTimer.current = setTimeout(() => {
        selectionTimer.current = null;
        deferredFrame.current = null;
        if (valid(cameraEpoch)) void lookup(data, type, true);
      }, 180);
      return;
    }
    if (selectionTimer.current !== null) {
      clearTimeout(selectionTimer.current);
      selectionTimer.current = null;
      queuedFrame.current = deferredFrame.current;
      deferredFrame.current = null;
    }
    void lookup(data, type, true);
  }
  function nextItem() {
    resumeOnActive.current = true;
    setManual(Platform.OS === "web");
    setLastLookup(null);
    pause();
    setCode("");
    setError(undefined);
    void startRef.current(false);
  }
  function openCart() {
    resumeOnActive.current = false;
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
      result.data.kind !== "product-detail" ||
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
    if (!scannedVariantAvailable(result.data.product, variant)) {
      setError("quantity_unavailable");
      return;
    }
    try {
      const confirmed = await shopping.add(
        verifiedScanAddInput(
          result.code,
          result.format,
          variant.identifiers.barcode,
        ).code,
        selected,
        variant.price.amountCents,
        "code128",
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
      title="Scan a barcode"
      contentStyle={styles.content}
      onViewportLayout={(event) =>
        setViewportHeight(event.nativeEvent.layout.height)
      }
    >
      <View accessibilityRole="tablist" style={styles.tabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: view === "scan" }}
          style={[ui.chip, styles.tab, view === "scan" && ui.selected]}
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
          style={[ui.chip, styles.tab, view === "cart" && ui.selected]}
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
          {!result &&
            (Platform.OS !== "web" &&
            focused &&
            active &&
            camera === "running" ? (
              <BarcodeCamera
                key={cameraEpoch}
                frameStyle={[
                  styles.camera,
                  {
                    height:
                      viewportHeight > 0
                        ? barcodePreviewHeight(viewportHeight, cameraTop)
                        : Math.min(
                            360,
                            Math.max(220, Math.round(height * 0.34)),
                          ),
                  },
                ]}

                onLayout={(event) => setCameraTop(event.nativeEvent.layout.y)}
                onReady={() => {
                  if (valid(mountedEpoch) && wanted.current)
                    ready.current = true;
                }}
                onError={(code) => {
                  if (valid(mountedEpoch) && wanted.current) {
                    resumeOnActive.current = false;
                    pause("unavailable");
                    setError(code);
                  }
                }}
                onBarcodeScanned={scanned}
              />
            ) : (
              <View
                testID="barcode-camera-frame"
                onLayout={(event) => setCameraTop(event.nativeEvent.layout.y)}
                style={[
                  styles.camera,
                  {
                    height:
                      Platform.OS === "web"
                        ? 220
                        : viewportHeight > 0
                          ? barcodePreviewHeight(viewportHeight, cameraTop)
                          : Math.min(
                              360,
                              Math.max(220, Math.round(height * 0.34)),
                            ),
                  },
                ]}
              >
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
                            : camera === "unavailable"
                              ? "Retry camera"
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
              </View>
            ))}
          {showAimHint && !pending && camera === "running" && (
            <Text accessibilityLiveRegion="polite" style={ui.copy}>
              Still scanning. Aim at the barcode on the shelf display or box.
            </Text>
          )}
          {pending && (
            <Text accessibilityLiveRegion="polite" style={ui.copy}>
              Barcode detected. Finding your item…
            </Text>
          )}
          {error && (
            <Text accessibilityRole="alert" style={ui.copy}>
              {scanMessage(error)}
            </Text>
          )}
          {error &&
            lastLookup &&
            !pending &&
            !result &&
            error !== "camera_unavailable" && (
              <Button
                appearance="storefront"
                label="Retry barcode lookup"
                onPress={() => {
                  const attempt = lastLookup;
                  if (attempt) void lookup(attempt.code, attempt.format);
                }}
              />
            )}
          {result?.data.kind === "active-item" && (
            <Card appearance="storefront">
              <Text accessibilityLiveRegion="polite" style={ui.label}>
                Product found
              </Text>
              <Text style={ui.label}>{result.data.product.title}</Text>
              {result.data.product.variantTitle !== "Default Title" && (
                <Text style={ui.copy}>{result.data.product.variantTitle}</Text>
              )}
              <Text style={ui.copy}>
                {money(result.data.product.price.amountCents)}
              </Text>
              <Text style={ui.copy}>
                Ask an associate to check availability and ring this up at the
                counter.
              </Text>
              <Button
                appearance="storefront"
                secondary
                label="Scan next item"
                onPress={nextItem}
              />
            </Card>
          )}
          {result?.data.kind === "product-detail" && (
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
              onPress={() => {
                resumeOnActive.current = false;
                pause();
              }}
            />
          )}
          <View style={styles.secondary}>
            <Button
              appearance="storefront"
              secondary
              label={manual ? "Hide manual entry" : "Enter code manually"}
              onPress={() => {
                if (!manual) {
                  resumeOnActive.current = false;
                  pause();
                } else {
                  resumeOnActive.current = true;
                  void startRef.current(true);
                }
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
              <Text style={ui.label}>Enter a product barcode</Text>
              <TextInput
                accessibilityLabel="Product barcode"
                placeholder="Product barcode"
                value={code}
                onChangeText={setCode}
                maxLength={255}
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
  content: { gap: 12 },
  tabs: { flexDirection: "row", gap: 12 },
  tab: { flex: 1 },
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
  rehearsal: { ...storefront.type.eyebrow, color: storefront.colors.accent },
  secondary: { gap: 8 },
});
