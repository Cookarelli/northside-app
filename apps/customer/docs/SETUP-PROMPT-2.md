# Prompt 2 setup and remaining external checks

Stage-specific implementation record. For the current combined handoff, see [RELEASE-REPORT.md](RELEASE-REPORT.md).

You can postpone this until your account passwords are reset. The local fixture preview and tests continue to work. Never paste secrets into chat or GitHub.

## Project locations

- Repository: https://github.com/NorthsideCollectibles/northside-app
- Supabase project supplied by user: https://supabase.com/dashboard/project/zuqktfohxqzkzumtqibg
- Vercel project supplied by user: https://vercel.com/northsidecollectibles/northside-app

Both project dashboards required browser login when inspected. No database schema, cloud setting, deployment, password or production Shopify record was changed. A Vercel project URL is not an OAuth origin; use its verified HTTPS deployment domain later.

## GitHub upload

The connected GitHub account is **Cookarelli**; the repository owner is **NorthsideCollectibles**. The connector reported `push: false`. Sign in as NorthsideCollectibles, open the repository → Settings → Collaborators, invite Cookarelli, and accept the invitation from Cookarelli. Tell Codex when ready so it can recheck the existing connection and upload. Alternatively sign Git on this Mac into a write-capable account, then run `git push -u origin main` from the project folder. Git currently has no HTTPS credentials; reset passwords yourself through GitHub's normal flow. Do not send a token/password through chat.

## Supabase database

1. Sign in and inspect project zuqktfohxqzkzumtqibg for existing schema/storage first. The new `ns` schema must not already contain another application. Migrations intentionally do not drop or overwrite an existing `ns` schema.
2. Copy `.env.example` to ignored `.env.local`. Obtain the migration connection privately from Supabase Connect. Set `MIGRATION_DATABASE_URL` with SSL; use the actual provided direct/session connection and URL-encode passwords. Do not put this variable in Vercel runtime.
3. Run `pnpm db:migrate`. The runner locks migrations, records hashes, applies each in a transaction and rejects changes to applied files. Migration 001 creates NOLOGIN `northside_runtime` and `northside_auth` roles. Migration 002 creates/updates only the named private bucket and adds its restrictive policy. Back up an existing project before applying; first-time use belongs on the selected non-production setup.
4. As migration owner, privately provision distinct LOGIN passwords for the two new roles. Example SQL structure (replace placeholders privately):

```sql
ALTER ROLE northside_runtime LOGIN PASSWORD '<unique runtime password>';
ALTER ROLE northside_auth LOGIN PASSWORD '<different auth password>';
```

Do not grant superuser/BYPASSRLS or membership in postgres/service_role. Set `DATABASE_URL` to the northside_runtime connection and `AUTH_DATABASE_URL` to northside_auth. For Supabase pooler usernames, use the project-specific role format from the supported connection instructions; do not assume the postgres connection string can be reused unchanged. The server checks `current_user`, `rolsuper` and `rolbypassrls` at every transaction. Transaction-local context prevents pool leakage.
5. Set `SUPABASE_URL=https://zuqktfohxqzkzumtqibg.supabase.co`, `SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY` privately. The latter is used for invitations and already-authorized private Storage operations, never for operational SQL queries. Keep the `ns` schema out of the exposed Data API schemas and do not grant anon/authenticated access to it.
6. Generate a 32-byte base64 encryption key (`openssl rand -base64 32`) and save it as `SESSION_ENCRYPTION_KEY` privately. Keep it stable across instances; changing it invalidates old encrypted sessions. Back it up securely with the deployment secrets. No real key was generated or committed by this stage.

## Staff email authentication

1. Disable public new-user signup in Supabase Auth. Membership checks still deny accounts without an explicit invitation, but this setting prevents unwanted Auth users.
2. Configure the exact HTTPS app origin and Auth redirect allowlist. Set `APP_ORIGIN=https://<verified-deployment-domain>` with no path. Configure the Supabase invitation email template to link to:

```text
{{ .SiteURL }}/staff/confirm?token_hash={{ .TokenHash }}&type=invite
```

