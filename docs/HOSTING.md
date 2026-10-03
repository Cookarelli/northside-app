# Hosting and private configuration

No remote resource has been created or modified. Steve is creating a new dedicated Supabase project. Do not use the historical Northside project or any Northside HQ database. Production deployment needs explicit authorization after review.

## Database

1. Create the dedicated project, record its project reference, and retain its password privately. Take the connection strings from Supabase's Connect panel, not a guessed hostname.
2. Preserve/apply the original **13 migrations** from `apps/customer/supabase/migrations` in order, using the existing `apps/customer/scripts/migrate.mjs` and the exact prerequisite/role instructions in `apps/customer/docs/DEPLOYMENT.md`, `ENVIRONMENT.md` and `AUTH-AND-PRIVACY.md`. Original runtime, auth, commerce, loyalty and engagement roles remain separate. Private Storage and invited staff configuration remain necessary for the existing app.
3. Separately apply `supabase/migrations/20261003145016_initial_private_state.sql` once to that same new project under a migration credential. It creates the unexposed `northside_private` schema and restricted `northside_control_server` and `northside_customer_server` roles. Assign independent random passwords privately; do not store passwords in SQL migrations. Neither role may be superuser or BYPASSRLS.
4. Do not add `northside_private` to the exposed Data API schemas. No anon/authenticated policies are granted. Control role access is limited to `control`/`auth_operator`; customer role access to `commerce`/`auth_staff`. The runtime checks the actual database role and fails closed with privileged credentials.
5. Use transaction-pooler URLs for Vercel, with the corresponding restricted username; copy the pooler host from Supabase. The adapter disables prepared statements and validates TLS certificates. The local PGlite policy test is not hosted verification: repeat access-denial, parallel claim, lease expiry, restart, TLS, backup and restoration checks on the new project before launch.

The new persistence stores bounded JSON aggregates behind row locks, one per namespace. This gives atomic claims and transitions across multiple server processes for the initial small installation. It is not a high-volume event warehouse: namespace state is capped at 16 MiB and service collections are bounded. Split/partition aggregates and implement operator archival before increasing volume. SQLite WAL is for a trusted local fixture installation only; it is rejected on Vercel.

## Vercel

Prepare **two projects** linked to Cookarelli/northside-app, with root directories `apps/customer` and `apps/control`. Enable access to workspace files outside each root. Use Node 24.x, pnpm 11.25.0 and the committed lockfile. Install from the monorepo with `pnpm install --frozen-lockfile --ignore-scripts`; build each selected application with `pnpm build` in its configured root. Do not point both projects at the monorepo root or run the root two-app build as one deployment.

Keep automatic production publication disabled until authorized. Connecting the Git integration can configure automatic deployments: review that setting before linking/pushing. No Vercel project or verified URL is claimed here.

**Control project secrets:** `NORTHSIDE_DATA_DATABASE_URL` for `northside_control_server`, `NORTHSIDE_DATA_SCOPE=control`, `DATA_MODE=postgres`, `CONTROL_ORIGIN` equal to its exact HTTPS origin, and a cryptographically random `OPERATOR_PASSWORD` of at least 20 characters. Store it in a password manager. The operator is Steve for this initial single-operator version; a multi-user operator directory/SSO is a later hardening task. Sessions are hashed server-side, HttpOnly, Secure over HTTPS, expire after eight hours, and invalidate after password rotation.

**Customer project:** retain the existing per-role environment separation from `apps/customer/docs/ENVIRONMENT.md`. Do not give it the control database credential or operator password. For the new retail adapter use a separate `NORTHSIDE_DATA_DATABASE_URL` restricted to `northside_customer_server`, `NORTHSIDE_DATA_SCOPE=customer`, and exact `CUSTOMER_ORIGIN`. Set `COMMERCE_MODE=live`, `NORTHSIDE_FIXTURES=0`; this does **not** enable checkout or POS. New staff password authentication is local fixture-only. Connect the new queue to the existing invited staff identity before any real staff fulfillment activation.

Shopify credentials stay server-only and do not belong in the worker's environment. Configure only after confirming the store/public domain, plan, API scopes, fulfillment/pickup/location, taxes/discounts and the test-store procedure. Existing documentation records a prior myshopify domain; no current credentialed verification was performed.

**Worker:** connects outbound over HTTPS only to the control origin with a revocable worker credential. It must not receive either database URL, operator/staff passwords, Shopify tokens or production deployment credentials. Register through Mission Control and save the one-time credential in a mode-0600 file outside agent-visible worktrees. Follow `docs/worker.md` before selecting Codex mode or installing launchd.

## Official references checked October 3, 2026

- [Next.js authentication](https://nextjs.org/docs/app/guides/authentication) and the installed Next.js 16.3.8 route/layout documentation.
- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Changelog reviewed; the September 25 Postgres minor-release notice concerns extensions not used by the new aggregate migration. Existing migration extensions need normal hosted compatibility checks.
- [Vercel monorepos](https://vercel.com/docs/monorepos).
- [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode) and [authentication](https://learn.chatgpt.com/docs/auth). Installed CLI help was also inspected; account continuity and provider entitlements are not inferred from one successful run.
