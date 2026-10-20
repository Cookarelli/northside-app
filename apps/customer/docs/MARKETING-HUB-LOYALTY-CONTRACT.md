# Northside loyalty cohort export — proposed contract v1

Status: implemented local CSV export, September 12, 2026. No live Marketing Hub endpoint, connector, delivery schedule or third-party data upload is configured. This document defines Northside’s output; it does not claim the Marketing Hub has accepted it. Broader consent/delivery workflows remain a later stage.

Authorized staff can select a UTC period of at most 366 days at `/staff/rewards` and choose **Export aggregate cohort CSV**. The authenticated API reads `GET /api/private/loyalty?export=1&from={ISO}&to={ISO}` and returns a JSON object with a `csv` string. The browser downloads that string. Requests require owner/admin/operations/read-only staff permission. No public export endpoint exists; customer/content-editor access is denied. Local samples use only the guarded fixture endpoint.

| CSV field | Meaning |
| --- | --- |
| `contract` | Literal `northside_loyalty_cohorts_v1`. |
| `period_start_utc` | Inclusive ISO UTC start, filtered by original order creation time. |
| `period_end_exclusive_utc` | Exclusive ISO UTC end. |
| `campaign_ref` | Registered opaque first-campaign reference from the order snapshot, or `unattributed`. Incoming unregistered references are normalized away. Never a customer identity or URL. |
| `cohort` | `enrolled_at_purchase` when the verified account enrollment timestamp precedes/equal the order timestamp; otherwise `not_enrolled_at_purchase`. It is not a causal treatment assignment. |
| `orders` | Count of current saved Shopify order snapshots with recorded paid time in this group. For fewer than five identified customers: `suppressed (<5 customers)`. |
| `customers` | Distinct non-null verified internal owners, exported only as a count. For fewer than five: `suppressed`. Anonymous orders do not add an identified customer. |
| `loyalty_qualifying_cents` | Current summed eligible loyalty spend for these snapshots, integer USD cents, or `suppressed`. Returns/edits may change this later; this is not gross/net store revenue. |
| `currency` | Literal `USD`. |
| `source` | Literal description of reconciled Shopify snapshots and the non-incremental-sales limitation. |

Rows group by campaign and enrollment cohort. Every cell is quoted; leading spreadsheet-formula characters are neutralized. No names, emails, Shopify/internal customer IDs, order IDs, reward codes, authentication data, grading details, consignment proceeds, private staff notes or individual histories are exported. A small cohort still exposes its campaign/cohort labels; counts and amounts are suppressed. Suppression is a disclosure reduction, not a differential-privacy guarantee, and repeated overlapping exports are not rate-limited for inference resistance in this stage.

The dataset covers saved loyalty order snapshots only. Orders before launch/enrollment or unresolved ownership can have zero qualifying spend; that means no recognized loyalty qualification, not no sale. Canceled or refunded snapshots with a recorded paid time remain in order counts while their qualifying amount reflects the current reconciled state. The current eligible spend can differ from what was known at the end of the requested period. Pipeline delays, order access limits, exclusions and staff review affect completeness. Export does not synthesize a historical as-of revenue ledger.

The first eligible campaign reference originates in the Prompt 3 consent/registry path. Before connecting a real recipient, agree delivery authentication, retention, access control and consent/withdrawal handling; no external identity mapping is supplied here. Neither member/nonmember comparisons nor campaign totals prove incremental sales, lift or attribution causality. Do not relabel loyalty-qualified spend as consignment payouts, cash liability or total retail revenue.

Local tests verify role restrictions, period validation, aggregate values, formula protection and small-cohort suppression. Acceptance by the actual Marketing Hub and any real export transmission remain unverified and unperformed.
