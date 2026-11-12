import { importPilotReceipts } from "../lib/server/receipt-import";
try {
  console.log(JSON.stringify(await importPilotReceipts()));
  process.exit(0);
} catch {
  console.error(
    "Receipt import unavailable. Check the reviewed migration, restricted commerce role and private configuration.",
  );
  process.exit(1);
}
