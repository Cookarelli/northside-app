import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "../../components/Icon";
import { colors, storefront } from "../../theme";

const icons: Record<string, IconName> = {
  index: "home",
  shop: "shop",
  scan: "scan",
  wallet: "wallet",
  account: "account",
};

export default function TabLayout() {
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: storefront.colors.activeTab,
        tabBarInactiveTintColor: storefront.colors.inverseAccent,
        tabBarStyle: {
          backgroundColor: storefront.colors.hero,
          borderTopColor: storefront.colors.inverseDivider,
          paddingTop: 8,
          height: Math.max(68, 48 + 14 * fontScale) + bottom,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600", paddingBottom: 4 },
        tabBarIcon: ({ color, size }) => (
          <Icon
            name={icons[route.name] ?? "home"}
            color={color ?? colors.muted}
            size={size}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="shop" options={{ title: "Shop" }} />
      <Tabs.Screen name="scan" options={{ title: "Scan" }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
