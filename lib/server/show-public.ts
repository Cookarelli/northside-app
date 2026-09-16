import "server-only";
import { headers } from "next/headers";
import { fixturesAllowed } from "../policy.mjs";
import { transaction, type Sql } from "./db";
import { AccessError } from "./security";
export async function showRead<T>(
  fn: (db: Sql, sample: boolean) => Promise<T>,
) {
  const sample = fixturesAllowed(process.env);
  if (sample) {
    const h = await headers(),
      host = h.get("host") || "";
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host))
      throw new AccessError(404, "not_found");
    const { engagementPreview, engagementSampleRun } =
      await import("./engagement-preview");
    const { f } = await engagementPreview(
      new Request("http://" + host + "/", { headers: { host } }),
    );
    return engagementSampleRun(f, (db) => fn(db, true));
  }
  return transaction("engagement", (db) => fn(db, false));
}
