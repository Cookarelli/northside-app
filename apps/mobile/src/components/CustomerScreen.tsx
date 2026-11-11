import { useCallback, type ComponentProps } from "react";
import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { PhotoBackdrop } from "./PhotoBackdrop";
import { Screen } from "./Screen";

/** Shared secondary-screen treatment for the customer app's existing flows. */
export function CustomerScreen(props: ComponentProps<typeof Screen>) {
  useFocusEffect(useCallback(() => {
    setStatusBarStyle("light");
    return () => setStatusBarStyle("dark");
  }, []));
  return <Screen {...props} appearance="storefront" introSize={props.introSize ?? "compact"}
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
    introBackground={<PhotoBackdrop source={require("../../assets/home/northside-led-wall.webp")} />} />;
}