Configure the magic-link template similarly with `type=email`. The confirmation page uses an explicit same-origin POST so mail-link scanners do not consume the token automatically. Provider verification and token storage stay on the server. Do not use a template that redirects access tokens in a URL fragment to browser code.
3. Privately invite the initial owner through Supabase. Before they follow the invite, set `NORTHSIDE_OWNER_AUTH_USER_ID` to its verified UUID for the bootstrap command only, then run `pnpm staff:bootstrap`. The command checks Supabase's actual user, requires a real invitation or confirmed email, and refuses a duplicate active owner. Then finish the email confirmation and remove this bootstrap variable. The email link must be verified before the membership can establish a login. No owner identity or email is hardcoded.
4. Invited staff use `/staff/login`. Further invitations use the authenticated owner/admin form. Review role selections. Delivery requires configured Supabase email support; no emails were sent here.

## Shopify customer authentication

Current official Shopify guidance requires the Customer Account API through a configured Headless/Hydrogen storefront and an HTTPS callback; plain localhost is not accepted. Use a **confidential customer-account client** (not an unrelated app client) for this server application. Register exactly:

```text
https://<verified-deployment-domain>/api/auth/shopify/callback
https://<verified-deployment-domain>/account   (post-logout return)
```

Set `SHOPIFY_CUSTOMER_CLIENT_ID` and `SHOPIFY_CUSTOMER_CLIENT_SECRET` privately. Required scopes are `openid email customer-account-api:full`. Grant only the documented needed permissions in Shopify; do not change Draft products, inventory or fulfillment while configuring identity.

Northside's public discovery endpoint was successfully read September 12, 2026. It returned issuer `https://shopify.com/authentication/103967392113`, RS256, S256 and confidential client methods; this non-secret issuer is recorded in `.env.example`. The server dynamically reads authorization/token/logout/JWKS URLs from the shop's discovery endpoint, requires the exact expected issuer, and checks endpoint HTTPS hosts. Current endpoints are on shopify.com; additional `SHOPIFY_AUTH_HOSTS` should only be added after reviewing an actual Shopify metadata change.

Use `NORTHSIDE_FIXTURES=0` when testing real auth. The server explicitly rejects live auth in fixture mode, even with valid credentials. The normal `scripts/preview.sh` always enables fixtures; for HTTPS real integration testing use `NORTHSIDE_FIXTURES=0 pnpm dev` behind a deliberately configured HTTPS origin, or the chosen staging deployment. No tunnel or deployment was created here.

## Required external evidence before stage verification

- Run the migrations on the configured Supabase project and verify runtime/auth grants, private schema and restrictive Storage policy, including any existing policies.
- Test two real test customers in one grading batch and a separate test tenant on a dedicated test database: cross-card IDs, batch totals, staff notes, direct SQL role access, CSV export and pooled-connection reuse. Do not seed the second test tenant into the customer production app.
- Test real Shopify authorization callback, canceled/expired/replayed attempt, token refresh, logout, wrong/expired session and exact issuer/client settings.
- Verify owner bootstrap and invited staff login; non-invited accounts denied; each role restricted; revoked membership denied with an otherwise-valid session.
- Upload a sanitized test image privately, prove direct object URL and foreign-customer signing requests fail, and prove an authorized 60-second signed download works then expires. Supabase hosting behavior is not proven by local policy tests.
- Verify actual browser logout/back navigation and shared-device privacy; keep Vercel/proxy logs from recording OAuth query strings or private tokens. Do not enable fixture production mode.

## Official references reviewed

- Shopify setup and HTTPS callbacks: https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started
- Shopify discovery, scopes and grants: https://shopify.dev/docs/api/customer/latest
- OIDC implementation library: https://github.com/panva/openid-client
- Supabase row security/grants and service-role bypass: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase verified users: https://supabase.com/docs/reference/javascript/auth-getuser
- Supabase invitation: https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
- Private Storage: https://supabase.com/docs/guides/storage/security/access-control
- GitHub command-line sign-in alternative: https://cli.github.com/manual/gh_auth_login
