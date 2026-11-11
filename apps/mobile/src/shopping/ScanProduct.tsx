import { useState } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import type { MobileProduct } from "@northside/customer-contracts/mvp";
import { Button, Card } from "../components/Controls";
import { money, storefrontUi as ui } from "../mvp/Components";
import { storefront } from "../theme";

export function ScanProduct({
  data,
  selected,
  onSelect,
  canAdd,
  busy,
  added,
  onAdd,
  onNext,
  unavailableReason,
}: {
  data: MobileProduct;
  selected?: string;
  onSelect: (value: string) => void;
  canAdd: boolean;
  busy: boolean;
  added: boolean;
  onAdd: () => void;
  onNext: () => void;
  unavailableReason?: string;
}) {
  const product = data.product;
  const [failedImage, setFailedImage] = useState<string>();
  const variant = product.variants.nodes.find((v) => v.id === selected);
  const available =
    product.availableForSale &&
    !!variant &&
    variant.availability.availableForSale &&
    !variant.availability.currentlyNotInStock &&
    variant.availability.state !== "unavailable";
  return (
    <Card appearance="storefront">
      <Text style={styles.kicker}>REVIEW YOUR ITEM</Text>
      {product.featuredImage && failedImage !== product.id ? (
        <Image
          source={{ uri: product.featuredImage.url }}
          alt={product.featuredImage.altText ?? product.title}
          accessibilityLabel={product.featuredImage.altText ?? product.title}
          contentFit="contain"
          style={styles.image}
          onError={() => setFailedImage(product.id)}
        />
      ) : (
        <Text style={ui.copy}>Product image unavailable</Text>
      )}
      <Text accessibilityRole="header" style={styles.title}>
        {product.title}
      </Text>
      {product.selectedVariantId ? (
        <Text style={ui.label}>
          {variant?.title ?? "Scanned variant unavailable"}
        </Text>
      ) : (
        <View
          style={ui.row}
          accessibilityRole="radiogroup"
          accessibilityLabel="Scanned product variant"
        >
          <Text style={ui.label}>Choose a variant</Text>
          {product.variants.nodes.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="radio"
              accessibilityLabel={v.title}
              accessibilityState={{
                checked: selected === v.id,
                disabled: busy,
              }}
              disabled={busy}
              style={[ui.chip, selected === v.id && ui.selected]}
              onPress={() => onSelect(v.id)}
            >
              <Text style={[ui.label, selected === v.id && ui.selectedLabel]}>
                {v.title} · {money(v.price.amountCents)}
              </Text>
            </Pressable>
          ))}
          {product.variants.pageInfo.hasNextPage && (
            <Text style={ui.copy}>
              More variants exist. Ask an associate if yours is not shown.
            </Text>
          )}
        </View>
      )}
      {variant && (
        <>
          <Text style={styles.price}>{money(variant.price.amountCents)}</Text>
          <Text style={ui.copy}>
            {available
              ? "Available online · in-store availability checked when adding"
              : "Currently unavailable"}
          </Text>
        </>
      )}
      {added && (
        <Text accessibilityLiveRegion="polite" style={ui.label}>
          Added to your shopping list. Still unpaid.
        </Text>
      )}
      <Button
        appearance="storefront"
        label={added ? "Add one more" : "Add to items"}
        disabled={!canAdd || !available || busy}
        onPress={onAdd}
      />
      {!canAdd && (
        <Text style={ui.copy}>
          {unavailableReason ??
            "Adding is unavailable until the store connection is verified."}
        </Text>
      )}
      <Button
        appearance="storefront"
        secondary
        label="Scan next item"
        disabled={busy}
        onPress={onNext}
      />
    </Card>
  );
}
const styles = StyleSheet.create({
  image: { height: 180, width: "100%" },
  kicker: { ...storefront.type.eyebrow, color: storefront.colors.accent },
  title: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "700",
    color: storefront.colors.ink,
  },
  price: {
    fontSize: 25,
    lineHeight: 32,
    fontWeight: "700",
    color: storefront.colors.ink,
  },
});
