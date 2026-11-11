import type { ComponentRef, PropsWithChildren, ReactNode, Ref } from "react";
import {
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import Constants from "expo-constants";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, storefront, type Appearance } from "../theme";
import { usePrivatePreview } from "../private-preview/context";

export function Screen({
  title,
  eyebrow,
  description,
  children,
  appearance = "default",
  introAction,
  introBackground,
  introFooter,
  titleContent,
  headerAccessory,
  scrollRef,
  introSize = "hero",
}: PropsWithChildren<{
  title: string;
  eyebrow: string;
  description?: string;
  appearance?: Appearance;
  introAction?: ReactNode;
  introBackground?: ReactNode;
  introFooter?: ReactNode;
  titleContent?: ReactNode;
  headerAccessory?: ReactNode;
  scrollRef?: Ref<ComponentRef<typeof ScrollView>>;
  introSize?: "hero" | "compact" | "minimal";
}>) {
  const { bottom } = useSafeAreaInsets();
  const privatePreview = usePrivatePreview();
  const branded = appearance === "storefront";
  return (
    <SafeAreaView style={[styles.safe, branded && styles.storefrontSafe]} edges={["top", "left", "right"]}>
      <View style={[styles.header, branded && styles.storefrontHeader]}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
          source={require("../../assets/brand/northside-logo.png")}
          alt="Northside Collectibles"
          style={[styles.logo, branded && styles.storefrontLogo]}
          contentFit="contain"
          accessibilityLabel="Northside Collectibles"
        />
        {privatePreview && <Pressable accessibilityRole="button" accessibilityLabel="Lock private selection"
          onPress={privatePreview.lock} style={{ minHeight: 48, minWidth: 60, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: branded ? storefront.colors.inverseBody : colors.actionBlue, fontWeight: "600", fontSize: 14 }}>Lock</Text>
        </Pressable>}
        {Platform.OS !== "web" && Constants.expoConfig?.extra?.mobile?.variant !== "production" && (
          <Text style={styles.badge}>PREVIEW</Text>
        )}
      </View>
      {headerAccessory}
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, branded && styles.storefrontContent, branded && introSize !== "hero" && styles.compactContent, { paddingBottom: 24 + bottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        >
          <View style={[styles.intro, branded && styles.storefrontIntro, branded && introSize !== "hero" && styles.compactIntro, branded && introSize === "minimal" && styles.minimalIntro]}>
            {introBackground}
            {Constants.expoConfig?.extra?.mobile?.interfacePreview === true && (
              <Text style={[styles.description, branded && styles.storefrontDescription]}>
                Interface preview · Customer services are not connected.
              </Text>
            )}
            <Text style={[styles.eyebrow, branded && styles.storefrontEyebrow]}>{eyebrow}</Text>
            <Text accessibilityRole="header" accessibilityLabel={title} style={[styles.title, branded && styles.storefrontTitle, branded && introSize !== "hero" && styles.compactTitle, branded && introSize === "minimal" && styles.minimalTitle]}>
              {titleContent ?? title}
            </Text>
            {description ? (
              <Text style={[styles.description, branded && styles.storefrontDescription]}>{description}</Text>
            ) : null}
            {introAction}
            {introFooter}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  compactContent: { gap: storefront.space.lg },
  compactIntro: { paddingTop: storefront.space.xl, paddingBottom: storefront.space.xl, gap: 12 },
  compactTitle: { ...storefront.type.pageTitle, textTransform: "uppercase" },
  minimalIntro: { paddingTop: 16, paddingBottom: 16, gap: 6 },
  minimalTitle: { fontSize: 32, lineHeight: 36 },
  storefrontSafe: { backgroundColor: storefront.colors.hero },
  storefrontHeader: { backgroundColor: storefront.colors.hero, borderBottomWidth: 0, minHeight: 82 },
  storefrontLogo: { width: 180, height: 50 },
  storefrontContent: { gap: storefront.space.section, backgroundColor: storefront.colors.white },
  storefrontIntro: { backgroundColor: storefront.colors.hero, marginHorizontal: -24, marginTop: -24, padding: storefront.space.lg, paddingTop: 68, paddingBottom: 28, gap: storefront.space.md, borderBottomWidth: 3, borderBottomColor: storefront.colors.electricBlue },
  storefrontEyebrow: { ...storefront.type.eyebrow, fontFamily: storefront.fontFamily, color: storefront.colors.inverseAccent },
  storefrontTitle: { ...storefront.type.hero, fontFamily: storefront.displayFamily, color: storefront.colors.white },
  storefrontDescription: { ...storefront.type.body, fontFamily: storefront.fontFamily, color: storefront.colors.inverseBody },
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    minHeight: 78,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  logo: { width: 170, height: 47, flexShrink: 1 },
  badge: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: colors.muted,
    padding: 8,
    backgroundColor: colors.canvas,
    borderRadius: 8,
  },
  body: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 24,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  intro: { gap: 10 },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.6,
    fontWeight: "700",
    color: colors.actionBlue,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: colors.charcoal,
  },
  description: { fontSize: 16, lineHeight: 25, color: colors.muted },
});
