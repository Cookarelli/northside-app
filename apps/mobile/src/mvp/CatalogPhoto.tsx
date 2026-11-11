import { useState } from "react";
import { Image } from "expo-image";
import { View, Text, StyleSheet } from "react-native";
import {
  catalogImageV1Schema,
  type CatalogImageV1,
} from "@northside/customer-contracts";
import { colors, storefront, type Appearance } from "../theme";

type Props = {
  image: CatalogImageV1 | null;
  title: string;
  height: number;
  appearance?: Appearance;
  unavailableLabel?: string;
  attempt?: number;
};

/** Changing the source or explicitly retrying creates an independent load attempt. */
export function CatalogPhoto(props: Props) {
  return (
    <PhotoAttempt
      key={`${props.image?.url ?? "missing"}:${props.attempt ?? 0}`}
      {...props}
    />
  );
}

function PhotoAttempt({
  image,
  title,
  height,
  appearance = "default",
  unavailableLabel = "Image unavailable",
}: Props) {
  const [failed, setFailed] = useState(false);
  const parsed = catalogImageV1Schema.safeParse(image);
  const approved = parsed.success ? parsed.data : null;
  const style = [
    styles.frame,
    { height },
    appearance === "storefront" && {
      backgroundColor: storefront.colors.surface,
    },
  ];
  if (approved && !failed)
    return (
      <Image
        source={{ uri: approved.url }}
        accessibilityLabel={approved.altText?.trim() || title}
        alt={approved.altText?.trim() || title}
        contentFit="contain"
        style={style}
        onError={() => setFailed(true)}
      />
    );
  return (
    <View
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${unavailableLabel}: ${title}`}
    >
      <Text style={styles.caption}>{unavailableLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    backgroundColor: colors.canvas,
    justifyContent: "center",
    alignItems: "center",
  },
  caption: { fontSize: 14, lineHeight: 21, color: colors.muted },
});
