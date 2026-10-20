# Later native and Hobby Key phases

Both are deferred beyond this web release. No Apple/Google submission, marketplace or multi-shop sign-in has been created.

Reuse the domain services, PostgreSQL schema, tenant/customer authorization rules, ledger/reconciliation logic and provider contracts. Keep those operations server-side. Native code must not contain database credentials, provider secrets or privileged operational calls. A browser cookie flow does not automatically become a native authentication flow.

Before selecting an approach, run a small device prototype on physical iPhone and Android: Shopify/Supabase sign-in via supported external browser and secure return/deep links; logout/revocation; camera focus/orientation/permissions and scan fallback; native versus web push consent/delivery; offline privacy; accessibility; updates; and store distribution/review requirements.

| Option | Decision evidence needed |
| --- | --- |
| Native shell around the web experience | Verify embedded/browser auth restrictions, secure deep-link returns, camera bridge, push, offline screen locks and whether distribution/review requirements accept the useful native experience. Do not assume a webview alone qualifies. |
| React Native client using shared server contracts | Verify screen/navigation/accessibility effort, native auth/token storage, camera/push behavior and deployment/update requirements. Reuse validated types/domain rules where practical; web DOM/CSS components may need rewriting. |

Steve chooses the approach after these results, cost and maintenance review. No claim is made that every React web UI component can be reused unchanged or that UTMs survive app-store installation. Recheck current Apple/Google and Shopify native requirements during that phase.

Northside is the first tenant, scoped by shop/provider/subject. Hobby Key's current vendor-interest page is only consented interest capture and is off live. A marketplace needs explicit vendor onboarding, tenant permissions, catalog/payment/fulfillment contracts, support and retention decisions before implementation.

Every additional Shopify shop needs its **own authorized installation, scopes, credentials and webhook-to-tenant mapping**. Northside's OAuth grant cannot cover all vendors. Cross-shop account linking must deliberately prove control of both identities and record consent, un-linking/revocation and audit. An identical email is insufficient. Never merge customers, owned cards, order access or loyalty balances based on an email or an interest submission. Expand the existing isolation tests before serving a second shop.
