# October 12 supervised pilot preparation

This report supersedes the October 3 readiness counts in PILOT-REPORT.md and
the PR description. The pilot is not operational until the configuration and
hosted verification blockers below are resolved. No production publication,
merge, live commerce, inventory write or production worker activation is authorized.

## Security changes and verification

- Customer sharp is pinned to 0.35.5; vulnerable 0.35.4 and its native assets
  are removed from the lockfile. The production-only dependency audit passes.
- No patched braces release exists in the registry: latest is 3.0.3.
  A hash-locked pnpm patch bounds parser nesting and recursive node traversal.
  Normal expansion, escaping, deep mixed/parenthesis/brace patterns, cyclic
  node trees and the 128/129 nesting boundary have regression coverage.
  Arbitrary hand-built AST values are outside the patch's assurance.
- Full pnpm audit still exits 1 for GHSA-vfj7-8cjw-p6xm because it matches the
  upstream version without evaluating local patches. No advisory is ignored.
  Treat the scanner result as FAIL with a reviewed local mitigation, not zero
  advisories. Replace the patch when an upstream fix is published.
- Node 24.13.0 / pnpm 11.25.0 frozen installation, typecheck and lint pass.
  Lint retains one existing unused-variable warning in agent-runtime/control.ts.
- All 300 tests pass: 76 core, 16 customer scripts, 208 customer TypeScript.
  Both production builds pass. Client scans pass for 26 customer artifacts
  and 10 Mission Control artifacts; no production secrets were supplied.
- Independent source review accepted the corrected patch and compatibility tests.

## Vercel targets

| Project | Root | Node | Shared source | Protection |
| --- | --- | --- | --- | --- |
| northside-customer-pilot | apps/customer | 24.x | enabled | all URLs |
| northside-control-pilot | apps/control | 24.x | enabled | all URLs |

Both use Next.js defaults, `corepack pnpm build` and
`corepack pnpm install --frozen-lockfile --ignore-scripts`. Both are now linked
to Cookarelli/northside-app with production branch main; the historical claim
that Git integration is absent is stale. This branch is integration/supervised-store.
Deploy only protected Preview builds of this reviewed commit. Final deployment
URLs, source SHA, readiness and HTTP outcomes are reported after deployment;
do not infer them from this pre-deployment report.

## Supabase state

Project nrsuosydvjqovrevmych is the only database target. All 16 management
migrations remain present; all 15 customer source hashes exactly match the
application migration ledger. All 112 private application tables have RLS.
Browser roles lack private-schema USAGE; PUBLIC has no private function EXECUTE.
The northside-private Storage bucket remains private.

All eight existing staff memberships are active with confirmed Auth users:
five admins, two operations staff, one content editor. No role is changed.
The earlier statement that no Auth user exists is stale.

All seven existing restricted users lack passwords; the original five also
lack LOGIN. None has superuser, BYPASSRLS, create-role, create-database or
replication privileges. The provisioning helper's read-only check stops at
`Missing: MIGRATION_DATABASE_URL`. No credentials were generated or changed.
The management connector cannot SET ROLE northside_runtime; it is not a
substitute for runtime authentication or hosted cross-role tests.

Use the existing reviewed scripts/provision-pilot.ts procedure described in
commerce-provisioning.md. Privately supply the actual project Session pooler
URL with verified TLS, then run the default read-only check. Review the seven
role states and catalog permissions before the explicit --provision operation.
Keep durable recovery private; never rotate existing credentials to bypass a
failure. Deploy only each app's scoped configuration, never migration/recovery
credentials. Runtime logins, TLS identity, two-customer isolation and actual
private-object Storage authorization remain BLOCKED until configured.

The security advisor warns that leaked-password protection is disabled.
Check plan availability and enable it in the project's Auth settings through
the supported operator workflow; it was not changed by this preparation.

## Missing configuration names

Preview customer requirements:
APP_ORIGIN, DATABASE_URL, AUTH_DATABASE_URL, COMMERCE_DATABASE_URL,
ENGAGEMENT_DATABASE_URL, NORTHSIDE_DATA_DATABASE_URL, SESSION_ENCRYPTION_KEY,
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SHOPIFY_SHOP,
SHOPIFY_CUSTOMER_CLIENT_ID, SHOPIFY_CUSTOMER_CLIENT_SECRET,
SHOPIFY_EXPECTED_ISSUER, SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
SHOPIFY_TRUSTED_BUYER_IP_HEADER, SHOPIFY_CHECKOUT_HOSTS, SHOPIFY_ADMIN_AUTH_MODE.

Admin OAuth alternative: SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_ADMIN_TOKEN_EXPIRES_AT.
Confirmed same-organization alternative: SHOPIFY_APP_CLIENT_ID,
SHOPIFY_APP_CLIENT_SECRET, SHOPIFY_SAME_ORG_CONFIRMED.

Preview Mission Control: NORTHSIDE_DATA_DATABASE_URL, OPERATOR_PASSWORD,
CONTROL_ORIGIN. The role URL must differ from the customer's role URL.

Private provisioning input: MIGRATION_DATABASE_URL.
Separate inactive loyalty process: LOYALTY_DATABASE_URL.
The private local operator file already has SUPABASE_PUBLISHABLE_KEY, but it
has not been configured in Vercel. Values are deliberately omitted here.

## Integration boundaries and next steps

Purchases, pickup, loyalty earning/redemption, public scan/navigation and live
in-store/POS operations remain disabled. Shopify catalog inspection requires
actual provider configuration and invited owner/admin authentication. No
credentialed catalog test can run while those inputs are absent. Do not infer
POS evidence from online checkout or a rehearsal backend interface.

Mission Control source/session tests and worker credential/revocation/fencing
tests pass. Successful hosted operator/customer/staff authentication remains
BLOCKED. Production workers remain disabled and unregistered by this task.

Next: resolve the upstream braces scanner finding or explicitly review the
tracked mitigation; configure the seven restricted users privately; address
leaked-password protection; inject scoped Preview configuration; redeploy both
apps at one audited commit; verify real sign-in/logout and two-customer/role
isolation, TLS and existing private objects; inspect Shopify catalog read-only.
Keep commerce and workers disabled throughout this acceptance process.
