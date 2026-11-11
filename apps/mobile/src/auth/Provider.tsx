import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { AuthController } from "./controller";
import { createNativeAuth } from "./native";
import { colors } from "../theme";

const Context = createContext<AuthController | null>(null);
export function AuthProvider({
  children,
  controller: provided,
}: PropsWithChildren<{ controller?: AuthController }>) {
  const [controller] = useState(() => provided ?? createNativeAuth());
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let mounted = true,
      bootstrapped = false;
    const launchUrl = Linking.getInitialURL();
    const activate = () => {
      void launchUrl.then(async (url) => {
        if (!mounted || AppState.currentState !== "active") return;
        if (!bootstrapped) {
          bootstrapped = true;
          await controller.initialize(url);
        } else if (mounted && AppState.currentState === "active")
          await controller.load();
      });
    };
    controller.setVisibility(AppState.currentState === "active");
    const subscription = Linking.addEventListener("url", (event) => {
      void controller.receive(event.url);
    });
    if (AppState.currentState === "active") activate();
    const app = AppState.addEventListener("change", (state) => {
      const visible = state === "active";
      setActive(visible);
      controller.setVisibility(visible);
      if (visible) activate();
    });
    return () => {
      mounted = false;
      subscription.remove();
      app.remove();
    };
  }, [controller]);

  return (
    <Context.Provider value={controller}>
      {children}
      {!active && (
        <View style={styles.cover} accessibilityViewIsModal>
          <Text style={styles.text}>Northside Collectibles</Text>
        </View>
      )}
    </Context.Provider>
  );
}
export function useCustomerAuth() {
  const controller = useContext(Context);
  if (!controller)
    throw new Error("Customer authentication context unavailable");
  return {
    controller,
    state: useSyncExternalStore(
      controller.subscribe,
      controller.snapshot,
      controller.snapshot,
    ),
  };
}
const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: colors.charcoal, fontSize: 22, fontWeight: "600" },
});
