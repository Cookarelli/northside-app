# Customer in-store shopping — October 29, 2026

Implemented on `feat/customer-scan-handoff-20261029` in the existing
`work/staff-origin-20261017` checkout. All 41 pre-existing modified/untracked
files were backed up before editing. The existing scanner changes were extended;
unrelated work, manifests, lockfile, checkout safeguards and workers were retained.
No commit, external request, deployment, provider write or worker activation was
performed for this task.

## Implemented behavior

The app's **Scan Product** entry opens the existing camera/manual/image scanner.
It resolves only recognized QR/product URLs and registered manufacturer barcodes
through the existing restricted registry and read-only Shopify Storefront adapter.
Leading zeroes are preserved. It never fetches a scanned URL. Product-level QR
codes require an explicit registered variant choice. The product result includes
the catalog name, image (or an honest missing-image state), current USD price and
availability. Unknown, unpublished, unverified, out-of-stock or unknown-stock
variants cannot be added.

The customer explicitly adds the reviewed variant to an **in-store shopping list**.
This list supports merged variant lines, quantity entry/increase/decrease/removal,
complete contents and integer-cent subtotals. It reuses `CartQuantityControls`
from the existing live cart. The existing online Shopify cart remains available
through its original flow; shopping does not create a remote cart or reserve stock.

The new list uses opaque HttpOnly cookies, hashed handles, AES-GCM encrypted
persistence and verified tenant/customer ownership. Guest-to-customer binding is
committed before asynchronous checks; sign-out/account changes cannot recover a
bound list. Logout clears the shopping cookie. Writes use atomic version checks,
so duplicate/lost-response requests cannot silently add twice. Existing rehearsal
and new shopping states coexist inside the authorized `commerce` aggregate without
widening database or control-plane permissions. Sample/live data stays separate.

**Ready to Pay** revalidates all lines and freezes an unpaid snapshot. It issues
a high-entropy opaque reference and a locally generated QR containing only
`northside-handoff:v1:<reference>`. The handoff expires after ten minutes or when
the cart expires, whichever is earlier. A repeated readiness request returns the
same token. Canceling revokes it, retains the cart and allows editing again.
Expired/canceled references cannot be retrieved. No operation marks payment paid.

Authenticated staff look up the summary at `/staff/store/handoff`, verify the
physical items, current stock, final prices and tax, and enter them through the
register's normal workflow. The code does not assume external Shopify POS cart
import. The existing POS prototype is not installed, called or activated.

All private responses use no-store headers. No private shopping data enters the
PWA cache, provider credentials enter client code, or public activation flags change.
Production purchases, scanner activation, pickup, rewards and workers remain off.

## Exact local manual test

Use the existing installed dependencies. The dedicated launcher never installs
packages, loads private `.env` files, starts workers or calls providers. It copies
source into its own ignored local workspace, persists an independent local key
and staff password, and rejects non-loopback provider fetches.

```sh
cd /Users/northside/Documents/Codex/2026-10-03/files-pasted-by-the-user-build/work/staff-origin-20261017
export PATH="/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node scripts/shopping-local.mjs
```

1. Open `http://127.0.0.1:3104/`, then select **Scan Product**. Direct entry:
   `http://127.0.0.1:3104/scan`. Everything is labeled SAMPLE.
2. Enter `SAMPLE-BOX-BASE` and select **Check code**. Confirm the sample card-box
   image, exact selected variant, $12 USD price and availability. Alternatively
   paste `https://9i3hnb-jw.myshopify.com/products/sample-basketball-box?variant=8030`.
   This string is parsed locally; that URL is never fetched.
3. Select **Check code** again within three seconds: **Duplicate scan ignored**
   appears and the list stays unchanged. Lookup alone never adds an item.
4. Select **Add to cart**. Select **Increase** or enter quantity 2 and **Update
   quantity**. Confirm the $24 subtotal. Quantity 4 is rejected because the sample
   has three available. Decrease quantity, then remove; confirm the empty state.
5. Check `UNKNOWN-BARCODE`: lookup fails safely. Check `SAMPLE-BOX-SOLDOUT`:
   **Add to cart** is disabled. A blank barcode is rejected by the required field.
