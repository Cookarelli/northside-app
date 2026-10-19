import { prepareWebhookHandoff } from "./lib/webhook-provisioning";

try {
  if (process.argv.length !== 2) throw new Error("unexpected arguments");
  // Print paths/status only. SQL and recovery contents are deliberately private.
  console.log(JSON.stringify(prepareWebhookHandoff(process.cwd())));
} catch {
  console.error(
    "WEBHOOK_HANDOFF_NOT_PREPARED: review local files; existing values were preserved.",
  );
  process.exitCode = 1;
}
