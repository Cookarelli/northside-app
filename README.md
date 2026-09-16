# Northside customer app

Prompts **1–10 are implemented and tested locally**. Customer launch and external provider verification remain pending. Start with the [release report](docs/RELEASE-REPORT.md), [requirements matrix](docs/REQUIREMENTS-MATRIX.md), [deployment commands](docs/DEPLOYMENT.md), [staff guide](docs/STAFF-QUICKSTART.md) and [launch checklist](docs/LAUNCH-CHECKLIST.md). The requested design pass is now due.

The functional modules are implemented locally: preview, identity/privacy, Shopify commerce boundaries, persistent grading, manual consignment, custom Northside loyalty, saved break operations, future store preparation, PWA/offline support, notifications and consent-aware show measurement. GitHub repository: https://github.com/Cookarelli/northside-app, selected by Steve on September 16, 2026. This supersedes the earlier NorthsideCollectibles/northside-app destination. The local preview needs no credentials. No Shopify products were changed. Custom Northside loyalty is implemented with no paid plugin; real economics remain inactive. The full ten-stage specification is preserved in Northside-App-Codex-Prompts.md.

## Start on this Mac

From this folder:

```sh
./scripts/preview.sh
```

Open http://127.0.0.1:3000. The script locates the bundled Node runtime if Node is absent from PATH and enables local fixtures. This is a development preview, deliberately separate from production.

Portable setup: install Node 24.x and pnpm 11.19.0, then:

```sh
pnpm install --frozen-lockfile
NORTHSIDE_FIXTURES=1 pnpm dev
```

## Validation and production

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

Production never serves fixtures even if NORTHSIDE_FIXTURES=1. Production shows honest disconnected/empty states; sample detail routes return 404; staff workspace stays unavailable until configured. No second framework or static-export requirement. Conventional Node deployment. Vercel project northsidecollectibles/northside-app was supplied; its deployment domain is not yet verified.

On this Mac, add the bundled runtime to PATH if running individual commands:

```sh
export PATH="/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
```

## Try the preview

- Home → Shop → search/category → sample product → add to demo cart → edit quantity/remove. Checkout is disabled.
- Account → Try sample signed-in view → Home or My Cards → Grading / Consignment. Leaving the sample account clears the in-memory cart. Refresh resets that earlier in-memory demo; the new grading workspace below persists.
- Rewards → saved sample wallet → exchange sample points → simulate a timeout → recover the same voucher. Staff → Rewards desk → inactive rule drafts, reasoned corrections and reports. Sample codes cannot be used at Shopify checkout.
- Breaks → saved sample event → calendar download, in-app reminder and optional participant alias. My breaks shows owned reminders/purchases. Staff → Break desk edits schedules and reviews sample paid-order conflicts/refunds. Watch destinations remain unconfirmed and purchases disabled.
- Footer → Staff preview → read integration health, draft catalog explanation and feature gates.
- Shop → Next samples → product → Back to shop retains search/category/page. Product variant selection includes a visibly fictional sold-out state.
- Sample signed-in account → Sample order history. Footer → Staff preview → detailed connection status. All provider checks stay disconnected in fixtures.

All merchandise, prices, artwork, dates and customer records are explicitly fictional. The user-supplied Northside logo is real brand artwork and used unchanged. No real photography was supplied. Generic CSS illustrations are labeled sample artwork.

See docs/STATUS.md for evidence, docs/PRODUCT-SPEC.md for scope, docs/ARCHITECTURE.md for boundaries and docs/INTEGRATIONS.md for inputs. Supabase, actual OAuth and Shopify checkout still need account access/configuration. The connected GitHub account has write access to the newly selected Cookarelli repository. Follow docs/SETUP-PROMPT-2.md and docs/SETUP-PROMPT-3.md for the remaining provider setup; their earlier GitHub destination/blocker is historical.

Production smoke check: start the built app on port 3001 with `NORTHSIDE_FIXTURES=1 pnpm start --port 3001`, then run `node scripts/production-smoke.mjs`. Fixture opt-in must still be rejected.

Prompt 2 details: [identity/privacy](docs/AUTH-AND-PRIVACY.md) and [setup / GitHub access](docs/SETUP-PROMPT-2.md). `pnpm test` runs fixture policy and all privacy/OIDC/SQL tests. Migrations: `pnpm db:migrate` (only after privately configuring the migration connection). Staff owner: `pnpm staff:bootstrap` (only after selecting an actual invited Supabase user). The local preview does not need either step.