6. Recheck/add `SAMPLE-BOX-BASE`. Open **View complete cart** or the cart icon;
   both open `http://127.0.0.1:3104/cart?inStore=1`.
7. Select **Ready to Pay**. Confirm **UNPAID — payment has not been completed**,
   disabled editing, QR, reference, expiration and the staff-assisted register
   explanation. Reload: the same handoff and complete cart remain available.
8. Open `http://127.0.0.1:3104/staff/store/handoff` in another tab. Before staff
   sign-in, retrieval is denied. Select **Staff sign-in**, use the generated
   `staffPassword` from `.runtime/customer-shopping-local/local-only.json`
   privately in your editor, then return to `/staff/store/handoff`. This is the
   separate local rehearsal identity, never a production staff identity.
9. Paste the customer's reference, or the entire `northside-handoff:v1:…`
   scanner output, and select **Look up unpaid summary**. Confirm exact variant,
   quantity, subtotal and UNPAID status. The summary is a manual register aid.
10. On the customer tab select **Cancel handoff and keep shopping**. Editing
    unlocks and the cart remains. Repeat the staff lookup: the old reference is
    unavailable. Generate a new handoff; its reference differs. After ten minutes
    it expires; cancel it and regenerate to continue.
11. Stop the launcher with Ctrl+C. Its data stays isolated under
    `.runtime/customer-shopping-local/`; rerunning keeps the same local list/key.

Camera testing requires the browser's actual permission and a physical device.
Manual entry and saved QR images work without camera permission. Installed PWA,
iPhone/Android camera behavior and physical register scanning remain unverified.

## Local validation

Independent verifier used Node 24.22.1 and the existing patched, dependency-ready
workspace `.runtime/launch-implementation-20261029/source` synchronized with this
checkout, without private environment files or dependency/network operations.

| Check | Result |
| --- | --- |
| Root script tests | 6/6 pass |
| Root Vitest | 127/127 pass |
| Customer scripts | 17/17 pass |
| Customer application | 290/290 pass, including 15 new shopping tests |
| Total | **440/440 pass; zero outstanding test failures** |
| Root/customer typecheck | Pass |
| Root/customer lint | Pass; one pre-existing root unused-variable warning |
| Customer, Control, Webhooks production builds | Pass |
| Client server-configuration scan | 122 artifacts pass; no real secrets supplied |
| Diff whitespace | Pass |

Initial loopback-listener test failures were sandbox `listen EPERM`; the unchanged
local-only suites passed after escalation. A test-only TypeScript readonly
assignment was corrected before final checks. No failed check was removed or
weakened. The final shell cart-icon adjustment received its own typecheck, scoped
lint, production build and client scan; unchanged full-suite evidence was retained.

Browser evidence: actual local barcode resolution, product image, add, quantity
change, subtotal, complete-cart navigation/reload, unpaid QR/reference, real local
staff sign-in/retrieval, canceled-reference rejection, duplicate suppression,
unknown barcode, sold-out disablement, removal and actual saved-label PNG decoding.
Customer phone viewport 390×844 and staff tablet viewport 820×1180 had matching
client/scroll widths with no horizontal overflow. These are desktop browser
viewports, not physical-device acceptance. The file-chooser return preceded the
asynchronous decoder result; the later product result confirmed actual decoding.

Independent review found and resolved namespace compatibility, local key setup,
staff response races, ownership binding and near-cart-expiry display issues.
Verification logs, exact commands and hashes are in
`.runtime/customer-shopping-verification/summary.json` and its adjacent logs.

## Remaining blockers

The local fixture journey is usable. Public scanning remains deliberately gated.
Live use still needs independently approved/published Shopify variant/barcode/QR
mappings and retail projections, the configured HTTPS origin, hosted least-privilege
persistence/auth acceptance, and physical phone/scanner/register testing. Online
availability is not a shelf count or a stock reservation. Provider stock/prices
may change after a read; the register must confirm the final sale.

Direct Shopify POS import remains unavailable. The implemented fallback is
authenticated staff-assisted manual entry. This work does not complete payment,
write inventory, enable checkout/pickup, change Shopify settings, configure hosted
roles, activate workers or bypass Vercel authorization.
