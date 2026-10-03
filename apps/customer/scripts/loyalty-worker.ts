import { runLoyaltyJobs } from "../lib/server/loyalty-worker";
try {
  console.log(JSON.stringify(await runLoyaltyJobs(10)));
  process.exit(0);
} catch {
  console.error(
    "Loyalty worker unavailable. Check private configuration and durable jobs.",
  );
  process.exit(1);
}
