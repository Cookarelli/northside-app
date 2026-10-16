# Trigger function search-path hardening

Additive migration: `apps/customer/supabase/migrations/20261003152308_pin_trigger_function_search_paths.sql`.

The coordinator's authenticated hosted Supabase advisor identified twelve trigger functions without a fixed search path. Each reviewed definition has an exact zero-argument signature, returns `trigger`, and uses default SECURITY INVOKER behavior. Its application table, type and function references are already qualified with `ns`; remaining helper calls are PostgreSQL builtins. The migration uses twelve precise `ALTER FUNCTION ns.name() SET search_path = pg_catalog, ns` statements in one transaction. It changes no function body, argument/result type, owner, ACL, security mode, trigger binding, application row, economic rule or authorization schema. The latest replacement of `snapshot_exam_photos()` from the staff custody migration is preserved, including exclusion of returned photographs from original exam snapshots.

The filename was generated locally with the already installed Supabase CLI 2.117.0 using `supabase migration new pin_trigger_function_search_paths`, then the file was moved into the established customer migration directory. Original thirteen migration files and checksums were not edited. PostgreSQL supports this function-local configuration change through [ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html).

Executed local checks:

```sh
node --conditions=react-server --import tsx --test tests/migration-search-path.test.ts tests/release.test.ts
```

All three tests passed in an isolated copy of the preserved customer application with the additive migration present:

- Full original chain plus hardening applies with no sample customers, balances, orders or streams; private bucket and restricted roles remain intact.
- Focused catalog comparison proves all twelve exact signatures, bodies, owners, grants and invoker settings are unchanged while all twelve `proconfig` values contain `search_path=pg_catalog, ns`; replaying the ALTER statements preserves those invariants.
- Adversarial caller search paths cannot replace `to_jsonb` in the reward-definition guard or `current_setting` in the grading audit source trigger. Allowed reward activation changes still work; immutable reward identity and append-only ledger updates remain rejected. Existing isolated backup/restore check also passes.

This is local SQL evidence. No remote SQL was executed by the builder. The coordinator should apply the new file after the original thirteen migrations, record its exact original-source SHA-256 in `ns_migrations.applied` atomically with the change, read back the twelve function configurations and rerun hosted security advisors. No database password, private object, live customer action or authorization role changes are needed for this migration.
