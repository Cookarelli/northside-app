import { NotificationsWorkspace } from "@/components/engagement-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
export default function Page() {
  return <NotificationsWorkspace sample={fixturesAllowed(process.env)} />;
}
