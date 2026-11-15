import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { Button } from "./Controls";
import { storefrontUi as ui } from "../mvp/Components";
type Upload = (id: string, bytes: Uint8Array) => Promise<void>;
export function RequestPhotoCapture({
  disabled,
  onBegin,
  onPending,
}: {
  disabled: boolean;
  onBegin: () => Upload;
  onPending: (pending: boolean) => void;
}) {
  const [permission, ask] = useCameraPermissions(),
    [open, setOpen] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hasPending, setHasPending] = useState(false);
  const camera = useRef<CameraView | null>(null),
    lock = useRef(false),
    generation = useRef(0),
    pending = useRef<{ id: string; bytes: Uint8Array; upload: Upload } | null>(
      null,
    );
  useFocusEffect(
    useCallback(() => {
      generation.current++;
      return () => {
        generation.current++;
        pending.current = null;
        setHasPending(false);
        lock.current = false;
        setOpen(false);
        setBusy(false);
        setReady(false);
        onPending(false);
      };
    }, [onPending]),
  );
  async function upload() {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    onPending(true);
    const g = generation.current;
    // Bind the request identity and focus epoch before asynchronous camera work.
    try {
      const send = pending.current?.upload ?? onBegin();
      if (!pending.current) {
        const picture = await camera.current?.takePictureAsync({
          base64: true,
          quality: 0.65,
        });
        if (g !== generation.current) return;
        if (!picture?.base64) throw Error("Photo capture failed. Try again.");
        const binary = atob(picture.base64);
        if (binary.length > 4194304)
          throw Error("Photo exceeds 4 MiB. Retake a smaller photo.");
        pending.current = {
          id: Crypto.randomUUID(),
          bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)),
          upload: send,
        };
        setHasPending(true);
        setOpen(false);
      }
      const item = pending.current;
      if (g !== generation.current || !item) return;
      await item.upload(item.id, item.bytes);
      if (g !== generation.current) return;
      pending.current = null;
      setHasPending(false);
      onPending(false);
    } catch (e) {
      if (g !== generation.current) return;
      setError(
        pending.current
          ? "Photo upload unconfirmed. Retry the same photo before saving your request."
          : e instanceof Error
            ? e.message
            : "Photo capture failed.",
      );
      if (!pending.current) onPending(false);
    } finally {
      if (g === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={ui.copy}>
        Private item photos (optional). Up to 10 photos, 4 MiB each. Confirmed
        uploads are attached when you save the request.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={ui.copy}>
          {error}
        </Text>
      )}
      {open && permission?.granted && (
        <CameraView
          ref={camera}
          style={{ height: 300 }}
          mode="picture"
          facing="back"
          onCameraReady={() => setReady(true)}
          onMountError={() => {
            setError(
              "Camera unavailable. Continue without an optional photo or retry.",
            );
            setOpen(false);
          }}
        />
      )}
      {open ? (
        <>
          <Button
            appearance="storefront"
            label={busy ? "Confirming private photo…" : "Capture request photo"}
            disabled={disabled || busy || !ready}
            onPress={() => void upload()}
          />
          <Button
            appearance="storefront"
            label="Close photo camera"
            disabled={busy}
            onPress={() => setOpen(false)}
          />
        </>
      ) : hasPending ? (
        <Button
          appearance="storefront"
          label={
            busy ? "Confirming private photo…" : "Retry same request photo"
          }
          disabled={disabled || busy}
          onPress={() => void upload()}
        />
      ) : (
        <Button
          appearance="storefront"
          label="Take private item photo"
          disabled={disabled || busy}
          onPress={() => {
            const g = generation.current;
            void (async () => {
              setError("");
              const granted = permission?.granted || (await ask()).granted;
              if (g !== generation.current) return;
              if (granted) {
                setReady(false);
                setOpen(true);
              } else
                setError(
                  "Camera permission was not granted. Photos are optional.",
                );
            })().catch(() => {
              if (g === generation.current)
                setError("Camera permission unavailable.");
            });
          }}
        />
      )}
    </View>
  );
}
