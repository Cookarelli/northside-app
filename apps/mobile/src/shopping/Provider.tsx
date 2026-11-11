import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { MobileApi } from "../api/client";
import { useCustomerAuth } from "../auth/Provider";
import { useMvp } from "../mvp/Provider";
import { usePrivatePreview } from "../private-preview/context";
import { ShoppingController } from "./controller";

const Context = createContext<ShoppingController | null>(null);
export function ShoppingProvider({ children }: PropsWithChildren) {
  const { api, active } = useMvp();
  const { controller: auth } = useCustomerAuth();
  const privatePreview = usePrivatePreview();
  const identity = auth.shoppingIdentity();
  const controller = useMemo(
    () =>
      new ShoppingController(
        !privatePreview && api instanceof MobileApi
          ? (action, token, signal) =>
              auth.shoppingOn(api, action, token, signal)
          : null,
        Date.now,
        active,
      ),
    // Activity is applied below without replacing the ephemeral cart/session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, auth, identity, privatePreview],
  );
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    controller.setActive(active);
  }, [controller, active]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useShopping() {
  const controller = useContext(Context);
  if (!controller) throw new Error("Shopping context unavailable");
  return {
    controller,
    state: useSyncExternalStore(
      controller.subscribe,
      controller.snapshot,
      controller.snapshot,
    ),
  };
}
