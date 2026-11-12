# October 29 — local retail scan-to-cart implementation

Branch `fix/launch-readiness-20261029`, HEAD
`9f74e7c725fc9a0d85482afb91c73e6627979521`, unchanged. The 34 previously dirty
files were fingerprinted before work; all were preserved. Only the previously
modified Storefront module was extended, and status documents were appended.
No other checkout was edited. No commit, merge, deployment, live inventory
write, payment, hosted migration, disabled worker activation or external
network request was performed.

**Current receipt status: UNVERIFIED. Current deployed Customer and Mission
Control Vercel authentication: UNVERIFIED.** Neither is a pass or failure.
External polling has stopped at the user's request. Earlier observations are
historical. The app automation view operation itself was blocked by automatic
approval-review model capacity, so the saved monitor could not be paused through
the tool. No alternative network route or approval bypass was attempted.

## Concrete implementation

The scanner now submits an explicit `scan-add` contract containing the exact
code that produced its displayed result, selected variant, quantity and reviewed
USD cents. Edited manual input cannot silently replace that confirmed code.
The request parser rejects unknown fields, browser identity/cart IDs, buyer
tokens, arbitrary price-setting fields and malformed quantities/codes.

Under the existing encrypted saved-cart ownership/locking path, the service:

1. Resolves the original code again through the restricted runtime registry
   projection and fresh Storefront catalog lookup. It never fetches a scanned
   URL. Barcode leading zeroes are preserved.
2. Rejects fixture projections, mismatched barcode variants, unpublished or
   unverified variants, and variants without an active approved retail locator.
   Product-level QR codes require an explicit registered variant choice.
3. Compares the reviewed price with current Shopify USD cents. That value is
   only a comparison; the browser cannot set the Shopify price.
4. Runs the existing break-cart policy against the proposed whole basket.
5. Reuses Storefront addLine, rechecking aggregate stock across split lines and
   comparing the final availability-query price before cartLinesAdd. Independent
   review caught the price-change window between the two provider reads; it was
   fixed and regression-tested.

Scanning alone never mutates a cart. This is not stock reservation, shelf-stock
proof, pickup authorization or payment confirmation. Shopify can still change
stock/price after a read; its mutation response and existing checkout review
remain authoritative. No automatic retry of an uncertain cart addition was
introduced. Physical repeated-click/lost-response acceptance remains required.

The existing same-origin, purchase and scanner gates precede registry/provider
access. They remain OFF. The staff preview's real add button remains disabled.
The new flow is exercised through injected local provider fixtures and actual
PGlite registry/RLS projections, not through a newly exposed live/test endpoint.
The metadata-only webhook receiver and all processor defaults are unchanged.

## Exact changed files this turn

- `apps/customer/lib/server/scan-cart.ts` — new scan/cart orchestration.
- `apps/customer/lib/server/cart-input.ts` — strict scan-add contract.
- `apps/customer/lib/server/storefront.ts` — optional final reviewed-price check.
- `apps/customer/app/api/commerce/cart/route.ts` — gated scan-add integration.
- `apps/customer/components/store-scanner.tsx` — bind add to the resolved code.
- `apps/customer/tests/scan-cart.test.ts` — nine local acceptance tests.
- `apps/customer/docs/STATUS.md`, `docs/STATUS.md` — current evidence/status.
- `docs/shopify-store-event-verification.md` — polling stopped; UNVERIFIED notice.
- `docs/local-commerce-20261029.md` — this report.

## Local verification

Checks ran against synchronized source in the existing isolated, patched
workspace `.runtime/launch-implementation-20261029/source`, without private
environment files. No dependency or manifest changed. No registry/audit request
was attempted; the previous zero-advisory audit is historical, not a fresh result.

| Check | Result |
| --- | --- |
| Customer scripts | 17/17 pass |
| Customer application tests | 275/275 pass, including 9 new scan/cart tests and existing HMAC/deduplication/retry/order-ownership/refund tests |
| Root core tests | 126/127 pass; worker-service simulated HTTP test fails with loopback `listen EPERM` |
| Pilot runner tests | 5/6 pass; child-curl isolation test fails with loopback `listen EPERM` |
| Total distinct final results | 423 pass, 2 sandbox-blocked failures; full `pnpm test` is NOT green |
| Lint | Pass; one existing unused-variable warning in agent-runtime/control.ts |
| Typecheck | Pass, root and customer |
| Production builds | Customer, Control and Webhooks pass using supported `next build --webpack`; customer rebuilt after final fix |
| Client artifact scan | 118 pass for server-configuration names; no actual provider secrets supplied |
| Diff whitespace checks | Pass |
| HTTP smoke/browser/device acceptance | Not run; loopback listener restrictions remain. No mobile/desktop acceptance claimed for this turn |

No tests were removed or weakened. Earlier failing output is retained. An initial
new price regression failed because its test provider did not yet return the
separate final price; that fixture wiring was corrected and both the focused
suite and complete customer suite rerun successfully. Independent review found
no remaining actionable issue in the narrow additions after the price fix.
Evidence: `.runtime/local-commerce-20261029/`, especially
`scan-cart-final.log`, `customer-test-final.log`, `core-test.log`, `test.log`,
`lint-final.log`, `typecheck-final.log`, `build.log`,
`build-customer-final.log` and `client-scan.log`.

## Incomplete components and next implementation boundaries

| Component | Current incomplete portion |
| --- | --- |
| Checkout | Staff-only guest development-store path exists. Authenticated test customers still need a separate test identity/cart/order realm; do not share live customer tokens or financial ledgers with a development shop. Real hosted checkout is unverified. |
| Webhooks/orders | Raw HMAC, durable deduplication, retry and cancellation/refund reconciliation pass fixtures. Natural delivery receipt and deployed behavior are UNVERIFIED. Metadata importer/processor remains disabled; hosted role/concurrency proof is outstanding. |
| Barcode/QR | New registered scan-to-cart service contract passes local fixtures. Public scanning stays off; exact published variant/barcode/location mappings and real phone/camera/printed-label tests remain unverified. Online stock is not retail shelf stock. |
| POS | Protocol prototype and local tests exist; packaged extension, authenticated installation/location-bound handoff backend and physical POS import/payment correlation are incomplete. |
| Loyalty | Ledger/refund/hold contracts exist; Joey-approved economics and real discount/refund acceptance remain outstanding. Earning/redemption and workers remain off. |

Next work: implement the isolated authenticated development-store realm; finish
location-authorized POS handoff only if required for controlled testing; run
hosted and physical acceptance after explicit permission and access are available.
None of those external checks was attempted here. Controlled local fixture
execution is ready; live sales and complete physical checkout/POS are not.
