import { useCallback, useSyncExternalStore } from "react";
import { AppState, Text } from "react-native";
import { CustomerScreen as Screen } from "../../components/CustomerScreen";
import { ActionLink, Button, Card } from "../../components/Controls";
import { StatePanel } from "../../components/StatePanel";
import { useCustomerAuth } from "../../auth/Provider";
import { storefrontUi as ui } from "../../mvp/Components";
const unavailableOnServer = () => false;
export default function WalletScreen() {
  const { state, controller } = useCustomerAuth();
  const wallet = state.wallet;
  const deadline = wallet?.status === "ready"
    ? Date.parse(wallet.observedAt) + 60000
    : null;
  // The clock is an external source. Its boolean snapshot is stable until the
  // deadline, rechecked on render/resume, and never preserves an old balance.
  const subscribe = useCallback((changed: () => void) => {
    if (deadline === null) return () => {};
    const timer = setTimeout(changed, Math.max(0, deadline - Date.now()));
    const app = AppState.addEventListener("change", changed);
    return () => { clearTimeout(timer); app.remove(); };
  }, [deadline]);
  const isFresh = useCallback(
    () => deadline !== null && Date.now() < deadline,
    [deadline],
  );
  const fresh = useSyncExternalStore(subscribe, isFresh, unavailableOnServer);
  return (
    <Screen
      eyebrow="Northside rewards"
      title="Your wallet."
      description="Your rewards and loyalty, all in one place."
    >
      {state.status !== "authenticated" ? (
        <>
          <StatePanel appearance="storefront"
            icon="wallet"
            state={{
              status: "unavailable",
              title: state.status === "unconfigured"
                ? "Wallet not connected"
                : "Sign in to view your wallet",
              message: state.status === "unconfigured"
                ? "Account services are unavailable in this preview. Your verified rewards balance and loyalty tier will appear when connected."
                : "Your rewards balance and loyalty tier are linked to your Northside customer account.",
            }}
          />
          <ActionLink appearance="storefront" href="/account" label="Visit your account" />
        </>
      ) : state.busy ? (
        <StatePanel appearance="storefront"
          icon="wallet"
          state={{
            status: "loading",
            title: "Checking your wallet",
            message: "Loading your verified customer ledger.",
          }}
        />
      ) : wallet?.status === "ready" && fresh ? (
        <>
          <Card appearance="storefront">
            <Text style={ui.heading}>
              {wallet.tier ?? "Tier not available"}
            </Text>
            <Text style={ui.heading}>
              {wallet.available.toLocaleString("en-US")} available points
            </Text>
            <Text style={ui.copy}>
              Ledger balance: {wallet.balance.toLocaleString("en-US")} · Held:{" "}
              {wallet.held.toLocaleString("en-US")}
            </Text>
            {wallet.balance < 0 && (
              <Text style={ui.copy}>Your ledger balance is under review.</Text>
            )}
          </Card>
          <Text style={ui.heading}>Rewards</Text>
          {wallet.rewards.length ? (
            wallet.rewards.map((reward) => (
              <Card appearance="storefront" key={reward.id}>
                <Text style={ui.label}>{reward.title}</Text>
                <Text style={ui.copy}>
                  {reward.pointsCost.toLocaleString("en-US")} points · read-only
                </Text>
              </Card>
            ))
          ) : (
            <Text style={ui.copy}>No active rewards were returned.</Text>
          )}
        </>
      ) : (
        <StatePanel appearance="storefront"
          icon="wallet"
          state={{
            status: "unavailable",
            title:
              wallet?.status === "unavailable" &&
              wallet.reason === "not_enrolled"
                ? "Wallet enrollment unavailable"
                : wallet?.status === "ready"
                  ? "Refresh your wallet"
                  : "Wallet not connected",
            message:
              wallet?.status === "unavailable" &&
              wallet.reason === "not_launched"
                ? "Northside loyalty has not launched. No balance or reward status is being represented as active."
                : "A current verified balance is not available. Please refresh when connected.",
          }}
        />
      )}
      {state.status === "authenticated" && (
        <Button appearance="storefront"
          secondary label="Refresh wallet"
          disabled={state.busy}
          onPress={() => {
            void controller.load();
          }}
        />
      )}
      <Text style={ui.copy}>
        Rewards are available to view when your account is connected.
      </Text>
    </Screen>
  );
}
