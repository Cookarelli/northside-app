import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { View, Text, Pressable } from "react-native";
import { CustomerScreen as Screen } from "../../components/CustomerScreen";
import { ActionLink, Button, Card } from "../../components/Controls";
import { useResource } from "../../mvp/Provider";
import { ResourceState, storefrontUi as ui, money } from "../../mvp/Components";
import { CatalogPhoto } from "../../mvp/CatalogPhoto";
export default function ProductScreen() {
  const params = useLocalSearchParams<{ handle: string; variant?: string }>(),
    handle = typeof params.handle === "string" ? params.handle : "";
  const [selected, setSelected] = useState<string>(),
    [after, setAfter] = useState<string>(),
    [imageAttempt, setImageAttempt] = useState(0);
  const resource = useResource(
    (api, signal) => api.product(handle, after, signal),
    handle + ":" + (after ?? ""),
  );
  const product = resource.data?.product,
    requestedVariant = selected ?? params.variant,
    variant =
      product?.variants.nodes.find((v) => v.id === requestedVariant) ??
      (!requestedVariant && product?.variants.nodes.length === 1
        ? product.variants.nodes[0]
        : undefined);
  return (
    <Screen
      eyebrow="Northside catalog"
      title={product?.title ?? "Product details"}
      description={
        product?.publication === "draft"
          ? "Private selection. Catalog prices are shown for review."
          : "Current published merchandise. No purchase or reservation."
      }
    >
      <ActionLink
        appearance="storefront"
        href="/shop"
        label="Back to Shop"
        secondary
      />
      <ResourceState
        appearance="storefront"
        resource={resource}
        title="Product"
      />
      {resource.status === "ready" && product && (
        <>
          <CatalogPhoto
            image={product.featuredImage}
            title={product.title}
            height={300}
            appearance="storefront"
            unavailableLabel="Product image unavailable"
            attempt={imageAttempt}
          />
          <Text style={ui.copy}>
            {product.description ||
              (product.publication === "draft"
                ? "No additional description is included in this selection."
                : "No additional product description is published.")}
          </Text>
          <Text accessibilityRole="header" style={ui.heading}>
            Choose a variant
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Product variant"
            style={ui.row}
          >
            {product.variants.nodes.map((v) => (
              <Pressable
                key={v.id}
                accessibilityRole="radio"
                accessibilityLabel={
                  v.title + " · " + money(v.price.amountCents)
                }
                accessibilityState={{ checked: variant?.id === v.id }}
                style={[ui.chip, variant?.id === v.id && ui.selected]}
                onPress={() => setSelected(v.id)}
              >
                <Text
                  style={[ui.label, variant?.id === v.id && ui.selectedLabel]}
                >
                  {v.title} · {money(v.price.amountCents)}
                </Text>
                <Text
                  style={[ui.copy, variant?.id === v.id && ui.selectedLabel]}
                >
                  {product.publication === "draft"
                    ? "Browsing only"
                    : !v.availability.availableForSale ||
                        v.availability.currentlyNotInStock
                      ? "Unavailable"
                      : "Available online"}
                </Text>
              </Pressable>
            ))}
          </View>
          {variant ? (
            <Card appearance="storefront">
              <Text style={ui.heading}>{money(variant.price.amountCents)}</Text>
              <Text style={ui.copy}>
                {product.publication === "draft"
                  ? "Not offered for purchase in this private selection."
                  : !variant.availability.availableForSale ||
                      variant.availability.currentlyNotInStock
                    ? "This variant is currently unavailable."
                    : "Available online. Shelf stock and quantities are not confirmed."}
              </Text>
              {variant.identifiers.sku && (
                <Text style={ui.copy}>SKU: {variant.identifiers.sku}</Text>
              )}
              {variant.identifiers.barcode && (
                <Text style={ui.copy}>
                  Barcode: {variant.identifiers.barcode}
                </Text>
              )}
            </Card>
          ) : (
            <Text style={ui.copy}>
              {requestedVariant
                ? "The requested variant is not on this current page. Choose an available variant or check more variants."
                : "Select a variant to see its verified price and availability."}
            </Text>
          )}
          {product.variants.pageInfo.hasNextPage && (
            <Button
              appearance="storefront"
              label="More variants"
              onPress={() => {
                setSelected(undefined);
                setAfter(product.variants.pageInfo.endCursor ?? undefined);
              }}
            />
          )}
          {after && (
            <Button
              appearance="storefront"
              label="First variants"
              onPress={() => {
                setAfter(undefined);
                setSelected(undefined);
              }}
            />
          )}
          {resource.data?.kind === "private-product-detail" && (
            <Text style={ui.copy}>
              Catalog snapshot ·{" "}
              {new Date(resource.data.capturedAt).toLocaleDateString("en-US")} ·
              Prices may change before release.
            </Text>
          )}
          <Button
            appearance="storefront"
            label={
              product.publication === "draft"
                ? "Reload details"
                : "Refresh product"
            }
            onPress={() => {
              setImageAttempt((value) => value + 1);
              resource.reload();
            }}
          />
          <Text style={ui.copy}>Checkout is not enabled in this version.</Text>
        </>
      )}
    </Screen>
  );
}
