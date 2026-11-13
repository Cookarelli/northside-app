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
  Clipboard,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { BarcodeCamera } from "../../shopping/BarcodeCamera";
import { storefront } from "../../theme";
import { barcodeCandidates } from "../../../../../packages/customer-contracts/src/native-scan";
import {
  isRetailBarcodeFormat,
  barcodePreviewHeight,
} from "../../shopping/barcode-scanner";
import {
  scanDiagnosticsEnabled,
  emptyScanDiagnostic,
  diagnosticValue,
  diagnosticOutcome,
  diagnosticMatch,
  formatScanDiagnostic,
  type ScanDiagnostic,
  scanAppIdentity,
} from "../../shopping/scan-diagnostics";
import { verifiedScanAddInput } from "../../shopping/verified-scan";

function scanMessage(error: string) {
  if (error === "camera_setup_unavailable")
    return "Camera controls could not initialize. Retry the camera or install the updated preview. You can enter the barcode manually.";
  if (error === "invalid_request" || error === "unsupported_qr")
    return "Enter a product barcode, up to 64 characters.";
  if (error === "not_found")
    return "Product not found. No approved product matches this barcode. Check the product barcode on the ESL display or original box, or ask an associate.";
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
  const [camera, setCamera] = useState<CameraState>(
    Platform.OS === "web" ? "web" : active ? "checking" : "paused",
  );
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [cameraTop, setCameraTop] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [manual, setManual] = useState(Platform.OS === "web");
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Observation>();
  const [selected, setSelected] = useState<string>();
  const [added, setAdded] = useState(false);
  const qaEnabled = scanDiagnosticsEnabled(Constants.expoConfig?.extra?.mobile);
  const appIdentity = scanAppIdentity(Constants);
  const [qaOpen, setQaOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diagnostic, setDiagnostic] = useState(emptyScanDiagnostic);
  const diagnosticRef = useRef(diagnostic);
  const countsRef = useRef({ forwarded: 0, ignoredFormat: 0, suppressed: 0 });
  const [eventCounts, setEventCounts] = useState({
    forwarded: 0,
    ignoredFormat: 0,
    suppressed: 0,
  });
  function observe(change: Partial<ScanDiagnostic>) {
    if (!qaEnabled) return;
    diagnosticRef.current = { ...diagnosticRef.current, ...change };
    setDiagnostic(diagnosticRef.current);
    setCopied(false);
  }
  function countEvent(key: keyof typeof countsRef.current) {
    if (!qaEnabled) return;
    countsRef.current = {
      ...countsRef.current,
      [key]: countsRef.current[key] + 1,
    };
    setEventCounts(countsRef.current);
  }
  const clearDiagnostic = useCallback(() => {
    diagnosticRef.current = emptyScanDiagnostic();
    countsRef.current = { forwarded: 0, ignoredFormat: 0, suppressed: 0 };
    setDiagnostic(diagnosticRef.current);
    setEventCounts(countsRef.current);
    setQaOpen(false);
    setCopied(false);
  }, []);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [result, view, focused]);
  const generation = useRef(0),
    busy = useRef(false),
    permissionBusy = useRef(false),
    ready = useRef(false);
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
    if (diagnosticRef.current.outcome === "looking_up") {
      diagnosticRef.current = {
        ...diagnosticRef.current,
        outcome: "cancelled",
        failureReason: "lookup_interrupted_by_navigation_or_app_state",
      };
      setDiagnostic(diagnosticRef.current);
    }
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
        setQaOpen(false);
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
      clearDiagnostic();
      if (identity !== "booting" && identity !== "authenticating")
        void startRef.current(true);
    }
  }, [api, identity, pause, clearDiagnostic]);
  useEffect(() => {
    if (permission && !permission.granted && camera === "running")
      // Synchronize a revoked native camera permission; this effect stops the device resource.
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
      if (frame) countEvent("suppressed");
      return;
    }
    if (frame && (!ready.current || !wanted.current || resultRef.current)) {
      countEvent("suppressed");
      return;
    }
    setLastLookup(null);
    const value = frame ? raw : raw.trim();
    if (qaEnabled) {
      diagnosticRef.current = emptyScanDiagnostic();
      observe({
        recordedAt: new Date().toISOString(),
        source: frame ? "camera" : "manual",
        rawValue: diagnosticValue(raw, format),
        rawLength: raw.length,
        format: format ? diagnosticValue(format) : null,
        lookupValue: diagnosticValue(value, format),
        outcome: "looking_up",
      });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._$%+\/-]{0,63}$/.test(value)) {
      setError("invalid_request");
      observe({
        outcome: "invalid_barcode",
        failureReason: "input_character_or_length_guard",
      });
      return;
    }
    const input = scanInputSchema.safeParse({
      code: value,
      ...(format ? { format } : {}),
    });
    if (!input.success) {
      setError("invalid_request");
      observe({
        outcome: "invalid_barcode",
        failureReason: "scan_input_schema_guard",
      });
      return;
    }
    let candidates: string[];
    try {
      candidates = barcodeCandidates(input.data.code, input.data.format);
    } catch {
      setError("invalid_request");
      observe({
        outcome: "invalid_barcode",
        failureReason: "barcode_format_or_checksum_guard",
      });
      return;
    }
    observe({ candidates: candidates.map((c) => diagnosticValue(c, format)) });
    setLastLookup(input.data);
    resumeOnActive.current = false;
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
    let verificationFailure: string | undefined;
    try {
      if (!api) throw new MobileFailure("not_configured");
      const data = await api.scan(
        input.data.code,
        abort.current.signal,
        input.data.format,
        qaEnabled
          ? (trace) => {
              if (valid(g))
                observe({
                  lookup: { ...diagnosticRef.current.lookup, ...trace },
                });
            }
          : undefined,
      );
      if (!valid(g)) return;
      if (!currentObservation(data)) {
        verificationFailure = "expired_product_observation";
        throw new MobileFailure("refresh_required");
      }
      if (data.product.publication !== "published") {
        verificationFailure = "product_not_published";
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
        verificationFailure = "returned_variant_barcode_mismatch";
        throw new MobileFailure("invalid_response");
      }
      const selection = matches[0].id;
      const matched = diagnosticMatch(data, selection);
      const canonicalAddInput = verifiedScanAddInput(
        input.data.code,
        input.data.format,
        matches[0].identifiers.barcode,
      );
      observe({
        matched,
        canonicalAddInput,
        outcome: matched.appEligible ? "product_found" : "product_unavailable",
        failureReason: null,
      });
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
        setError(failure);
        observe({
          outcome: diagnosticOutcome(failure),
          failureReason: verificationFailure ?? failure,
        });
      }
    } finally {
      if (valid(g)) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  function scanned(event: BarcodeScanningResult) {
    // Fence queued callbacks as well as the native decoder. QR is not this tab's workflow.
    // Fence QA writes too: an old callback must not repopulate a cleared report.
    if (
      !focusRef.current ||
      !activeRef.current ||
      viewRef.current !== "scan" ||
      generation.current !== cameraEpoch
    )
      return;
    countEvent("forwarded");
    if (!isRetailBarcodeFormat(event.type)) {
      countEvent("ignoredFormat");
      if (diagnosticRef.current.source === null)
        observe({
          source: "camera",
          rawValue: diagnosticValue(event.data, event.type),
          rawLength: event.data.length,
          format: diagnosticValue(event.type),
          outcome: "invalid_barcode",
          failureReason: "ignored_camera_format",
        });
      return;
    }
    void lookup(event.data, event.type, true);
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
      <View style={styles.tabs}>
        <View accessibilityRole="tablist" style={[styles.tabs, styles.tab]}>
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
        {qaEnabled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Internal QA diagnostics"
            style={[ui.chip, styles.qaButton]}
            onPress={() => {
              setCopied(false);
              setQaOpen(true);
            }}
          >
            <Text style={ui.label}>QA</Text>
          </Pressable>
        )}
      </View>
      {Constants.expoConfig?.extra?.mobile?.scanRehearsal === true && (
        <Text style={styles.rehearsal}>
          LOCAL REHEARSAL · SYNTHETIC TEST ITEMS
        </Text>
      )}
      {qaEnabled && (
        <Modal
          visible={qaOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setQaOpen(false)}
        >
          <SafeAreaView style={styles.qa}>
            <Text accessibilityRole="header" style={ui.heading}>
              Internal scan diagnostics
            </Text>
            <Text style={ui.label}>
              Native iOS build {appIdentity.nativeIosBuild ?? "unknown"} ·
              Bundle build {appIdentity.configuredBundleBuild ?? "unknown"}
            </Text>
            <Text selectable style={ui.copy}>
              Source {appIdentity.sourceCommit ?? "unknown"} · OTA{" "}
              {appIdentity.otaConfigured === false ? "disabled" : "unverified"}
            </Text>
            <Text style={ui.copy}>
              Last recorded attempt. Reports survive tab changes and
              backgrounding until the next lookup or Clear. No forwarded event
              means this screen has not received one; it does not prove the
              native decoder detected nothing.
            </Text>
            <ScrollView style={styles.qaReport}>
              <Text selectable testID="scan-diagnostic-report" style={ui.copy}>
                {formatScanDiagnostic(diagnostic, eventCounts, appIdentity)}
              </Text>
            </ScrollView>
            <Button
              appearance="storefront"
              label={copied ? "Diagnostics copied" : "Copy scan diagnostics"}
              onPress={() => {
                Clipboard.setString(
                  formatScanDiagnostic(diagnostic, eventCounts, appIdentity),
                );
                setCopied(true);
              }}
            />
            <Button
              appearance="storefront"
              secondary
              label="Clear scan diagnostics"
              disabled={pending}
              onPress={clearDiagnostic}
            />
            <Button
              appearance="storefront"
              secondary
              label="Close diagnostics"
              onPress={() => setQaOpen(false)}
            />
          </SafeAreaView>
        </Modal>
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
                  if (valid(mountedEpoch)) {
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
          {result && (
            <Text accessibilityLiveRegion="polite" style={ui.label}>
              {selected && !diagnosticMatch(result.data, selected).appEligible
                ? "Product found · Unavailable in the app"
                : "Product found · Review before adding"}
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
                maxLength={64}
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
  qa: {
    flex: 1,
    padding: 20,
    gap: 12,
    backgroundColor: storefront.colors.white,
  },
  qaReport: { flex: 1 },
  qaButton: { minWidth: 48, alignItems: "center", justifyContent: "center" },
});
