import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { privateCommand, SetupError } from "./private-command.mjs";
await privateCommand("Owner setup", async () => {
  const id = process.env.NORTHSIDE_OWNER_AUTH_USER_ID;
  if (
    !id ||
    !process.env.AUTH_DATABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY ||
    !process.env.SUPABASE_URL
  )
    throw new SetupError(
      "Supply owner Supabase user ID and server connection settings privately.",
    );
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.admin.getUserById(id);
  if (error || (!data.user?.email_confirmed_at && !data.user?.invited_at))
    throw new SetupError(
      "Owner must be a real invited or confirmed Supabase user.",
    );
  const pool = new Pool({
    connectionString: process.env.AUTH_DATABASE_URL,
    max: 1,
  });
  try {
    const db = await pool.connect();
    try {
      await db.query("begin");
      const role = (await db.query("select current_user as role")).rows[0].role;
      if (role !== "northside_auth")
        throw new SetupError("Use the northside_auth connection.");
      await db.query(
        "select pg_advisory_xact_lock(hashtext('northside-owner-bootstrap'))",
      );
      const exists = (
        await db.query(
          "select 1 from ns.staff_memberships where tenant_id='11111111-1111-4111-8111-111111111111' and role='owner' and active",
        )
      ).rows.length;
      if (exists)
        throw new SetupError(
          "An owner already exists; use an audited administrative process to transfer ownership.",
        );
      await db.query(
        "insert into ns.staff_memberships(tenant_id,auth_user_id,role) values('11111111-1111-4111-8111-111111111111',$1,'owner')",
        [id],
      );
      await db.query("commit");
      console.log("Owner membership created for the verified user.");
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  } finally {
    await pool.end();
  }
});
