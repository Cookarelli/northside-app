import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { MobileApi, MobileFailure } from "../api/client";
import type { CartHandleStore } from "./controller";

export function configuredCommerceApi() {
  const c = Constants.expoConfig?.extra?.mobile;
  if (
    c?.variant !== "preview" ||
    c.publicCatalogPreview !== true ||
    c.scanCart !== true ||
    !c.commerceApiOrigin ||
    c.apiOrigin
  )
    return null;
  try {
    return new MobileApi(c.commerceApiOrigin, fetch, undefined, undefined, {
      variant: "preview",
    });
  } catch {
    return null;
  }
}
/** Device-only opaque handle. Never stores a Shopify cart key, contents, price or customer token. */
export function nativeCartStorage(
  origin: string,
  principal: string,
): CartHandleStore | undefined {
  if (Platform.OS === "web") return undefined;
  const scope = JSON.stringify(["preview", origin, principal]);
  const name = Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    scope,
  ).then((hash) => "northside.cart." + hash);
  const options: SecureStore.SecureStoreOptions = {
    keychainService: "northside.mobile.cart.v1",
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  async function available() {
    if (!(await SecureStore.isAvailableAsync()))
      throw new MobileFailure("storage_unavailable");
  }
  return {
    async get() {
      await available();
      return SecureStore.getItemAsync(await name, options);
    },
    async set(value) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(value))
        throw new MobileFailure("invalid_response");
      await available();
      await SecureStore.setItemAsync(await name, value, options);
    },
    async remove() {
      await available();
      await SecureStore.deleteItemAsync(await name, options);
    },
  };
}
