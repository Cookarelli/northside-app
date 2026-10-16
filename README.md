# Northside App + supervised development

This monorepo continues **Cookarelli/northside-app** at `ef7d01b`. The existing customer application, supplied logo, grading workflows, identity/privacy controls, loyalty foundations, tests and all 13 original migrations are preserved under `apps/customer`. New in-store work is additive at `/in-store`; Mission Control is a separate app at `/mission-control`. Northside HQ is outside this repository and was not changed.

**Protected pilot previews are deployed; operational activation remains gated.** See the [current pilot report, preview links and exact setup steps](docs/PILOT-REPORT.md). Live Shopify purchases, inventory changes, POS installation and real worker activation remain disabled. Earlier [local verification](docs/VERIFICATION.md) is retained as historical evidence.

## Start on this Mac

```sh
cd /Users/northside/Documents/Codex/2026-10-03/files-pasted-by-the-user-build/outputs/northside-app
export PATH="/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node --version  # Node 24.x; the bundled version used here is 24.19.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm setup:local
pnpm dev
```

Portable setup requires Node **24.x**, pnpm **11.25.0**, and Git. Dependencies are pinned in the workspace lockfile. Installation skips dependency scripts; the package manager's integrity checks remain enabled. `setup:local` never overwrites an existing environment file. It writes random local passwords with mode 0600; open `.env.local` privately in your editor. Never paste secrets into chat.

- Existing customer app: http://127.0.0.1:3100
- In-store transaction rehearsal: http://127.0.0.1:3100/in-store
- Staff rehearsal queue: http://127.0.0.1:3100/in-store/staff
- Operator dashboard: http://127.0.0.1:3101/mission-control

Both servers bind to loopback. Use `OPERATOR_PASSWORD` for Mission Control and the separate `STAFF_PASSWORD` for local in-store staff rehearsal. The original invited-staff/Shopify customer authentication remains unchanged. New fixture records use `.runtime/northside.sqlite`; original grading/loyalty fixtures retain their existing ignored workspace storage. No sample payment proves real payment.

## Validate

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm qr
```

`pnpm test` runs the new queue, persistence, security and commerce tests plus the preserved customer application's tests. `pnpm qr` writes decoded sample labels to `outputs/qr-samples`. Their loopback URLs are for local inspection; set the verified app origin before printing real labels, and test physical devices first.

The new in-store rehearsal demonstrates confirmation after QR lookup, basket editing, expiring counter handoff, staff retrieval, **explicit simulated payment**, preparation and atomic collection. Pay Now remains blocked until real Shopify pickup/location/tax/plan checks and test orders are verified. See [commerce requirements](docs/commerce-rehearsal.md) for the integration boundaries.

## Layout

| Location | Purpose |
| --- | --- |
| `apps/customer` | Preserved existing Next.js customer application plus `/in-store` |
| `apps/control` | Authenticated Mission Control and outbound-worker API |
| `apps/worker` | Mac coordinator, bounded execution and runtime adapters |
| `apps/shopify-extension` | POS handoff prototype; not installed or verified on hardware |
| `packages/domain` | New shopping/handoff/collection and membership contracts |
| `packages/data` | Atomic local SQLite and hosted Postgres persistence/auth |
| `packages/shopify` | Server-side Shopify adapters |
| `packages/agent-runtime` | Durable queue, fencing, commands and approval contracts |
| `apps/customer/supabase/migrations` | Preserved 13-migration chain plus additive search-path and function-grant hardening |
| `supabase/migrations` | Separate new control/retail aggregate schema and restricted roles |

Read `apps/customer/AGENTS.md` and its linked documents before changing existing modules. New ordinary coding tasks cannot edit their own runtime policy, credentials or approval gates. The worker has no public inbound listener or remote shell. Merge and production deployment are disabled.

See [worker setup](docs/worker-operations.md) for registration, dedicated-account isolation, launchd and limits. Existing application setup remains in [the preserved README](apps/customer/README.md); run its package-local commands from `apps/customer`, or use `pnpm --filter @northside/customer <script>` from the root. Earlier hosted project references are historical. The new dedicated Supabase project is **nrsuosydvjqovrevmych**. Its schema has been applied and security advisors are clean; restricted runtime credentials and hosted app connections still need configuration.
