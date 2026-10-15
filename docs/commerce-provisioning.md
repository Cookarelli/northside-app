# Operator-only pilot database provisioning

This helper is for the already migrated, dedicated Supabase project **nrsuosydvjqovrevmych**. It does not create roles/schema, grant permissions, configure hosted applications, bootstrap staff, send invitations, or configure a worker. Default execution is read-only. The separately authorized, independently reviewed hosted procedure was executed on October 15; see the verification record below.

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
4. In one database transaction, acquire the helper's advisory transaction lock, then issue the supported `ALTER ROLE ... LOGIN` for all seven allowlisted roles in deterministic order. PostgreSQL performs native catalog tuple writes, retaining their write locks until transaction end. Re-read and revalidate every role and saved verifier after all seven writes. A competing stale catalog update fails rather than silently replacing a password; the entire transaction must roll back on any error. No system-catalog table lock or new catalog permission is required.
5. Set passwords **only where currently null**. Existing SCRAM verifiers must match the saved recovery secret; a mismatching or unsupported existing verifier stops the transaction. Enable LOGIN for the original five roles as needed. No role is created, no scope or permission is granted, and no existing password is rotated.
6. Re-read the catalog and verify all seven LOGIN/password results before commit. SQL ALTER statements contain locally derived SCRAM-SHA-256 verifiers, not plaintext passwords. Database SQL logs may still contain credential verifiers and must remain private; the helper does not disable auditing.
7. After commit, exclusively write missing scoped files and verify existing ones are unchanged. Recovery remains available if commit acknowledgment or file writing fails.

**Supported hosted procedure:** the earlier explicit system-catalog lock was rejected by Supabase and is superseded by the reviewed native role-write procedure. Use the existing `postgres` role's supported role-management authority; never grant system-catalog UPDATE, superuser or BYPASSRLS. Missing ALTER authority fails closed and rolls back. Native writes protect the password check/update sequence; they do not serialize arbitrary concurrent changes to role memberships in a different catalog. Memberships and unsafe attributes are checked again before commit. Operators must not independently edit memberships or role privileges during provisioning. Preserve recovery after timeouts, deadlocks, competing changes or uncertain commit acknowledgments; recheck before retrying.

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

The downloaded project CA is a public trust certificate, not a private key. Supply it to the operator process through `NODE_EXTRA_CA_CERTS`. For hosted Customer and Control database drivers, set `NORTHSIDE_DATABASE_CA_CERT` to the certificate PEM as a server-only Preview variable. Both drivers retain `rejectUnauthorized: true` and hostname verification. Never downgrade TLS to bypass a trust-chain failure.

Generated customer config sets production-safe `NORTHSIDE_FIXTURES=0`, `COMMERCE_MODE=live`, and `DATA_MODE=postgres`. These do not activate commerce; source-controlled purchase/pickup gates stay off. Original invited staff and Shopify customer authentication still need their authorized provider configuration. No staff password, owner identity, invitation or public signup is created.

A successful run proves the role catalog changes and saved configuration, **not** authenticated runtime pooler access, hosted RLS/isolation, app connectivity, staff login, worker operation or deployment. Verify each scoped role independently over TLS and run the established cross-role/RLS checks before using these files. Preserve the stable session-encryption key; replacing it invalidates existing encrypted sessions.

## Local verification

Twelve focused tests use local PGlite for actual ALTER ROLE, LOGIN, SCRAM catalog reads, transaction rollback and rerun recovery. They also check target/TLS failure, file ownership/modes/symlinks, public/unknown-variable rejection, unrelated private-input canaries, missing input before connection, recovery-before-ALTER, injected file/directory flush failures and safe retry, scope separation, no grants, unknown-password preservation, the locked recheck, secret-redacted failures, denied native role-management authority and conflicting output preservation. Root TypeScript, lint, all 301 tests and both builds pass (lint retains one existing warning). A separate two-connection PostgreSQL 16 test verified competing password-write rollback and preservation of a prior external password.

## October 15 hosted verification

The reviewed native procedure completed on hosted PostgreSQL 17. A deliberately injected verifier mismatch rolled back before the real provisioning run. All seven allowlisted roles now have LOGIN and saved matching SCRAM verifiers. Each role successfully authenticated directly with certificate and hostname verification, and none has superuser, create-database, create-role, replication or bypass-RLS privileges. Existing grants, memberships, migrations, staff roles and data were not changed.

**Pilot connectivity remains BLOCKED:** shared session-pooler authentication fails with SQLSTATE `28P01` for all seven credentials. A second driver reproduced the failure; transaction mode also failed for the diagnostic role, while direct authentication succeeded. This does not prove a pooler implementation defect. Do not rotate passwords repeatedly, weaken TLS, or substitute the migration account. Supabase documents [pooler credential-cache troubleshooting](https://supabase.com/docs/guides/troubleshooting/supavisor-error-password-authentication-failed-after-password-rotation); persistent rejection requires provider investigation. The direct IPv6 endpoint is not a drop-in Vercel workaround: [Vercel requires an IPv4-capable connection](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP). A paid IPv4 add-on, database restart, or credential recovery needs separate approval.

Preview configuration is a separate operator action: exact project and branch scoping, sensitive server-only values, no migration or loyalty URL and no worker credentials. Customer may receive its required Supabase server secret and Shopify credentials separately from the helper outputs. Control receives neither. Protected previews must remain unsuitable for commerce until hosted connection, authorization and RLS checks pass. Purchase/pickup gates, loyalty redemption, POS writes and production workers remain disabled.

Current Supabase documentation reviewed: [connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [verified TLS and PSQL](https://supabase.com/docs/guides/database/psql), [roles](https://supabase.com/docs/guides/database/postgres/roles), and the [changelog](https://supabase.com/changelog). The September PostgreSQL 17.11 extension/operator advisories do not change this helper's existing-role-only scope.
