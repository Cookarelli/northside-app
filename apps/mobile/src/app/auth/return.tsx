import { ActionLink } from "../../components/Controls";
import { Screen } from "../../components/Screen";
import { Redirect } from "expo-router";
import { useCustomerAuth } from "../../auth/Provider";
// Deep links are consumed once by the controller, never rendered or logged.
export default function AuthReturn() {
  const { controller, state } = useCustomerAuth();
  if (state.status === "authenticated" && state.account)
    return <Redirect href={controller.accountDestination()} />;
  return (
    <Screen
      eyebrow="Northside"
      title="Return to your account."
      description="Your sign-in result is available in Account."
    >
      <ActionLink href="/account" label="Open Account" />
    </Screen>
  );
}
