import { runBreakJobs } from "../lib/server/break-worker";
runBreakJobs(10)
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(result.failed ? 1 : 0);
  })
  .catch(() => {
    console.error(
      "Break reconciliation unavailable. Check server configuration and private job records.",
    );
    process.exit(1);
  });