HTTP auth smoke test: start production on port 3001 with `APP_ORIGIN=https://local-test.invalid NORTHSIDE_FIXTURES=1 pnpm start --port 3001` (test configuration, no credentials), then `node scripts/auth-smoke.mjs`. This checks rejection paths, not a real OAuth login.

Prompt 3 smoke checks use that production server with `SHOPIFY_SHOP=9i3hnb-jw.myshopify.com` as well, then `node scripts/commerce-smoke.mjs`. `pnpm orders:work` runs a bounded durable order-worker pass only after private database/Admin configuration. No worker scheduler has been installed. The Shopify API contract is pinned to 2026-07; public purchases and all loyalty/in-store gates stay off. Prompt 4 grading is implemented; see [grading setup and demonstration](docs/SETUP-PROMPT-4.md). Prompts 5 consignment and 6 custom loyalty are implemented locally. Prompts 7 breaks and 8 future store preparation are implemented locally; Prompt 9 is locally complete; Prompt 10 release preparation is complete locally; deployment and real integration verification remain pending.

Saved grading preview: [staff desk](http://127.0.0.1:3000/staff/grading) and [customer cards](http://127.0.0.1:3000/my-cards/grading). Clearly fictional local records persist in ignored `work/grading-preview/`. Three cards at the default examination rate show a $15 subtotal, with external charges unquoted. Run `node scripts/grading-smoke.mjs` against the configured temporary production server to check the new rejection paths.

Saved consignment preview: [staff desk](http://127.0.0.1:3000/staff/consignment) and [customer cards](http://127.0.0.1:3000/my-cards/consignment). See [Prompt 5 setup](docs/SETUP-PROMPT-5.md) for matching/imports and informational settlement records. Fanatics Collect remains disconnected; the [partner data request](docs/FANATICS-DATA-REQUEST.md) is a draft and was not sent. `node scripts/consignment-smoke.mjs` checks production privacy rejection paths.

Saved rewards preview: [customer wallet](http://127.0.0.1:3000/rewards) and [staff rewards desk](http://127.0.0.1:3000/staff/rewards). Sample points, holds and vouchers persist in the same ignored local database as grading/consignment. See [Prompt 6 setup](docs/SETUP-PROMPT-6.md), [reconciliation evidence and recovery](docs/LOYALTY-RECONCILIATION.md) and [aggregate export contract](docs/MARKETING-HUB-LOYALTY-CONTRACT.md). Real earning/redemption remain disabled pending Joey’s economic approval and separately authorized Shopify checkout verification. `pnpm loyalty:work` is a bounded worker pass; it exits without provider calls while both loyalty gates are off. No scheduler is installed. `node scripts/loyalty-smoke.mjs` checks production rejection paths.

Saved breaks: [schedule](http://127.0.0.1:3000/breaks), [my breaks](http://127.0.0.1:3000/account/breaks) and [staff desk](http://127.0.0.1:3000/staff/breaks). See [Prompt 7 setup](docs/SETUP-PROMPT-7.md) and [before-sale checklist](docs/BREAK-SALE-CHECKLIST.md). After migrations/private configuration, `pnpm breaks:work` processes durable paid-order jobs queued by `pnpm orders:work`. No scheduler is installed. `node scripts/breaks-smoke.mjs` verifies production rejection paths. Actual Shopify concurrency testing remains required; local simulation never enables purchases.

The user requested a dedicated design pass after functional stages are finished. A quiet milestone reminder is set in this task; see STATUS.md.

Saved store preparation: [staff workspace](http://127.0.0.1:3000/staff/store) provides eight editable schematic aisles, three separate inventory pools, product locators, QR SVG/PNG downloads, camera/manual scanner and pickup rehearsals. See [Prompt 8 setup](docs/SETUP-PROMPT-8.md) and [store activation checklist](docs/STORE-ACTIVATION-CHECKLIST.md). Customer scanning, navigation and pickup remain disabled. `node scripts/store-smoke.mjs` checks production rejection paths. No real floor plan, inventory transfer or phone-camera verification is claimed.

## Prompt 9 preview

Open `/account/notifications`, `/staff/engagement`, `/shows` and `/install`. Notification preferences, generic in-app updates, durable UNSENT delivery rehearsals, reusable show QR campaigns and consent-aware metrics/CSV are available locally. See [setup](docs/SETUP-PROMPT-9.md) and [Marketing Hub export contract](docs/MARKETING-HUB-ENGAGEMENT-CONTRACT.md). All public purchase/loyalty/store flags remain disabled; real device and provider tests are pending.
