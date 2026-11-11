import { Link, type Href } from "expo-router";
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import type { BrowseProduct } from "../private-preview/catalog";
import { Button } from "../components/Controls";
import { StatePanel } from "../components/StatePanel";
import { colors, storefront, type Appearance } from "../theme";
import type { Resource } from "./Provider";
import { CatalogPhoto } from "./CatalogPhoto";
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export function ResourceState({
  resource,
  title = "This information",
  icon = "shop",
  appearance = "default",
}: {
  resource: Resource<unknown> & { reload: () => void };
  title?: string;
  icon?: "shop" | "scan" | "wallet" | "account" | "home";
  appearance?: Appearance;
}) {
  if (resource.status === "ready") return null;
  const offline = resource.error === "offline" || resource.error === "timeout";
  return (
    <>
      <StatePanel
        appearance={appearance}
        icon={icon}
        state={
          resource.status === "loading"
            ? {
                status: "loading",
                title: "Loading " + title.toLowerCase(),
                message: "Checking current Northside information.",
              }
            : {
                status: "unavailable",
                title:
                  resource.status === "unconfigured"
                    ? title + " unavailable"
                    : offline
                      ? "Connection unavailable"
                      : resource.error === "refresh_required"
                        ? "Refresh to see current information"
                        : title + " unavailable",
                message:
                  resource.status === "unconfigured"
                    ? "This information is not available right now. Please check back soon."
                    : offline
                      ? "Check your connection. Private data and old prices are not available offline."
                      : "Please refresh or try again later. No purchase or inventory reservation has been made.",
              }
        }
      />
      {resource.status !== "unconfigured" && (
        <Button
          appearance={appearance}
          label={"Refresh " + title.toLowerCase()}
          onPress={resource.reload}
        />
      )}
    </>
  );
}
export function ProductTile({
  product,
  variant,
  appearance = "default",
}: {
  product: BrowseProduct;
  variant?: string | null;
  appearance?: Appearance;
}) {
  const window = useWindowDimensions();
  const wide =
    window.width >= 700 &&
    (appearance !== "storefront" || window.fontScale <= 1.5);
  const href = {
    pathname: "/product/[handle]",
    params: { handle: product.handle, ...(variant ? { variant } : {}) },
  } as Href;
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${product.title}. From ${money(product.minVariantPrice.amountCents)}. ${product.publication === "draft" ? "Private selection. Browsing only" : product.availableForSale ? "Available online" : "Currently unavailable"}`}
        style={StyleSheet.flatten([
          styles.product,
          appearance === "storefront" && styles.storefrontProduct,
          { width: wide ? "48%" : "100%" },
        ])}
      >
        <CatalogPhoto
          image={product.featuredImage}
          title={product.title}
          height={190}
          appearance={appearance}
        />
        <View style={styles.productCopy}>
          <Text
            style={[
              styles.tag,
              appearance === "storefront" && styles.storefrontTag,
            ]}
          >
            {product.productType || "Collectibles"}
          </Text>
          <Text
            style={[
              styles.productTitle,
              appearance === "storefront" && styles.storefrontTitle,
            ]}
          >
            {product.title}
          </Text>
          <Text
            style={[
              styles.price,
              appearance === "storefront" && styles.storefrontTitle,
            ]}
          >
            From {money(product.minVariantPrice.amountCents)}
          </Text>
          <Text
            style={[
              styles.muted,
              appearance === "storefront" && styles.storefrontMuted,
            ]}
          >
            {product.publication === "draft"
              ? "Private selection · Browsing only"
              : product.availableForSale
                ? "Available online"
                : "Currently unavailable"}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}
export const ui = StyleSheet.create({
  heading: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "700",
    color: colors.charcoal,
  },
  copy: { fontSize: 16, lineHeight: 25, color: colors.muted },
  list: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.charcoal,
    backgroundColor: colors.canvas,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 48,
    padding: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  selected: {
    backgroundColor: colors.paleBlue,
    borderColor: colors.actionBlue,
  },
  label: { fontSize: 16, fontWeight: "600", color: colors.charcoal },
  row: { gap: 12 },
});
/** Customer form and data typography, sharing the approved Home tokens. */
export const storefrontUi = StyleSheet.create({
  ...ui,
  heading: {
    ...storefront.type.heading,
    fontFamily: storefront.displayFamily,
    color: storefront.colors.ink,
    textTransform: "uppercase",
  },
  copy: {
    ...storefront.type.body,
    fontFamily: storefront.fontFamily,
    color: storefront.colors.body,
  },
  label: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    fontFamily: storefront.fontFamily,
    color: storefront.colors.ink,
  },
  input: {
    ...ui.input,
    borderRadius: storefront.radius.button,
    fontFamily: storefront.fontFamily,
    backgroundColor: storefront.colors.surface,
    borderColor: storefront.colors.border,
  },
  chip: {
    ...ui.chip,
    borderRadius: storefront.radius.button,
    borderColor: storefront.colors.border,
    maxWidth: "100%",
    flexShrink: 1,
  },
  selected: {
    backgroundColor: storefront.colors.hero,
    borderColor: storefront.colors.hero,
  },
  selectedLabel: { color: storefront.colors.white },
});

const styles = StyleSheet.create({
  storefrontProduct: {
    borderRadius: storefront.radius.card,
    borderColor: storefront.colors.border,
  },
  storefrontTag: {
    color: storefront.colors.accent,
    fontFamily: storefront.fontFamily,
  },
  storefrontTitle: {
    color: storefront.colors.ink,
    fontFamily: storefront.fontFamily,
  },
  storefrontImage: { backgroundColor: storefront.colors.surface },
  storefrontMuted: {
    color: storefront.colors.body,
    fontFamily: storefront.fontFamily,
  },
  product: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  image: {
    height: 190,
    width: "100%",
    backgroundColor: colors.canvas,
    justifyContent: "center",
    alignItems: "center",
  },
  productCopy: { padding: 18, gap: 8 },
  tag: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.actionBlue,
    textTransform: "uppercase",
  },
  productTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "600",
    color: colors.charcoal,
  },
  price: { fontSize: 19, fontWeight: "700", color: colors.charcoal },
  muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
});
