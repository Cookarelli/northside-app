import { runNotifications } from "../lib/server/notifications";
try {
  console.log(JSON.stringify(await runNotifications(25)));
  process.exit(0);
} catch {
  console.error(
    "Notification worker failed. No delivery claim; inspect durable jobs.",
  );
  process.exit(1);
}
