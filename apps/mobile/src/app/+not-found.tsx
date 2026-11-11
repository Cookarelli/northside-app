import { ActionLink } from "../components/Controls";
import { Screen } from "../components/Screen";
import { StatePanel } from "../components/StatePanel";

export default function NotFoundScreen() {
  return (
    <Screen eyebrow="Northside" title="Let’s get you back.">
      <StatePanel
        icon="home"
        state={{
          status: "empty",
          title: "Page not found",
          message: "This destination isn’t part of the customer app.",
        }}
      />
      <ActionLink href="/" label="Go to Home" />
    </Screen>
  );
}
