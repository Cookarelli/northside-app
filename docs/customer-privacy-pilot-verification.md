# Customer login and private Storage pilot verification

October 20, 2026. Protected Preview only. Purchases, collection, POS, commerce
processors and real workers remain disabled. No production publication or merge.
The separate passive Shopify delivery follow-up remains active.

## Verified against the hosted pilot

The Customer and Control acceptance checks inspected the exact Preview projects,
repository, integration branch and deployment IDs before and after execution.
At this checkpoint both run source `13f3516aaeda7c257a5c94f5101b39e43543def0`:

- Customer: `dpl_9jwcJKUffdXHt61LyeiGpSNYs39H`.
- Control: `dpl_9xjtEULVxSuRdc4189TfTwhDtEYR`.

An independent check at 19:36:05 UTC confirmed both exact Vercel projects retain
SSO protection for all deployments. Anonymous GETs to Customer `/account` and
Control `/mission-control` each redirected to Vercel authentication (302).

All ten application acceptance checks passed: catalog/product display, anonymous
customer-data denial, disabled cart/pickup, anonymous Control denial and invalid
webhook-signature rejection through authorized Vercel access. The runner's
additional public Customer-webhook probe returned a protection response and
remains BLOCKED by design; Shopify uses the separately deployed receiver.

Nine additional negative checks passed with exact error-only JSON and no-store:
anonymous private-file access; Shopify callbacks without a valid attempt cookie;
foreign-origin POSTs to logout, customer login, staff request/callback/invite; and
cross-site logout even with the correct Origin. No real session, valid provider
grant, email address or invitation was supplied to these probes.

Two real Shopify customer accounts completed their normal login in the in-app
browser. Both survived reload. The first opened the private grading portal; both
were rejected by the staff workspace. The second has the same email as the
invited staff owner, but `/api/private/me` still returned customer with no staff
role: email equality did not grant staff access. On logout, other private tabs
closed. After the second logout, reload stayed signed out and `/api/private/me`
returned `sign_in_required`; browser Back did not restore the prior card page.
An aggregate read-only database query verified both sessions created during this
test were revoked and their encrypted provider-token fields replaced by the
revocation marker. No session hash or provider token was read into evidence.
The owner separately signed into staff in Chrome and opened the grading desk.

## Live Storage test and limits

Read-only inspection of Supabase `nrsuosydvjqovrevmych` initially found one Shopify
identity, zero card records, zero ready generic file records and zero objects in
`northside-private`. The second normal login then created a second verified
identity. The bucket is private. Its restrictive ALL policy covers both `anon`
and `authenticated`, with matching USING/WITH CHECK exclusions for this bucket.
Card and file RLS are enabled; their owner is postgres. FORCE RLS is not set on
these two tables. The separate auth/runtime roles are neither superusers nor
BYPASSRLS roles and do not own the tables. No policy or grant was changed.

An independently reviewed operator-only test created a disposable one-pixel PNG
under a unique `pilot-storage-isolation/<uuid>/` prefix. It created no customer,
card, custody, fee, payment or application file record. Existing private API
configuration was read only in memory. Credentials, signed URLs and response
bodies were not printed or saved. The live test verified:

- Private bucket metadata, unique empty prefix and non-upsert upload.
- Exact bytes through server-authorized download.
- Public, unauthenticated and publishable-key downloads denied.
- Anonymous listing empty and anonymous signing denied for the existing object.
- Server-issued 60-second signed URL initially downloads the exact bytes.
- The same URL returns 400 `InvalidJWT` after its deadline, while a separate
  server-authorized request still retrieves the exact object.
- Cleanup removes only the newly created path; its prefix is confirmed empty.

During the first live run, a read-only `SET LOCAL ROLE authenticated` query also
returned zero visible rows for the then-existing test object. This checks the
database role's policy, not a real Supabase user JWT or app customer session.

The final bounded repeat passed 14/14 checks at 19:31:41 UTC. Earlier results are
retained: the first preflight stopped before any request because a public config
file was 0644, and the first live run denied the expired URL but failed an overly
specific English error-text assertion. Both live objects were cleaned up.
The repaired test checks the actual deadline, denied response and continued
object existence instead of relying on English error text. No application or
security configuration was weakened to obtain a pass.

This is bucket and signed-URL evidence, **not yet full customer file ownership
verification**. In particular, grading photos use an authenticated app route
that returns verified bytes directly, not a signed URL. That route authorizes
the exact tenant/card/photo before accessing Storage.

## Independent local checks

90/90 tests passed with an empty process environment apart from the executable
PATH, no private configuration and no hosted mutations:

- 57 privacy, Storage policy and OIDC/session tests.
- 33 photo/exam and customer grading-portal tests.

These cover cross-customer/tenant isolation, file authorization, restrictive
Storage policy behavior even alongside a broad permissive policy, staff limits,
OIDC signature/state/PKCE/claims, refresh failure revocation, logout, photo
normalization, upload recovery, private note/draft exclusion and immutable
published evidence. Local PGlite and mocked provider checks remain labelled local.

## Remaining real-file handoff

The owner confirmed two controlled accounts and a real card/photo are available,
and selected the first customer account for this test.
Staff intake is open in the authenticated Chrome session. The owner must enter
the actual physical card details and quantity, select the correct verified
customer, and upload its photo through the normal app until private Storage is
confirmed. No invented custody or fixture record is being inserted into the
hosted database. Publication, dispatch and collection are outside this test.

After upload, verify the owning customer's list/detail/image, then the exact
same card/photo URL under the other real customer's session and anonymously.
Require denial without private metadata or image bytes, recheck after logout,
and verify the original saved record/photo remains intact. Real provider token
refresh, native phone/tablet camera handling and multi-device/cache behavior
beyond this browser session remain separate acceptance work.

## Reproducibility and private evidence

Run the existing local suites from `apps/customer` with bundled Node 24:

```sh
node --conditions=react-server --import tsx --test \
  tests/privacy.test.ts tests/storage.test.ts tests/oidc.test.ts \
  tests/exam.test.ts tests/grading-portal.test.ts
```

The existing `scripts/pilot-acceptance.mjs` performs the bounded anonymous
Preview checks using the authorized Vercel CLI. Ignored, sanitized evidence for
this run is in `.runtime/pilot-acceptance-NuNi7k/report.json`,
`.runtime/hosted-auth-negative-7TDqjH/report.json` and
`.runtime/storage-isolation-report.jsonl`. The private Storage helper is
operator-only and creates a temporary object; do not run it as an app worker,
heartbeat, ordinary build step or production gate.

Official references checked: [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[API key restrictions](https://supabase.com/docs/guides/getting-started/api-keys#known-limitations),
[signed URLs and CDN caching](https://supabase.com/docs/guides/storage/cdn/smart-cdn#signed-urls-and-cdn-caching).
