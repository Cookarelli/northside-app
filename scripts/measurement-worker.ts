import { runMeasurements } from "../lib/server/measurement-worker";
try {
  console.log(JSON.stringify(await runMeasurements(25)));
  process.exit(0);
} catch {
  console.error(
    "Measurement worker failed. Inspect durable jobs; no purchase inferred.",
  );
  process.exit(1);
}
