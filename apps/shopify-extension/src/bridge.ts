/** Prototype of documented POS 2026-07 APIs. Not installed or enabled against a store. */
export interface PosApi {
  session: { getSessionToken(): Promise<string | undefined> };
  cart: {
    current: {
      value: {
        lineItems: unknown[];
        properties: Record<string, string>;
        editable?: boolean;
      };
    };
    addLineItem(variantId: number, quantity: number): Promise<string>;
    addCartProperties(properties: Record<string, string>): Promise<void>;
  };
  scanner: {
    showCameraScanner(): void;
    hideCameraScanner(): void;
    scannerData: {
      current: {
        subscribe(callback: (scan: { data?: string }) => void): () => void;
      };
    };
  };
}
export type ValidatedHandoff = {
  reference: string;
  version: number;
  paymentReference: string;
  lines: { variantId: number; quantity: number }[];
};
export interface HandoffBackend {
  /** Backend verifies the Shopify ID token, allowed installation/location, expiry, basket version and current Storefront availability/prices before an atomic one-time claim. */
  claim(reference: string, sessionToken: string): Promise<ValidatedHandoff>;
  /** Record a completed import; an absent acknowledgement is uncertain and must never trigger re-import. */
  imported(
    reference: string,
    version: number,
    lineIds: string[],
    sessionToken: string,
  ): Promise<void>;
}
export function parseHandoff(value: string, appOrigin: string) {
  const url = new URL(value);
  if (
    url.origin !== new URL(appOrigin).origin ||
    url.pathname !== "/in-store/staff" ||
    url.username ||
    url.password
  )
    throw new Error("Scan a Northside counter handoff.");
  const reference = url.searchParams.get("handoff");
  if (!reference || !/^[A-Za-z0-9_-]{32}$/.test(reference))
    throw new Error("Invalid handoff reference.");
  return reference;
}
export function createPosBridge(
  api: PosApi,
  backend: HandoffBackend,
  appOrigin: string,
) {
  const seen = new Set<string>();
  let busy = false;
  return {
    async import(value: string) {
      const reference = parseHandoff(value, appOrigin);
      if (busy || seen.has(reference))
        throw new Error(
          "Import already attempted. Check the existing POS cart and reconcile before retrying.",
        );
      if (
        api.cart.current.value.lineItems.length ||
        api.cart.current.value.properties._northside_reference ||
        api.cart.current.value.editable === false
      )
        throw new Error(
          "Start with an empty editable POS cart. Existing staff work will not be cleared.",
        );
      busy = true;
      try {
        const jwt = await api.session.getSessionToken();
        if (!jwt) throw new Error("Shopify app permission is required.");
        // Once the backend could have claimed this reference, response loss is uncertain. No automatic retry.
        seen.add(reference);
        const handoff = await backend.claim(reference, jwt);
        if (
          handoff.reference !== reference ||
          !handoff.paymentReference ||
          !handoff.lines.length ||
          handoff.lines.some(
            (l) =>
              !Number.isSafeInteger(l.variantId) ||
              l.variantId <= 0 ||
              !Number.isInteger(l.quantity) ||
              l.quantity <= 0,
          )
        )
          throw new Error(
            "Invalid validated handoff. Reconciliation required.",
          );
        await api.cart.addCartProperties({
          _northside_reference: handoff.paymentReference,
          _northside_basket_version: String(handoff.version),
        });
        const lineIds: string[] = [];
        for (const line of handoff.lines) {
          const id = await api.cart.addLineItem(line.variantId, line.quantity);
          if (!id)
            throw new Error(
              "POS declined an item. Keep this cart for staff reconciliation; do not scan again.",
            );
          lineIds.push(id);
        }
        await backend.imported(reference, handoff.version, lineIds, jwt);
        return {
          lineIds,
          message:
            "Review quantities and POS prices, make staff adjustments, then complete payment in Shopify POS. Northside waits for an authenticated order event.",
        };
      } finally {
        busy = false;
      }
    },
    scan(onScan: (value: string) => void) {
      const unsubscribe = api.scanner.scannerData.current.subscribe((scan) => {
        if (scan.data) {
          api.scanner.hideCameraScanner();
          onScan(scan.data);
        }
      });
      api.scanner.showCameraScanner();
      return () => {
        unsubscribe();
        api.scanner.hideCameraScanner();
      };
    },
  };
}
