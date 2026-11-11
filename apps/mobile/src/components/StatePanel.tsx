import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, storefront, type Appearance } from "../theme";
import { Icon, type IconName } from "./Icon";

export type ViewState = {
  status: "loading" | "empty" | "unavailable";
  title: string;
  message: string;
};

export function StatePanel({
  state,
  icon,
  appearance = "default",
}: {
  state: ViewState;
  icon: IconName;
  appearance?: Appearance;
}) {
  return (
    <View
      style={[styles.panel, appearance === "storefront" && styles.storefrontPanel]}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: state.status === "loading" }}
    >
      <View style={[styles.symbol, appearance === "storefront" && styles.storefrontSymbol]}>
        {state.status === "loading" ? (
          <ActivityIndicator
            accessibilityLabel="Loading"
            color={appearance === "storefront" ? storefront.colors.accent : colors.actionBlue}
            size="large"
          />
        ) : (
          <Icon name={icon} size={30} color={appearance === "storefront" ? storefront.colors.accent : colors.actionBlue} />
        )}
      </View>
      <Text accessibilityRole="header" style={[styles.title, appearance === "storefront" && styles.storefrontTitle]}>
        {state.title}
      </Text>
      <Text style={[styles.message, appearance === "storefront" && styles.storefrontCopy]}>{state.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  storefrontPanel: { borderRadius: storefront.radius.card, borderColor: storefront.colors.border, backgroundColor: storefront.colors.surface },
  storefrontSymbol: { backgroundColor: storefront.colors.white, borderRadius: storefront.radius.card },
  storefrontTitle: { color: storefront.colors.ink, fontFamily: storefront.fontFamily, fontWeight: "700" },
  storefrontCopy: { color: storefront.colors.body, fontFamily: storefront.fontFamily },
  panel: {
    paddingHorizontal: 22,
    paddingVertical: 32,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
    alignItems: "center",
    gap: 14,
  },
  symbol: {
    height: 64,
    width: 64,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paleBlue,
    borderRadius: 20,
  },
  title: {
    color: colors.charcoal,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "600",
    textAlign: "center",
  },
  message: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 25,
    textAlign: "center",
  },
});
