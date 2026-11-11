import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Platform, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { Screen } from "../components/Screen";
import { Button } from "../components/Controls";
import { ui } from "../mvp/Components";
import { PrivateCatalogApi, type PrivateCatalog } from "./catalog";
import { loadPrivateCatalog } from "./crypto";
import { PrivatePreviewContext } from "./context";

export function PrivatePreviewGate({ children, enabled = Constants.expoConfig?.extra?.mobile?.privateCatalogPreview === true, load = loadPrivateCatalog }:
  PropsWithChildren<{ enabled?: boolean; load?: (code: string, signal: AbortSignal) => Promise<PrivateCatalog> }>) {
  const [session, setSession] = useState<{ api: PrivateCatalogApi; deadline: number } | null>(null);
  const [code, setCode] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const epoch = useRef(0), controller = useRef<AbortController | null>(null), currentApi = useRef<PrivateCatalogApi | null>(null);
  // Cleanup deliberately cancels the latest in-flight attempt and API, rather
  // than the values that happened to exist when the subscription was installed.
  const dispose = useCallback(() => {
    epoch.current++; controller.current?.abort(); controller.current = null;
    currentApi.current?.dispose(); currentApi.current = null;
  }, []);
  const lock = useCallback(() => {
    dispose();
    setSession(null); setCode(""); setPending(false); setError(undefined);
  }, [dispose]);
  useEffect(() => {
    if (!enabled) return;
    const app = AppState.addEventListener("change", state => { if (state !== "active") lock(); });
    const hide = () => { if (document.visibilityState !== "visible") lock(); };
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", lock);
    }
    return () => {
      app.remove(); dispose();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", lock);
      }
    };
  }, [enabled, lock, dispose]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(lock, Math.max(0, session.deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [session, lock]);
  async function unlock() {
    if (pending || Platform.OS !== "web") return;
    const attempt = ++epoch.current;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const entered = code.trim(); setCode(""); setPending(true); setError(undefined);
    const timer = setTimeout(() => request.abort(), 12000);
    try {
      const selection = await load(entered, request.signal);
      if (attempt !== epoch.current || request.signal.aborted || AppState.currentState !== "active") return;
      const api = new PrivateCatalogApi(selection);
      currentApi.current = api;
      setSession({ api, deadline: Math.min(Date.now() + 1800000, Date.parse(selection.expiresAt)) });
    } catch {
      if (attempt === epoch.current) setError("Couldn’t open this selection. Check your access code and try again.");
    } finally {
      clearTimeout(timer);
      if (attempt === epoch.current) { setPending(false); controller.current = null; }
    }
  }
  if (!enabled) return children;
  if (Platform.OS !== "web") return <Screen title="Open in your browser" eyebrow="Northside"><Text style={ui.copy}>This private selection is available through its browser link.</Text></Screen>;
  if (session) return <PrivatePreviewContext.Provider value={{ api: session.api, lock }}>{children}</PrivatePreviewContext.Provider>;
  return <Screen title="Welcome to Northside." eyebrow="Your invitation" description="Enter your access code to explore the collection.">
    <View style={ui.row}>
      <Text style={ui.label}>Access code</Text>
      <TextInput accessibilityLabel="Private preview access code" value={code} onChangeText={setCode} secureTextEntry
        autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={60}
        editable={!pending} returnKeyType="go" onSubmitEditing={() => { void unlock(); }} style={ui.input} />
      <Button label={pending ? "Opening collection…" : "Open collection"} disabled={pending || !code.trim()} onPress={() => { void unlock(); }} />
      {pending && <Button label="Cancel" onPress={lock} />}
      {error && <Text accessibilityRole="alert" style={ui.copy}>{error}</Text>}
    </View>
  </Screen>;
}
