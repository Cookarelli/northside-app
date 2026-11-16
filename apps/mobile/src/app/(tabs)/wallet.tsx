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
      eyebrow="Northside Collectibles"
      title="Your wallet."
      description="Your rewards, Northside Cash and consignment proceeds."
    >
      <Text accessibilityRole="header" style={ui.heading}>Northside Rewards</Text>
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
                ? "Northside loyalty has not launched. We’ll post earning and redemption details here when the program opens."
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
      <Card appearance="storefront">
        <Text accessibilityRole="header" style={ui.heading}>Membership tiers</Text>
        <Text style={ui.copy}>Rookie · Vet · HOF · GOAT</Text>
      </Card>
      <Card appearance="storefront">
        <Text accessibilityRole="header" style={ui.heading}>Card advances</Text>
        <Text style={ui.copy}>
          For a card in consignment or grading, you can ask for an advance in
          Northside Cash store credit. Staff will review your card and explain any offer.
        </Text>
        <ActionLink appearance="storefront" href={{ pathname: "/service-requests", params: { topic: "advance" } }} label="Ask about a card advance" />
      </Card>
      <Card appearance="storefront">
        <Text accessibilityRole="header" style={ui.heading}>Consignment proceeds</Text>
        <Text style={ui.copy}>Follow your card in My Cards. Staff can confirm any sale proceeds and payout.</Text>
        <ActionLink appearance="storefront" secondary href={{ pathname: "/my-cards", params: { service: "consignment" } }} label="View my consigned cards" />
      </Card>
      <Card appearance="storefront">
        <Text accessibilityRole="header" style={ui.heading}>Northside Cash</Text>
        <Text style={ui.copy}>Northside Cash is store credit at Northside Collectibles. Balances are unavailable in this Wallet.</Text>
      </Card>
    </Screen>
  );
}
