import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCustomerAuth } from "../auth/Provider";
import { Button } from "./Controls";
import { storefrontUi as ui } from "../mvp/Components";
export function SubmittedRequestPhoto({
  id,
  index,
}: {
  id: string;
  index: number;
}) {
  const { controller } = useCustomerAuth(),
    [uri, setUri] = useState<string | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    active = useRef(false),
    request = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
        request.current?.abort();
        setUri(null);
        setBusy(false);
      };
    }, []),
  );
  return (
    <View style={{ gap: 10 }}>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={`Submitted request photo ${index}`}
          alt={`Submitted request photo ${index}`}
          cachePolicy="none"
          contentFit="contain"
          style={{ height: 240, width: "100%" }}
          onError={() => {
            setUri(null);
            setError(true);
          }}
        />
      ) : (
        <Button
          appearance="storefront"
          disabled={busy}
          label={
            busy
              ? "Loading private request photo…"
              : `${error ? "Retry" : "View"} submitted photo ${index}`
          }
          onPress={() => {
            request.current?.abort();
            const abort = new AbortController();
            request.current = abort;
            setBusy(true);
            setError(false);
            void controller
              .serviceRequestPhoto(id, abort.signal)
              .then((value) => {
                if (active.current && !abort.signal.aborted) setUri(value);
              })
              .catch(() => {
                if (active.current && !abort.signal.aborted) setError(true);
              })
              .finally(() => {
                if (active.current && !abort.signal.aborted) setBusy(false);
              });
          }}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={ui.copy}>
          Private photograph unavailable. Sign in and retry when connected.
        </Text>
      )}
    </View>
  );
}
