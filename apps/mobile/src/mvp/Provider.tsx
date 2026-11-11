import { currentObservation } from "@northside/customer-contracts/mvp";
import Constants from "expo-constants";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { MobileApi, MobileFailure } from "../api/client";
import { PublicCatalogApi } from "../api/public-catalog";
import type { BrowseApi } from "../private-preview/catalog";
import { usePrivatePreview } from "../private-preview/context";

const Context = createContext<{ api: BrowseApi | null; active: boolean }>({
  api: null,
  active: true,
});
export function MvpProvider({
  children,
  api: provided,
}: PropsWithChildren<{ api?: BrowseApi | null }>) {
  const inherited = useContext(Context);
  const privatePreview = usePrivatePreview();
  const api = useMemo(() => {
    if (provided !== undefined) return provided;
    if (privatePreview) return privatePreview.api;
    if (inherited.api) return inherited.api;
    try {
      const origin = Constants.expoConfig?.extra?.mobile?.apiOrigin;
      if (
        Constants.expoConfig?.extra?.mobile?.publicCatalogPreview === true &&
        Constants.expoConfig?.extra?.mobile?.variant === "preview" &&
        !origin
      )
        return new PublicCatalogApi();
      return origin
        ? new MobileApi(origin, fetch, undefined, undefined, {
            variant: Constants.expoConfig?.extra?.mobile?.variant,
          })
        : null;
    } catch {
      return null;
    }
  }, [provided, inherited.api, privatePreview]);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => sub.remove();
  }, []);
  return (
    <Context.Provider value={{ api, active }}>{children}</Context.Provider>
  );
}
export const useMvp = () => useContext(Context);
export type Resource<T> = {
  status: "unconfigured" | "loading" | "ready" | "error";
  data?: T;
  error?: string;
};
export function useResource<T>(
  read: (api: BrowseApi, signal: AbortSignal) => Promise<T>,
  key: string,
) {
  const { api, active } = useMvp(),
    [revision, setRevision] = useState(0),
    [state, setState] = useState<Resource<T>>({
      status: api ? "loading" : "unconfigured",
    });
  useFocusEffect(
    useCallback(() => {
      if (!api) {
        setState({ status: "unconfigured" });
        return;
      }
      if (!active) {
        setState({ status: "loading" });
        return;
      }
      let current = true,
        timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      setState({ status: "loading" });
      void read(api, controller.signal)
        .then((data) => {
          if (!current) return;
          const expiry =
            data &&
            typeof data === "object" &&
            "expiresAt" in data &&
            typeof data.expiresAt === "string"
              ? data.expiresAt
              : undefined;
          if (
            expiry &&
            (!("observedAt" in (data as object)) ||
              !currentObservation(
                data as { observedAt: string; expiresAt: string },
              ))
          )
            throw new MobileFailure("refresh_required");
          setState({ status: "ready", data });
          if (expiry)
            timer = setTimeout(
              () => {
                if (current)
                  setState({ status: "error", error: "refresh_required" });
              },
              Math.max(0, Date.parse(expiry) - Date.now()),
            );
        })
        .catch((error) => {
          if (current)
            setState({
              status: "error",
              error:
                error instanceof MobileFailure
                  ? error.code
                  : "service_unavailable",
            });
        });
      return () => {
        current = false;
        controller.abort();
        if (timer) clearTimeout(timer);
      };
      // read is an inline adapter; key deliberately captures its serializable inputs.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, active, key, revision]),
  );
  return { ...state, reload: () => setRevision((v) => v + 1) };
}
