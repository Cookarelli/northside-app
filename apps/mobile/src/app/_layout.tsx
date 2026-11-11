import { PrivatePreviewGate } from "../private-preview/Gate";
import { MvpProvider } from "../mvp/Provider";
import { AuthProvider } from "../auth/Provider";
import { ShoppingProvider } from "../shopping/Provider";
import { Suspense } from "react";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { colors } from "../theme";
import { Screen } from "../components/Screen";
import { Button } from "../components/Controls";
import { StatePanel } from "../components/StatePanel";

export const unstable_settings = { anchor: "(tabs)" };

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <Screen eyebrow="Northside" title="Let’s try that again.">
      <StatePanel
        icon="home"
        state={{
          status: "unavailable",
          title: "This screen couldn’t open",
          message:
            "Please try again. Your account and collection have not been changed.",
        }}
      />
      <Button
        label="Try again"
        onPress={() => {
          void retry();
        }}
      />
    </Screen>
  );
}

function LoadingScreen() {
  return (
    <Screen eyebrow="Northside" title="Getting ready.">
      <StatePanel
        icon="home"
        state={{
          status: "loading",
          title: "Opening your screen",
          message: "Please wait a moment.",
        }}
      />
    </Screen>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <PrivatePreviewGate>
      <MvpProvider>
        <AuthProvider>
          <ShoppingProvider>
          <StatusBar style="dark" />
          <Suspense fallback={<LoadingScreen />}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.white },
              }}
            >
              <Stack.Screen name="(tabs)" />
            </Stack>
          </Suspense>
          </ShoppingProvider>
        </AuthProvider>
      </MvpProvider>
      </PrivatePreviewGate>
    </SafeAreaProvider>
  );
}
