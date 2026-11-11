import { useState } from "react";
import { Text } from "react-native";
import { openBrowserAsync } from "expo-web-browser";
import { publicLinkSchema } from "@northside/customer-contracts/mvp";
import { Button } from "../components/Controls";
import { ui, storefrontUi } from "./Components";
import type { Appearance } from "../theme";
export function ExternalAction({
  url,
  label,
  appearance = "default",
}: {
  url: string | null;
  label: string;
  appearance?: Appearance;
}) {
  const [failed, setFailed] = useState(false);
  const copy = appearance === "storefront" ? storefrontUi.copy : ui.copy;
  if (!url)
    return (
      <Text style={copy}>{label} is awaiting company publication.</Text>
    );
  return (
    <>
      <Button
        appearance={appearance}
        label={label}
        onPress={() => {
          if (!publicLinkSchema.safeParse(url).success) {
            setFailed(true);
            return;
          }
          void openBrowserAsync(url).catch(() => setFailed(true));
        }}
      />
      {failed && (
        <Text accessibilityRole="alert" style={copy}>
          This link could not be opened. Please try again.
        </Text>
      )}
    </>
  );
}
