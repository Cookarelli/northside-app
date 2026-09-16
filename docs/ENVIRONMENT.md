# Environment inventory

All provider access stays on the server. `.env.example` contains placeholders; copy it only to ignored `.env.local` for private local setup. No real secrets have been configured. Deployment values must be entered privately in the selected host. A nonempty value is configuration, not verification. No variable below enables the six code-level purchase/loyalty/store gates.

| Variable(s) | Scope and required condition | Owner / value rule |
| --- | --- | --- |
| `NORTHSIDE_FIXTURES` | Local preview only: 1; hosted: 0. Production always rejects fixtures. | Developer; `preview.sh` sets 1 explicitly. |
| `APP_ORIGIN` | Web/auth/notifications: exact HTTPS origin, no path | Steve chooses stable domain, verifies ownership/callbacks. |
| `DATABASE_URL` | Web: northside_runtime SQL role | Steve/database operator; private TLS connection, non-superuser/non-BYPASSRLS. |
| `AUTH_DATABASE_URL` | Web/auth/bootstrap: northside_auth | Separate private credential, identity/session grants only. |
| `COMMERCE_DATABASE_URL` | Web cart/webhook and order/break workers: northside_commerce | Separate private credential, no auth/private cards access. |
| `LOYALTY_DATABASE_URL` | Loyalty worker: northside_loyalty | Separate private credential; website staff actions use runtime. |
| `ENGAGEMENT_DATABASE_URL` | Web engagement/contact/attribution and notification/measurement workers: northside_engagement | Separate private credential; no operational cards/payouts/loyalty tables. |
| `MIGRATION_DATABASE_URL` | Migration CLI only | Private migration-owner connection. Never website/worker runtime. |
| `SESSION_ENCRYPTION_KEY` | Web/auth/cart: stable random 32 bytes, base64 | Private backup in secret manager; rotating requires session/cart recovery plan. |
| `SUPABASE_URL` | Web/auth/bootstrap: exact project HTTPS URL | Supplied project zuqktfohxqzkzumtqibg; inspect before use. |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side Supabase staff auth client | Project key; no customer password system. |
| `SUPABASE_SECRET_KEY` | Server invitations and already-authorized private Storage; bootstrap verification | Privileged API secret, not SQL runtime or browser key. |
| `NORTHSIDE_OWNER_AUTH_USER_ID` | One-time bootstrap only; intentionally absent from ordinary `.env.example` | Steve privately chooses actual invited/confirmed Supabase UUID; remove after bootstrap. |
| `SHOPIFY_SHOP` | Web/workers: `9i3hnb-jw.myshopify.com` | Pinned first shop; not an arbitrary tenant selector. |
| `SHOPIFY_API_VERSION` | Web/workers: `2026-07` | Only tested allowlisted version; review contracts before upgrades. |
| `SHOPIFY_CUSTOMER_CLIENT_ID`, `SHOPIFY_CUSTOMER_CLIENT_SECRET` | Web OAuth: actual confidential Customer Account client | Steve/Shopify admin; exact registered callbacks and customer scopes. |
| `SHOPIFY_EXPECTED_ISSUER` | Web OAuth: `https://shopify.com/authentication/103967392113` | Confirmed by public discovery, not login proof. |
| `SHOPIFY_AUTH_HOSTS` | Optional extra exact discovery hosts | Default empty. Review provider metadata before adding; no wildcard. |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | Web published catalog/cart | Token for the selected Headless channel; never Admin product proxy. |
| `SHOPIFY_TRUSTED_BUYER_IP_HEADER` | Web signed-in checkout | Exact ingress-overwritten buyer IP header, verified against spoofing. No guessed forwarded header. |
| `SHOPIFY_CHECKOUT_HOSTS` | Optional extra exact checkout hosts | Default empty; allow only actual verified Shopify response domains. |
| `SHOPIFY_ADMIN_AUTH_MODE` | Admin web health/workers: installed_oauth or same_org_client_credentials | Steve verifies actual supported installation path. |
| `SHOPIFY_SAME_ORG_CONFIRMED` | Same-organization grant only | false until ownership requirements are independently proven. |
| `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET` | Admin grant; secret also raw-body webhook HMAC | Installed app's private credentials; coordinate secret rotation. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_ADMIN_TOKEN_EXPIRES_AT` | Installed OAuth path only | Unexpired grant plus actual ISO expiry from reviewed external token broker; no permanent-token assumption. |
| `LOYALTY_APPROVER_STAFF_ID` | Web live approval | Joey's independently verified invited staff membership UUID. No sample/default approver. |
| `SHOPIFY_LOYALTY_CHECKOUT_VERIFIED` | Loyalty worker safeguard | false until actual evidence recorded; code gates also stay off. |
| `SHOPIFY_BREAK_CHECKOUT_VERIFIED` | Break checkout safeguard | false until real last-spot matrix passes; does not open purchases. |
| `NORTHSIDE_QR_ORIGIN` | Staff production label generation | Exact stable HTTPS app origin; no trailing slash/path. Missing blocks live labels. |
| `NOTIFICATION_ENCRYPTION_KEY` | Web/notification worker | Independent random 32-byte base64 key; back up privately, never reuse session key. |
| `NOTIFICATION_DELIVERY_ENABLED` | Web/notification worker | false. Real sends require separate authorization and verified recipients/configuration. |
| `RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM` | Optional email adapter | Private provider key and approved verified sender; recipients come from verified accounts. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | Optional push adapter | Stable VAPID pair; private key server-only, public key may reach browser. Actual mailto/HTTPS contact required. |
| `HOBBY_KEY_INTEREST_ENABLED` | Web optional interest collection | false. Consent/retention and owner review before capture; not a marketplace. |
| `ENABLE_EXPERIMENTAL_COREPACK` | Vercel build only: 1 | Host setup for pinned pnpm; no app runtime meaning. |
| `SMOKE_ORIGIN` | Local production rejection tests only | Default http://127.0.0.1:3001; wrapper rejects remote hosts. |
| `NODE_ENV`, `PORT` | Platform/runtime | Next build/start sets production behavior; choose host port, never use dev server as production. |

Supply only each process's required variables. Order/break/measurement readers need the chosen Admin path plus their own database role. Notification delivery needs its own role, encryption and provider settings. The web process needs auth/runtime/commerce/engagement access for its implemented routes; it never needs migration credentials. Worker auth-mode prerequisites are in SETUP-PROMPT-3.md. No `NEXT_PUBLIC_` secret is allowed. `pnpm release:check` scans generated client artifacts for sensitive configuration names and any supplied secret values; real hosting/proxy log redaction is still an external check.
