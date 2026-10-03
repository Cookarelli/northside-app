import { runOrderJobs } from "../lib/server/order-jobs";
try {
  console.log(JSON.stringify(await runOrderJobs(10)));
  process.exit(0);
} catch {
  console.error(
    "Order worker unavailable. Check private configuration and database access.",
  );
  process.exit(1);
}
