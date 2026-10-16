# Read-only migration review — October 3, 2026

Target selected by the user: Supabase project `nrsuosydvjqovrevmych`, named `northside-app`. The coordinator reported an authenticated, healthy PostgreSQL 17.11 project with no application migrations. This review inspected the preserved repository and current Supabase documentation; it did not execute remote SQL or independently verify that hosted state.

## Apply the existing chain unchanged

Run all SQL files under `apps/customer/supabase/migrations/` in lexicographic order: `202609120001` through `202609120009`, then `20260916174953`, `20260916185139`, `20260916192111` and `20260916195007`. The final staff custody/dispatch migration is required; the earlier list in the historical deployment guide is superseded by its final staff-operations subsection. These files depend on earlier functions, constraints, tables and triggers, so execute sequentially.

Migration 001 intentionally uses `create schema ns` without `IF NOT EXISTS`: confirm the schema itself is absent, not simply empty, before first application. It creates the fixed Northside tenant/shop record, not sample customers or an owner. Migration 002 requires the Supabase-managed `storage.buckets` and `storage.objects` tables plus `anon`/`authenticated` roles. It creates the private `northside-private` bucket with a 5 MiB upload limit and the specific MIME allowlist, plus a restrictive client-denial policy. It must not be skipped or weakened to obtain a green run. Existing storage bucket configuration would be updated for this exact name, so inspect it first.

Use the selected project's migration-owner connection only. The established runner at `apps/customer/scripts/migrate.mjs` obtains advisory lock `1212092026`, hashes each original file's UTF-8 source with SHA-256, strips only line-start `begin;`/`commit;`, executes each migration transactionally and records:

```sql
create schema if not exists ns_migrations;
create table if not exists ns_migrations.applied (
  name text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
```

The ledger `name` is the complete original basename, including `.sql`. The hash includes the original transaction markers and exact newlines. When applying through Supabase MCP, put the matching ledger insert in the same successful transaction as the original SQL. Supabase's own migration history does not replace this application ledger. Do not add an applied row after failed DDL or reformat applied source files. A later `pnpm db:migrate` must skip these unchanged entries and reject mismatched hashes.

## Roles and environment separation

The legacy chain creates these `NOLOGIN NOSUPERUSER NOBYPASSRLS` roles:

| Role                   | Migration | Private application variable |
| ---------------------- | --------- | ---------------------------- |
| `northside_runtime`    | 001       | `DATABASE_URL`               |
| `northside_auth`       | 001       | `AUTH_DATABASE_URL`          |
| `northside_commerce`   | 003       | `COMMERCE_DATABASE_URL`      |
| `northside_loyalty`    | 006       | `LOYALTY_DATABASE_URL`       |
| `northside_engagement` | 009       | `ENGAGEMENT_DATABASE_URL`    |

Schema application alone does not provision usable runtime logins. Set independent random LOGIN passwords through private operator setup and use verified TLS/pooler connection details. The established server checks `current_user` equals the exact role and refuses superuser/BYPASSRLS connections. Do not solve runtime permission failures by using `postgres`, migration credentials, a Supabase secret key as a SQL credential or broad role memberships. [Supabase role guidance](https://supabase.com/docs/guides/database/postgres/roles).

Keep `ns`, `ns_migrations` and `northside_private` outside exposed Data API schemas. Migration 001 revokes public schema access and enables RLS; subsequent migrations add their own grants/policies. The privileged private-Storage API credential bypasses RLS, so the server must continue authorizing the corresponding owner-scoped database record before reading or writing storage objects. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

The separate new `northside_private.app_state` migration uses `northside_customer_server` and `northside_control_server`, restricted respectively to commerce/staff and control/operator aggregates. Their credentials must remain separate from the five legacy roles and each other. `CUSTOMER_DATABASE_URL` for the new aggregate adapter cannot replace the original app's `DATABASE_URL` or `COMMERCE_DATABASE_URL`. No role should inherit across these boundaries.

## Verification after application

Read back all thirteen `ns_migrations.applied` names/hashes and compare to the original files. Confirm the private bucket is nonpublic, its restrictive policy exists, all `ns` tables have RLS, expected grants match each role and public/anon/authenticated cannot use the private application schemas. Run Supabase security advisors and review their output; do not broadly grant access to clear a warning. Test each actual runtime login's identity and grants over the intended connection/pooler before installing it in hosting.

Run the existing hosted acceptance matrix: two owned-customer contexts and another tenant, invited staff roles, active-membership revocation, private file access, actual stored-byte readback, approval/dispatch concurrency and reusable pooled connections with transaction-local context. Schema success alone does not prove any of those behaviors. The owner bootstrap must use a real independently invited/confirmed Supabase user; never seed a default owner. No actual invitation/email is part of migration application.

The current [Supabase changelog](https://supabase.com/changelog) describes PostgreSQL 17.11 changes involving ltree, legacy pgcrypto PGP ciphers, btree_gist floating indexes and custom operators. None of those constructs appears in this migration chain, and this is a fresh target; no related migration rewrite is indicated by this static review. Hosted execution/advisors still determine compatibility.

Keep real purchase, loyalty, retail pickup, email and push gates disabled. Migration application does not install Shopify integrations, verify OAuth, approve a public domain, provision secrets into Vercel, start a worker or authorize deployment. Database backups do not contain private Storage object bytes; preserve both once actual data exists.
