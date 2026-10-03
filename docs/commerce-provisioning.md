# Operator-only pilot database provisioning

This helper is for the already migrated, dedicated Supabase project **nrsuosydvjqovrevmych**. It does not create roles/schema, grant permissions, configure hosted applications, bootstrap staff, send invitations, or configure a worker. Default execution is read-only. No hosted provisioning was executed while implementing or testing it.

## Private input and commands

From the repository root, the helper reads only the ignored `.runtime/pilot/operator.env`. The file must be a regular, single-link file owned by the current user with mode 0600. Its `.runtime` and `pilot` directories must be owned by the current user with mode 0700; symlinked directories/files are refused. Correct these permissions deliberately if the read-only check reports `UNSAFE_FILE`. Do not put the operator file in a project deployment or worker environment.

Privately enter `MIGRATION_DATABASE_URL` using the new project's **Connect → Session pooler** URL. It must have:

- Username exactly `postgres.nrsuosydvjqovrevmych`, port 5432 and database `postgres`.
- A normal Supabase shared-pooler hostname under `.pooler.supabase.com`. Its region/provider comes from the actual Connect panel; the helper does not invent one.
- A percent-encoded password and the sole query parameter `sslmode=verify-full`.

The driver receives explicit host/user/password/database/TLS options rather than interpreting arbitrary connection-string options. Certificate and hostname verification are required. `require`, `prefer`, `disable`, duplicate parameters, host/user overrides, certificate-path query options, direct/transaction-pooler URLs and `NODE_TLS_REJECT_UNAUTHORIZED=0` are rejected. If certificate validation fails, resolve the actual trusted CA/connection setup; never disable validation to continue.

Optional database-provisioning input names: `SUPABASE_SESSION_POOLER_HOST` (an additional exact hostname pin; blank means no extra pin), `APP_ORIGIN`, `CUSTOMER_ORIGIN`, `CONTROL_ORIGIN` (exact registered HTTPS origins), and `SUPABASE_PUBLISHABLE_KEY`. Existing environment values are not silently imported. No command-line argument contains a credential.

The shared operator file may also retain these exact unrelated inputs: `SUPABASE_SECRET_KEY`, `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`, `SHOPIFY_CUSTOMER_CLIENT_ID`, `SHOPIFY_CUSTOMER_CLIENT_SECRET`, `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_ADMIN_TOKEN_EXPIRES_AT`, and `NORTHSIDE_OWNER_AUTH_USER_ID`. The parser discards them before database configuration is prepared: they never enter recovery, application files, SQL or command output. It does not validate or use them to configure Shopify, provision an owner, or bootstrap staff. All other names, including `NEXT_PUBLIC_*` and arbitrary role URLs, are rejected.

```sh
# Validate private input, TLS-connected migration identity, schemas and roles.
# Read-only: does not generate credentials or change the database.
node --import tsx scripts/provision-pilot.ts

# Only after reviewing the check and explicitly choosing this operator action:
node --import tsx scripts/provision-pilot.ts --provision
```

Absent/empty input prints only `Missing: MIGRATION_DATABASE_URL`. Other failures print a fixed safe code without connection strings, passwords, provider/driver errors or stack traces. The command exits nonzero on failure. Do not add verbose driver debugging or paste private files into chat.

## Provisioning and recovery behavior

The existing five roles are `northside_runtime`, `northside_auth`, `northside_commerce`, `northside_loyalty`, `northside_engagement`. The new aggregate roles are `northside_customer_server` and `northside_control_server`. All seven must already exist without superuser, create-database, create-role, replication, bypass-RLS, inherited role membership or a finite credential expiry. The two aggregate roles must already have LOGIN. Any unexpected role configuration stops the helper; it never grants or repairs privileges.

The connected SQL identities must both be `postgres`, the database must be `postgres`, and both `ns` and `northside_private` schemas must exist. Reading `pg_roles.rolpassword` would be misleading because it is masked, so passwordless state is checked through `pg_catalog.pg_authid`. If the real pooler connection lacks that visibility, the helper stops; success through the management connector alone does not establish this privilege.

For the explicit provision action:

