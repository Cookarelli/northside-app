import { StyleSheet, Text } from "react-native";
import { ActionLink, Button, Card } from "../../components/Controls";
import { CustomerScreen as Screen } from "../../components/CustomerScreen";
import { StatePanel } from "../../components/StatePanel";
import { useCustomerAuth } from "../../auth/Provider";
import { useResource } from "../../mvp/Provider";
import { ExternalAction } from "../../mvp/ExternalAction";
import { storefront } from "../../theme";

const messages: Record<string, string> = {
  cancelled: "Sign-in was cancelled. You can try again.",
  offline:
    "Northside could not be reached. Check your connection and try again.",
  timeout: "Northside took too long to respond. Please try again.",
  logged_out:
    "You are signed out on this device. The browser may still remember your Shopify account.",
  storage_unavailable:
    "Secure device storage is unavailable. Sign-in cannot continue safely.",
  invalid_callback:
    "This sign-in return could not be verified. Start sign-in again.",
  session_expired: "Your session ended. Please sign in again.",
  reauthentication_required: "Please sign in again to continue.",
};
export default function AccountScreen() {
  const { controller, state } = useCustomerAuth();
  const info = useResource((api, signal) => api.info(signal), "account-info");
  const signedIn = state.status === "authenticated",
    waiting = state.status === "authenticating" || state.status === "booting";
  return (
    <Screen
      eyebrow="Your Northside"
      title="One collecting journey."
      description="Your account, orders and Northside services."
    >
      {state.status === "unconfigured" ? (
        <>
          <StatePanel
            appearance="storefront"
            icon="account"
            state={{
              status: "unavailable",
              title: "Account access unavailable",
              message:
                "Customer sign-in is not available here yet. Your account details stay private.",
            }}
          />
          <Button
            appearance="storefront"
            label="Sign-in unavailable"
            disabled
          />
        </>
      ) : waiting ? (
        <>
          <StatePanel
            appearance="storefront"
            icon="account"
            state={{
              status: "loading",
              title:
                state.status === "booting"
                  ? "Checking your session"
                  : "Continue in your browser",
              message:
                "Use your existing Shopify customer account. Return here when sign-in finishes.",
            }}
          />
          {state.status === "authenticating" && (
            <Button
              appearance="storefront"
              label="Cancel sign-in"
              onPress={() => {
                void controller.logout();
              }}
            />
          )}
        </>
      ) : !signedIn ? (
        <Button
          appearance="storefront"
          label="Sign in with Shopify"
          onPress={() => {
            void controller.login();
          }}
        />
      ) : null}
      {state.message && (
        <Text accessibilityRole="alert" style={styles.copy}>
          {messages[state.message] ??
            "Your account could not be loaded safely. Please try again or sign in again."}
        </Text>
      )}
      {state.logoutConfirmed === false &&
        state.localCredentialsCleared === true && (
          <Text style={styles.copy}>
            Server sign-out could not be confirmed. Local credentials were
            cleared; the server session remains bounded by its expiry.
          </Text>
        )}
      {signedIn && (
        <>
          <Card appearance="storefront">
            <Text accessibilityRole="header" style={styles.title}>
              {state.account?.customer.firstName
                ? `Hello, ${state.account.customer.firstName}`
                : "Your customer account"}
            </Text>
            {state.account?.customer.email && (
              <Text style={styles.copy}>{state.account.customer.email}</Text>
            )}
            <Button
              appearance="storefront"
              label="Refresh account"
              disabled={state.busy}
              onPress={() => {
                void controller.load();
              }}
            />
          </Card>
          {state.busy && (
            <StatePanel
              appearance="storefront"
              icon="account"
              state={{
                status: "loading",
                title: "Loading your account",
                message: "Fetching customer-owned records securely.",
              }}
            />
          )}
          {state.orders && (
            <Card appearance="storefront">
              <Text accessibilityRole="header" style={styles.title}>
                Order history
              </Text>
              {state.orders.orders.length === 0 ? (
                <Text style={styles.copy}>
                  No orders were returned for this account.
                </Text>
              ) : (
                state.orders.orders.map((order) => (
                  <Text key={order.id} style={styles.copy}>
                    {order.name} ·{" "}
                    {new Date(order.processedAt).toLocaleDateString()} ·{" "}
                    {order.total.currencyCode}{" "}
                    {(order.total.amountCents / 100).toFixed(2)} ·{" "}
                    {order.financialStatus ?? "Status unavailable"}
                  </Text>
                ))
              )}
              {state.orders.pageInfo.hasNextPage && (
                <Button
                  appearance="storefront"
                  label="Load more orders"
                  disabled={state.busy}
                  onPress={() => {
                    void controller.load(
                      state.orders?.pageInfo.endCursor ?? undefined,
                    );
                  }}
                />
              )}
            </Card>
          )}
          {state.services && (
            <Card appearance="storefront">
              <Text accessibilityRole="header" style={styles.title}>
                My Cards
              </Text>
              {state.services.items.length === 0 ? (
                <Text style={styles.copy}>
                  No grading or consignment records were returned for this
                  account.
                </Text>
              ) : (
                state.services.items.map((item) => (
                  <Text key={item.id} style={styles.copy}>
                    {item.title} · {item.kind} · {item.status}
                  </Text>
                ))
              )}
            </Card>
          )}
          <ActionLink
            appearance="storefront"
            href="/my-cards"
            label="Open My Cards — grading & consignment"
          />
          <Button
            appearance="storefront"
            secondary
            label="Sign out"
            onPress={() => {
              void controller.logout();
            }}
          />
          <Text style={styles.copy}>
            To switch accounts, sign out here first. If Shopify remembers your
            previous account, sign out in the system browser before choosing
            another. Private iOS browser sessions are requested when supported.
          </Text>
        </>
      )}
      {state.breaks && (
        <Card appearance="storefront">
          <Text style={styles.title}>Your breaks</Text>
          {state.breaks.items.length ? (
            state.breaks.items.map((item) => (
              <Text key={item.id} style={styles.copy}>
                {item.title} · {item.status} · {item.quantity} spots ·{" "}
                {item.source === "legacy"
                  ? "Legacy payment record"
                  : "Shopify order record"}
              </Text>
            ))
          ) : (
            <Text style={styles.copy}>
              No break records were returned for this account.
            </Text>
          )}
        </Card>
      )}
      {state.extraError && signedIn && (
        <Text style={styles.copy}>
          Some wallet, break or privacy-request information could not be
          verified. Refresh when connected.
        </Text>
      )}
      <ActionLink
        appearance="storefront"
        href="/privacy"
        label="Privacy & account deletion"
        secondary
      />
      {info.data && (
        <ExternalAction
          appearance="storefront"
          url={info.data.links.support ?? info.data.store.website}
          label={
            info.data.links.support
              ? "Contact Northside support"
              : "Visit Northside website"
          }
        />
      )}
      <ActionLink
        appearance="storefront"
        href="/"
        label="Back to Home"
        secondary
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  title: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "700",
    fontFamily: storefront.fontFamily,
    color: storefront.colors.ink,
  },
  copy: {
    ...storefront.type.body,
    fontFamily: storefront.fontFamily,
    color: storefront.colors.body,
  },
});
