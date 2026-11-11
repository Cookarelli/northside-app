import type { PropsWithChildren } from "react";
import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, storefront, type Appearance } from "../theme";
import { Icon, type IconName } from "./Icon";

export function ActionLink({
  href,
  label,
  secondary = false,
  appearance = "default",
  inverse = false,
}: {
  href: Href;
  label: string;
  secondary?: boolean;
  appearance?: Appearance;
  inverse?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        style={StyleSheet.flatten([styles.button, secondary && styles.secondary,
          appearance === "storefront" && styles.storefrontButton,
          appearance === "storefront" && secondary && styles.storefrontSecondary,
          inverse && secondary && styles.inverseButton])}
      >
        <Text style={[styles.buttonText, secondary && styles.secondaryText,
          appearance === "storefront" && styles.storefrontButtonText,
          appearance === "storefront" && secondary && styles.storefrontSecondaryText,
          inverse && secondary && styles.inverseText]}>
          {label}
        </Text>
        <Icon
          name="arrow"
          color={inverse ? colors.white : secondary ? appearance === "storefront" ? storefront.colors.accent : colors.actionBlue : colors.white}
          size={20}
        />
      </Pressable>
    </Link>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  appearance = "default",
  inverse = false,
  secondary = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  appearance?: Appearance;
  inverse?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        appearance === "storefront" && styles.storefrontButton,
        secondary && styles.secondary,
        appearance === "storefront" && secondary && styles.storefrontSecondary,
        inverse && styles.inverseButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, appearance === "storefront" && styles.storefrontButtonText, secondary && styles.secondaryText, appearance === "storefront" && secondary && styles.storefrontSecondaryText, inverse && styles.inverseText, disabled && styles.disabledText]}>
        {label}
      </Text>
      {inverse && <Icon name="arrow" size={20} color={storefront.colors.white} />}
    </Pressable>
  );
}

export function FeatureLink({
  href,
  icon,
  title,
  detail,
  appearance = "default",
}: {
  href: Href;
  icon: IconName;
  title: string;
  detail: string;
  appearance?: Appearance;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title}. ${detail}`}
        style={styles.feature}
      >
        <View style={[styles.icon, appearance === "storefront" && styles.storefrontIcon]}>
          <Icon name={icon} color={appearance === "storefront" ? storefront.colors.accent : colors.actionBlue} />
        </View>
        <View style={styles.featureCopy}>
          <Text style={[styles.featureTitle, appearance === "storefront" && styles.storefrontFeatureTitle]}>{title}</Text>
          <Text style={[styles.detail, appearance === "storefront" && styles.storefrontCopy]}>{detail}</Text>
        </View>
        <Icon name="arrow" size={20} />
      </Pressable>
    </Link>
  );
}

export function Card({ children, appearance = "default" }: PropsWithChildren<{ appearance?: Appearance }>) {
  return <View style={[styles.card, appearance === "storefront" && styles.storefrontCard]}>{children}</View>;
}

export function SectionHeading({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return <View style={{ gap: storefront.space.sm }}>
    {eyebrow && <Text style={styles.storefrontEyebrow}>{eyebrow}</Text>}
    <Text accessibilityRole="header" style={styles.storefrontHeading}>{title}</Text>
  </View>;
}

const styles = StyleSheet.create({
  storefrontButton: { minHeight: storefront.touchTarget, borderRadius: storefront.radius.button, backgroundColor: storefront.colors.accent },
  storefrontButtonText: { ...storefront.type.button, fontFamily: storefront.fontFamily },
  storefrontSecondary: { backgroundColor: storefront.colors.white, borderWidth: 1, borderColor: storefront.colors.border },
  storefrontSecondaryText: { color: storefront.colors.accent },
  storefrontIcon: { backgroundColor: storefront.colors.surface, borderRadius: storefront.radius.card },
  storefrontCard: { borderRadius: storefront.radius.card, borderColor: storefront.colors.border, backgroundColor: storefront.colors.white },
  storefrontFeatureTitle: { fontFamily: storefront.fontFamily, color: storefront.colors.ink, fontWeight: "700" },
  storefrontCopy: { fontFamily: storefront.fontFamily, color: storefront.colors.body },
  storefrontEyebrow: { ...storefront.type.eyebrow, fontFamily: storefront.fontFamily, color: storefront.colors.accent, textTransform: "uppercase" },
  storefrontHeading: { ...storefront.type.heading, fontFamily: storefront.displayFamily, color: storefront.colors.ink, textTransform: "uppercase" },
  inverseButton: { borderColor: storefront.colors.inverseBorder, borderWidth: 1, backgroundColor: "#07152666", borderRadius: storefront.radius.button },
  inverseText: { color: storefront.colors.white },
  button: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.actionBlue,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    flexShrink: 1,
  },
  secondary: { backgroundColor: colors.paleBlue },
  secondaryText: { color: colors.actionBlue },
  disabled: { backgroundColor: colors.border },
  disabledText: { color: colors.muted },
  pressed: { opacity: 0.72 },
  feature: {
    minHeight: 82,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.paleBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  featureCopy: { flex: 1, gap: 4 },
  featureTitle: { color: colors.charcoal, fontSize: 17, fontWeight: "600" },
  detail: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  card: {
    padding: 20,
    borderRadius: 18,
    backgroundColor: colors.canvas,
    gap: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
