import { useId } from "react";
import { View, StyleSheet } from "react-native";
import { Image, type ImageProps } from "expo-image";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { storefront } from "../theme";

/** Decorative Northside photography, shaded for readable text on every platform. */
export function PhotoBackdrop({ source }: { source: ImageProps["source"] }) {
  const gradient = "photo" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Image source={source} alt="" contentFit="cover" contentPosition={{ left: "50%", top: "38%" }} accessible={false} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} accessible={false}>
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={storefront.colors.hero} stopOpacity="0.35" />
            <Stop offset="0.42" stopColor={storefront.colors.hero} stopOpacity="0.92" />
            <Stop offset="1" stopColor={storefront.colors.hero} stopOpacity="0.99" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradient})`} />
      </Svg>
    </View>
  );
}
