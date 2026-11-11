import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { MobileApi, MobileFailure } from "../api/client";
import { AuthController, type AuthPorts } from "./controller";
import { mobileVariantSchema } from "@northside/customer-contracts/mobile";

const base64url = (s: string) =>
  s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function createNativeAuth() {
  const config = Constants.expoConfig?.extra?.mobile;
  const variant = mobileVariantSchema.safeParse(config?.variant);
  let api: MobileApi | null = null;
  const returnUri =
    typeof config?.authReturnUri === "string" ? config.authReturnUri : null;
  if (
    Platform.OS !== "web" &&
    variant.success &&
    returnUri &&
    config?.apiOrigin
  ) {
    try {
      api = new MobileApi(config.apiOrigin);
    } catch {}
  }
  const scope = JSON.stringify([
    variant.success ? variant.data : "unconfigured",
    config?.apiOrigin ?? "",
  ]);
  let namespace: Promise<string> | undefined;
  const key = async (name: string) => {
    namespace ??= Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      scope,
    );
    return "northside.mobile." + (await namespace) + "." + name;
  };
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    keychainService: "northside.mobile.customer.v1",
  };
  const available = async () => {
    if (!(await SecureStore.isAvailableAsync()))
      throw new MobileFailure("storage_unavailable");
  };
  const ports: AuthPorts = {
    storage: {
      async get(name) {
        await available();
        return SecureStore.getItemAsync(await key(name), options);
      },
      async set(name, value) {
        await available();
        await SecureStore.setItemAsync(await key(name), value, options);
      },
      async remove(name) {
        await available();
        await SecureStore.deleteItemAsync(await key(name), options);
      },
    },
    async token() {
      const bytes = await Crypto.getRandomBytesAsync(32);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return base64url(btoa(binary));
    },
    async challenge(verifier) {
      return base64url(
        await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          verifier,
          { encoding: Crypto.CryptoEncoding.BASE64 },
        ),
      );
    },
    browser: {
      open: (url, redirect) =>
        WebBrowser.openAuthSessionAsync(url, redirect, {
          preferEphemeralSession: true,
        }),
      dismiss() {
        try {
          WebBrowser.dismissAuthSession();
        } catch {}
      },
    },
    now: () => Date.now(),
  };
  return new AuthController(
    api,
    api && returnUri && variant.success
      ? { variant: variant.data, returnUri }
      : null,
    ports,
  );
}
