import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { CustomerScreen as Screen } from "../components/CustomerScreen";
import { ActionLink, Button, Card } from "../components/Controls";
import { useCustomerAuth } from "../auth/Provider";
import { useResource } from "../mvp/Provider";
import { ExternalAction } from "../mvp/ExternalAction";
import { ResourceState, storefrontUi as ui } from "../mvp/Components";
export default function PrivacyScreen() {
  const { state, controller } = useCustomerAuth(),
    [typed, setTyped] = useState({ key: "", value: "" });
  const customerKey = state.account
    ? state.account.customer.id + ":" + state.account.sessionExpiresAt
    : "";
  const confirmation = typed.key === customerKey ? typed.value : "";
  const setConfirmation = (value: string) =>
    setTyped({ key: customerKey, value });
  const info = useResource((api, signal) => api.info(signal), "privacy-info");
  return (
    <Screen
      eyebrow="Your information"
      title="Privacy & account deletion."
      description="Control access to your Northside customer data."
    >
      <ActionLink appearance="storefront" href="/account" label="Back to Account" secondary />
      <Card appearance="storefront">
        <Text style={ui.heading}>Your privacy</Text>
        <Text style={ui.copy}>
          Shopify manages your customer identity. Northside uses verified
          customer ownership to show orders and services. Private records are
          not available offline. Northside does not add first-party analytics,
          advertising or notifications in this version. This explanation does
          not replace the company privacy policy.
        </Text>
        <Text style={ui.copy}>
          Android scanning uses Google ML Kit. Google documents collection of
          device, installation and diagnostic data by this SDK. Camera images
          are processed on your device; Northside sends the scanned code to its
          backend to find a verified product. Manual code lookup is also available.
        </Text>
        <ExternalAction appearance="storefront"
          url="https://developers.google.com/ml-kit/terms"
          label="Read Google scanner privacy information"
        />
      </Card>
      <ResourceState appearance="storefront"
        resource={info}
        title="Privacy information"
        icon="account"
      />
      {info.data && (
        <>
          <ExternalAction appearance="storefront"
            url={info.data.links.privacy}
            label="Read Northside privacy policy"
          />
          <ExternalAction appearance="storefront"
            url={info.data.links.deletion}
            label="Account deletion web access"
          />
          <ExternalAction appearance="storefront"
            url={info.data.links.support}
            label="Contact Northside support"
          />
        </>
      )}
      <Text style={ui.heading}>Request account deletion</Text>
      <Text style={ui.copy}>
        A deletion request starts a review of your account and associated data.
        It does not mark your account deleted immediately. Orders, legal records
        and active grading or consignment obligations may require retention
        under the company policy. You will be signed out after your request is
        recorded. Deletion fulfillment and timing require Northside
        confirmation.
      </Text>
      {state.message === "deletion_requested" && (
        <Text accessibilityRole="alert" style={ui.copy}>
          Your deletion request was recorded. Processing is pending; your
          account has not yet been deleted.
        </Text>
      )}
      {state.status === "authenticated" ? (
        <>
          {state.deletion?.request && (
            <Card appearance="storefront">
              <Text style={ui.label}>
                Recorded request status: {state.deletion.request.status}
              </Text>
              <Text style={ui.copy}>
                Requested{" "}
                {new Date(
                  state.deletion.request.createdAt,
                ).toLocaleDateString()}
              </Text>
            </Card>
          )}
          <View style={ui.row}>
            <Text style={ui.label}>Type DELETE MY ACCOUNT to confirm</Text>
            <TextInput
              accessibilityLabel="Account deletion confirmation"
              value={confirmation}
              onChangeText={setConfirmation}
              autoCorrect={false}
              maxLength={30}
              style={ui.input}
            />
            <Button appearance="storefront"
              label="Request account deletion"
              disabled={confirmation !== "DELETE MY ACCOUNT" || state.busy}
              onPress={() => {
                if (state.account)
                  void controller.requestDeletion({
                    customerId: state.account.customer.id,
                    sessionExpiresAt: state.account.sessionExpiresAt,
                  });
                setConfirmation("");
              }}
            />
          </View>
          {state.message && state.message !== "deletion_requested" && (
            <Text accessibilityRole="alert" style={ui.copy}>
              The request could not be confirmed. You may need to sign in again
              to verify a recent login. If the connection failed, refresh
              request status before retrying.
            </Text>
          )}
        </>
      ) : (
        <ActionLink appearance="storefront"
          href="/account"
          label="Sign in to request account deletion"
        />
      )}
    </Screen>
  );
}
