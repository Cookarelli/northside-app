import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
it("runs actual migration and denies browser and cross-app roles", async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated;");
  await db.exec(
    readFileSync(
      "supabase/migrations/20261003145016_initial_private_state.sql",
      "utf8",
    ),
  );
  await db.exec(
    "set role northside_control_server; insert into northside_private.app_state(namespace,state) values ('control','{}'),('auth_operator','{}');",
  );
  await expect(
    db.exec(
      "insert into northside_private.app_state(namespace,state) values ('commerce','{}')",
    ),
  ).rejects.toThrow(/row-level security/);
  await db.exec(
    "reset role; set role northside_customer_server; insert into northside_private.app_state(namespace,state) values ('commerce','{}'),('auth_staff','{}');",
  );
  expect(
    (
      await db.query(
        "select namespace from northside_private.app_state order by namespace",
      )
    ).rows,
  ).toEqual([{ namespace: "auth_staff" }, { namespace: "commerce" }]);
  await expect(
    db.exec(
      "update northside_private.app_state set namespace='control' where namespace='commerce'",
    ),
  ).rejects.toThrow(/row-level security/);
  await db.exec("reset role; set role anon");
  await expect(
    db.query("select * from northside_private.app_state"),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role; set role authenticated");
  await expect(
    db.query("select * from northside_private.app_state"),
  ).rejects.toThrow(/permission denied/);
  await db.close();
}, 30000);