1. Read current role state. Existing passwords require an existing, matching recovery file; otherwise stop without changing them or fabricating replacement credentials.
2. Generate independent 256-bit random passwords for each role, a separate operator password and a 32-byte session-encryption key. Write `.runtime/pilot/recovery.json` with exclusive creation and mode 0600; fsync the file and its private directory **before** beginning role changes. The recovery file contains no migration URL/password.
3. Existing recovery is validated and reused, never overwritten. On every provision run, including retries after a failed flush, the helper checks saved bytes and fsyncs the validated recovery file descriptor and private directory before opening the role-change transaction. Existing scoped files must be identical to the prepared content; different files are preserved and the operation stops.
4. In one database transaction, acquire a DDL-conflicting `SHARE ROW EXCLUSIVE` lock on `pg_catalog.pg_authid`, then recheck every role. This closes the check/ALTER race with another operator changing a password. A helper-only advisory lock would not protect that race.
5. Set passwords **only where currently null**. Existing SCRAM verifiers must match the saved recovery secret; a mismatching or unsupported existing verifier stops the transaction. Enable LOGIN for the original five roles as needed. No role is created, no scope or permission is granted, and no existing password is rotated.
6. Re-read the catalog and verify all seven LOGIN/password results before commit. SQL ALTER statements contain locally derived SCRAM-SHA-256 verifiers, not plaintext passwords. Database SQL logs may still contain credential verifiers and must remain private; the helper does not disable auditing.
7. After commit, exclusively write missing scoped files and verify existing ones are unchanged. Recovery remains available if commit acknowledgment or file writing fails.

**Hosted privilege limit:** whether Supabase's actual `postgres` pooler role can lock this system catalog is unverified. If SELECT/LOCK is denied, the helper fails closed before any ALTER. Keep recovery and stop. An operator must use a supported appropriately privileged session or a separately reviewed provisioning procedure for this exact project. Do not grant catalog permissions, remove the lock, infer null passwords from masked values, or replace existing passwords to bypass the failure.

For any uncertain result, preserve `recovery.json` and rerun the read-only check first. Repeating `--provision` with the same valid recovery is idempotent: matching existing passwords are reused and only missing state is completed. Losing recovery while passwords exist requires a separately reviewed credential-recovery operation; this helper will not rotate them. Never delete recovery merely to make the command proceed.

## Scoped output

All files remain ignored, owner-only mode 0600, and are never automatically loaded or uploaded:

| File            | Credentials it receives                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `customer.env`  | Original runtime/auth/commerce/engagement role URLs, the new **customer** aggregate URL/scope, session-encryption key, fixed new Supabase URL and explicitly supplied customer origins/publishable key |
| `control.env`   | Only the new **control** aggregate URL/scope, independent random `OPERATOR_PASSWORD`, and supplied control origin                                                                                      |
| `loyalty.env`   | Only `LOYALTY_DATABASE_URL` for the original loyalty role                                                                                                                                              |
| `recovery.json` | Operator recovery for all newly generated credentials; never an application or worker config                                                                                                           |

Runtime URLs use `role.nrsuosydvjqovrevmych` as the pooler username and preserve `sslmode=verify-full`. Customer configuration excludes control/loyalty database credentials and the operator password. Control excludes original customer SQL roles. No profile contains the migration credential, Supabase secret key or a `NEXT_PUBLIC_*` name. No worker config is generated: the worker must receive only its separate reviewed dashboard registration/configuration, never any of these database/operator files.

Generated customer config sets production-safe `NORTHSIDE_FIXTURES=0`, `COMMERCE_MODE=live`, and `DATA_MODE=postgres`. These do not activate commerce; source-controlled purchase/pickup gates stay off. Original invited staff and Shopify customer authentication still need their authorized provider configuration. No staff password, owner identity, invitation or public signup is created.

A successful run proves the role catalog changes and saved configuration, **not** authenticated runtime pooler access, hosted RLS/isolation, app connectivity, staff login, worker operation or deployment. Verify each scoped role independently over TLS and run the established cross-role/RLS checks before using these files. Preserve the stable session-encryption key; replacing it invalidates existing encrypted sessions.

## Local verification

Twelve focused tests use local PGlite for actual ALTER ROLE, LOGIN, SCRAM catalog reads, transaction rollback and rerun recovery. They also check target/TLS failure, file ownership/modes/symlinks, public/unknown-variable rejection, unrelated private-input canaries, missing input before connection, recovery-before-ALTER, injected file/directory flush failures and safe retry, scope separation, no grants, unknown-password preservation, the locked recheck, secret-redacted failures, denied catalog lock and conflicting output preservation. Root TypeScript and scoped ESLint checks pass. No hosted write or real runtime-login test is claimed.

Current Supabase documentation reviewed: [connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [verified TLS and PSQL](https://supabase.com/docs/guides/database/psql), [roles](https://supabase.com/docs/guides/database/postgres/roles), and the [changelog](https://supabase.com/changelog). The September PostgreSQL 17.11 extension/operator advisories do not change this helper's existing-role-only scope.
