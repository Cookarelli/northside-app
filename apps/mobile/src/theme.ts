import { Platform } from "react-native";

export const colors = {
  electricBlue: "#087BFF",
  actionBlue: "#0667D8",
  charcoal: "#172033",
  white: "#FFFFFF",
  canvas: "#F5F7FA",
  border: "#E2E8F0",
  muted: "#526077",
  paleBlue: "#EAF3FF",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export type Appearance = "default" | "storefront";

// Northside customer website preview and supplied screenshots, November 4, 2026.
// Shared customer appearance; defaults remain available for existing utility screens.
export const storefront = {
  colors: {
    accent: "#0667D8",
    electricBlue: "#087BFF",
    hero: "#071526",
    ink: "#172033",
    white: "#FFFFFF",
    inverseAccent: "#B2CCED",
    inverseBody: "#DFEBFA",
    body: "#526172",
    surface: "#F5F7FA",
    border: "#E2E8F0",
    inverseBorder: "#71869E",
    search: "#12263D",
    cyan: "#29B6FF",
    activeTab: "#80BBFF",
    inverseDivider: "#29476B",
  },
  fontFamily: Platform.select({ ios: "Arial", android: "sans-serif", default: "Arial" }),
  // System fonts only: no unlicensed copy of the website's Impact font is bundled.
  displayFamily: Platform.select({ ios: "AvenirNextCondensed-Heavy", android: "sans-serif-condensed", default: 'Impact, "Arial Black", Arial, sans-serif' }),
  type: {
    eyebrow: { fontSize: 12, lineHeight: 17, letterSpacing: 1.3, fontWeight: "700" as const },
    hero: { fontSize: 56, lineHeight: 56, letterSpacing: -1.4, fontWeight: "900" as const },
    pageTitle: { fontSize: 38, lineHeight: 42, letterSpacing: -0.8, fontWeight: "900" as const },
    heading: { fontSize: 28, lineHeight: 33, letterSpacing: -0.6, fontWeight: "800" as const },
    body: { fontSize: 16, lineHeight: 26 },
    button: { fontSize: 16, lineHeight: 23, fontWeight: "700" as const },
  },
  radius: { button: 8, card: 16, hero: 0 },
  space: { ...spacing, section: 40 },
  touchTarget: 52,
};
