# Grading / Track My Cards — website connection

Inspected September 16, 2026, before changing app navigation. **Live website editing is deferred by the user (“later”).** This handoff prepares the connection without inventing a deployed portal address or changing the Square site.

## Architecture actually observed

The public [Northside homepage](https://www.northsidecollectibles.com/) identifies its generator as **Square Online**. Its delivered source sets the Square Online app origin, loads website assets from `cdn3.editmysite.com`, and contains Square/Weebly bootstrap navigation/page records. No Shopify theme is present in the inspected homepage source. The live website is separate from this repository's Next.js application.

The current top-level navigation includes Home, Shop Products, Live Breaks, Consignment Program, **PSA Grading Service**, Northside Card Show, Gift cards, Contact Us and Socials. The grading page's route is [grading-service](https://www.northsidecollectibles.com/grading-service). The initial guessed `/grading` route was not assumed to exist on Square. The observed source is retained privately in ignored `work/portal-verification/website.html`; no Square editor session or account credentials were accessed.

## Prepared connection

| Item | Value |
| --- | --- |
| Navigation label | **Grading / Track My Cards** |
| Target | The verified public portal origin followed by `/grading`. The origin is not yet supplied/deployed; do not publish a localhost or placeholder URL. |
| Placement | Alongside the existing PSA Grading Service navigation entry; keep that existing service-information page. |
| Optional service-page button | **Track my cards**, linking to the same portal entry. |
| Window behavior | Normal same-tab navigation. No iframe or account-token query string. |
| Customer records | The existing `/my-cards/grading` portal and its tenant-scoped records. |
| Identity | Existing Northside Shopify customer sign-in. Square login is not substituted or silently merged. |

The app now has a responsive `/grading` entry and a **Grading / Track My Cards** footer link. Its **Track my cards** button opens the shared customer portal. A collector arriving without a session follows Shopify sign-in and returns to the requested grading list, exact card or exam. Authentication occurs on the portal origin, so no third-party iframe cookie dependency is introduced.

When the live connection is resumed, first verify the actual HTTPS deployment and Shopify callback/logout configuration. In the authenticated Square Online editor, add the external navigation link using the verified portal URL above, and optionally add the service-page button. Inspect desktop and mobile navigation, follow the link through a real Shopify sign-in, and confirm the return destination and private account isolation before publishing the reviewed website change. The Square admin interface itself has not been inspected; this document does not claim that a particular editor menu or save operation has been verified.

No Square product, checkout, service form or current navigation item was changed. No live PSA prices were copied into app quotes. The unconfirmed “BGP” provider is not advertised. See [customer grading workflow and tests](CUSTOMER-GRADING.md).
