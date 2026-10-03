# Northside App integration status — October 3, 2026

The working branch `integration/supervised-store` continues `Cookarelli/northside-app` from `ef7d01b`. The existing customer application and directives live in `apps/customer`; the supplied logo, grading/exam/customer portal, privacy boundaries, original tests and migration history were preserved. Northside HQ was not modified. Changes are committed locally; no push, merge or hosted deployment is claimed.

| Capability | Evidence-based status |
| --- | --- |
| Existing customer shell and modules | Working locally; original test suite retained |
| New `/in-store` QR → basket → counter → preparation → collection | Fixture-only; actual phone/iPad browser journey passed |
| Shared-device reset and isolation | Working locally; reload, start-over and accelerated inactivity browser checks passed |
| Sample printed-label images | Working locally; four PNGs decoded; physical scanning unverified |
| Shopify Cart API / authenticated order / webhook boundaries | Mock contract tested; real integration blocked |
| Shopify POS bridge | Executable prototype with mocked API verification; packaging/install/device proof blocked |
| Membership/ledger foundation | Working locally; no earning rates, tiers or rewards activated |
| Mission Control authentication/commands/queue | Working locally; actual browser and HTTP worker verification passed |
| Atomic leases, fencing, restart recovery, cancellation and approval binding | Working locally; executed contract tests |
| Deterministic worker | Fixture-only; separate process completed actual local HTTP workflow, clearly SIMULATED |
| Codex adapter | Implemented; installed CLI smoke and sandbox isolation probes passed; full real verification blocked by sandbox/toolchain compatibility |
| launchd service tooling | Implemented and unit checked; not installed, not continuously running |
| New Supabase schema | Integration verified through management connector; 15 migrations applied, 111 customer tables with RLS, private bucket, clean security advisor |
| Hosted application database access | Blocked on privately provisioned restricted role logins and connection verification |
| Remote dashboard | Built and locally verified; hosted deployment pending approval/configuration |

## Next work in order

1. Privately provision the new Supabase runtime role passwords/connection strings, invited owner/staff and Storage configuration. Test the exact least-privilege roles over verified TLS, cross-role denial and hosted restart/concurrency. The authenticated management connector is already working; it does not supply these runtime credentials.
2. Resolve strict sandbox compatibility for the actual verifier without exposing credentials or allowing source writes. Preserve failing evidence. Provision a dedicated non-administrator macOS account, authenticate Codex privately, and prove a complete real build/review/verify run before installing its LaunchAgent.
3. Prepare Vercel preview projects for customer and control using the separate roots and credentials in HOSTING.md. Review a preview before authorizing production. No public endpoint has been published.
4. Confirm the actual Shopify shop/public domain, test environment, plan/scopes, retail inventory location, pickup/fulfillment, taxes and discounts. Reuse the established app's authentication and durable commerce processing. Prove a test web order and POS order/correlation before enabling any sale or staff queue outside local fixtures.
5. Package the POS prototype using verified extension APIs; validate duplicate-import and payment reconciliation behavior on staff hardware. Print labels only after the HTTPS app domain and phone/iPad scan tests are verified.

These are explicit activation boundaries, not evidence of a live store or unattended crew. Merge, production deploy, real charges, live inventory changes and store integration installation remain disabled.
