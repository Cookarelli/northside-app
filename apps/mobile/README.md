# Northside native customer app

An actual Expo SDK 58 / React Native / TypeScript application with Expo Router.
Five native tabs: **Home, Shop, Scan, Wallet, Account**. Supported configuration:
iOS 16.4+, Android minimum API 28 / target 36 / compile 37.

The five tabs now implement approved Shopify merchandise discovery, search and
product variants; native camera/manual lookup; read-only authenticated wallet;
customer profile/orders/services/breaks; and privacy/deletion request access.
See [MVP behavior and prerequisites](docs/CUSTOMER_MVP.txt). Live Shopify/staging,
company policy/fulfillment and physical iPhone/Android acceptance remain blocked.
Unconfigured screens show accurate unavailable states and no synthetic data.
Checkout, redemption, notifications and physical pickup remain disabled.

## Start

Run from this directory, not the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm start:go
```

Use an Expo Go version supporting SDK 58 for an immediate shell preview.
Use `pnpm start` after installing an approved development client. `pnpm ios` and
`pnpm android` open that development client; they do not create signed binaries.
Node 24.22.1 and pnpm 11.25.0 were used. If Node is not on PATH on this Mac:

```sh
export PATH="/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
```

This folder is an independent nested pnpm workspace to preserve the existing
web installation and root lockfile. Do not run a root install as part of mobile
setup. Its own `pnpm-lock.yaml` pins runtime and test dependencies.

## Validate

```sh
pnpm check:dependencies
pnpm doctor
pnpm typecheck
pnpm test
pnpm bundle:ios
pnpm bundle:android
```

Navigation tests exercise the actual layouts/routes with Expo Router's testing
library and RNTL 14. Tests stay outside `src/app`. Mobile test filenames end in
`.test.tsx` to coexist with the existing root Vitest `.test.ts` discovery.
The repository's root and customer no-emit typechecks must also continue to pass.

## Environment and company development builds

Copy `.env.example` to ignored `.env.local` only when supplying approved public
configuration. Use distinct development, preview and production API origins,
identifiers and schemes. Only the explicit safe projection in `config/app.ts`
enters the client; no arbitrary environment object is exported. No Shopify
private token, SQL URL, service key, customer token or deployment bypass belongs
in this app, any `EXPO_PUBLIC_*` value, or its config. Default configuration does
not invent a backend, registered package ID, EAS owner or project UUID.

See [identifier proposals](docs/IDENTIFIERS.md) and the [SDK decision](docs/SDK_DECISION.md).
Before any cloud action, confirm company Expo/EAS membership and project, budget,
approved variant IDs/scheme/API origin, Apple signing/team/device registration for
iOS, and Android signing ownership. Then, in the same terminal environment:

Cloud builds read public `MOBILE_*` values from their build profile and the
matching EAS environment. The iOS preview and production profiles include their
approved identifiers. Supply any remaining settings through the company EAS
project. The ignored `.env.local` file applies only to local commands.

```sh
pnpm build:check development
pnpm dlx eas-cli@27.4.1 whoami
pnpm dlx eas-cli@27.4.1 build --profile development --platform android
pnpm dlx eas-cli@27.4.1 build --profile development --platform ios
```

`build:check` reads `.env.local` through Node's native env-file loader, requires
explicit identifier approval, and starts no build. EAS CLI is version-pinned in
these commands and `eas.json`, rather than installed in app dependencies as
Expo Doctor recommends. Raw EAS commands must follow the local preflight.
`development-simulator` is available for an unsigned iOS simulator build.
`preview` uses internal distribution. The iOS `production` profile targets the App Store.
The approved iOS preview connects the seven-product public Shopify catalog without
a catalog token and uses the existing secure API for scan/cart; see [live catalog setup and acceptance](docs/LIVE_CATALOG.md).
Its public identifiers and catalog mode are in `eas.json`; run
`pnpm build:check preview ios` before an iOS preview build. Run
`pnpm build:check production ios` for the registered production app. Its
manual submission profile points to App Store Connect record `6835580583`.
Automatic submission, remote version allocation and OTA updates are disabled.
Build and physical-device results are recorded separately.

## Native authentication

The native backend/session integration is implemented locally. See
[authentication and staging acceptance](docs/AUTHENTICATION.txt) and
`../customer/docs/NATIVE_MOBILE_AUTH.txt` for server environment names, migrations,
provider callback registration and the live acceptance matrix. Web preview never
stores credentials or starts native login. A company development build is required.

## Exact next implementation task

Configure and verify the approved staging backend, catalog/release collections,
barcode mappings, company store/privacy/support/deletion content and deletion
fulfillment process. Complete real Shopify auth/owner isolation and all five tabs
on signed iPhone/Android development builds using authorized test accounts.
Use the delivered manual QA matrix; do not submit stores or activate production.
