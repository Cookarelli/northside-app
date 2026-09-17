# Backup and restore runbook

Prepared September 12, 2026. **No hosted backup or restore was performed.** The local automated rehearsal in `tests/release.test.ts` uses an isolated PGlite database and restores table counts, balances, a pending reward reservation, customer isolation and immutable history. It does not validate hosted PostgreSQL, Supabase Auth or Storage recovery.

## Define and protect the recovery set

Steve and the database operator must choose and record a recovery-point objective, recovery-time objective, retention period, encrypted off-site destination and recovery owner before real records are accepted. Also record the tested app commit, migration hashes, PostgreSQL major version, backup start/end and object inventory. No paid backup plan is assumed or activated.

The recovery set includes `ns` **and `ns_migrations.applied`**, SQL functions/triggers/RLS/grants and five custom roles; Supabase Auth users/configuration and the matching invited staff IDs; private Storage object bytes and metadata; approved origins/provider installation settings; and separately protected session/notification encryption keys and push keys. A database-only backup is incomplete. [Supabase documents that Storage object bytes are excluded from database backups](https://supabase.com/docs/guides/platform/backups).

Use a private maintenance workspace outside the repository for actual customer exports. Set restrictive permissions, disable shell tracing/history of secret values, and encrypt archives before transferring them to the approved destination. Never commit a dump, signed URL, secret, recipient list or real customer export. Record checksums and counts, not customer rows, in release evidence.

## Hosted procedure — run only on the reviewed source and isolated target

1. Inspect the selected project's existing backup capability and restore permissions. Stop application writes, uploads and scheduled workers for a coordinated backup window; preserve/route incoming Shopify deliveries into the authoritative receipt store and account for that window during replay. Database snapshots and file copies must describe a compatible point in time. Do not change Shopify catalog/inventory to take a backup.
2. Use Supabase's supported logical backup/export flow with a compatible PostgreSQL client and direct/session connection. The reference commands below are templates, **not commands executed in this delivery**. `NORTHSIDE_BACKUP_SOURCE_URL` and `NORTHSIDE_RESTORE_TARGET_URL` must be supplied privately by the operator; neither is a public runtime variable. Select a brand-new empty restore project, not the existing source. Do not put secret literals into terminal history.

```sh
umask 077
supabase db dump --db-url "$NORTHSIDE_BACKUP_SOURCE_URL" -f roles.sql --role-only
supabase db dump --db-url "$NORTHSIDE_BACKUP_SOURCE_URL" -f schema.sql
supabase db dump --db-url "$NORTHSIDE_BACKUP_SOURCE_URL" -f data.sql --use-copy --data-only
```

3. Inspect dump coverage for `ns`, `ns_migrations`, grants, functions and data. Preserve Northside's custom Storage bucket policy from migration 002 separately if the managed-schema dump omits it; inspect the actual Auth/Storage changes on the source. Copy private object bytes using an authorized Storage export path; record object key, byte length and content hash privately. Confirm every ready `ns.file_objects` entry is represented. Preserve migration hashes with the snapshot, never manufacture an applied-migration row after restore.
4. Review managed-role/schema differences with the operator before restoring. Do not blindly ignore errors. The supported isolated logical restore pattern is:

```sh
psql --dbname "$NORTHSIDE_RESTORE_TARGET_URL" --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --command 'SET session_replication_role = origin'
```

Disabling triggers here is only for the privileged isolated restore: replaying data with normal insert triggers could double-update cached points or enqueue messages. Re-enable triggers before any validation or serving requests. Restore private object bytes to a private bucket and reapply/verify the exact restrictive Storage policy if omitted by the managed-schema export. Reset custom login passwords privately and verify grants, non-superuser/non-BYPASSRLS roles, pooling and TLS. Do not grant migration-owner rights to fix a runtime error. Follow [Supabase's backup/restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) for managed-schema differences; its commands have not been tested against Northside's account.
5. Restore required encryption keys privately; revoke restored application sessions and require fresh login. Keep all public code gates, email/push and scheduled jobs off on the restore target. Keep copied provider grants unused until target identity/callbacks and outbound behavior are reviewed. A restored scheduler must not accidentally send old notifications or issue discounts.
6. Compare complete table counts and migration hashes with the snapshot. Verify append-only history, ledger/cache equality, reservation holds, voucher mappings and restoration caps. Test customer A/B and another tenant, pooled grading batches, staff roles, exports, and private files including direct access denial and signed-link expiry. Verify a sample file's bytes/hash and that unexpected objects are reported. Test actual concurrent PostgreSQL workers and restart. PGlite cannot certify these hosted checks.
7. Reconcile the recovery gap against **current** Shopify paid/refunded orders and still-existing voucher codes before retrying financial jobs. Code creation may have succeeded after the backup. Keep stable codes/holds until proven; never recreate a voucher with a new code or release a hold from an empty local mapping. Review notification acceptance and the 23-hour retry cutoff; do not resend from a restored stale outbox just because local state is pending. Reconcile externally recorded break commitments and consignment settlements from independent evidence; the app cannot send money or refund an external payment.
8. Record elapsed restore time, recovered point, discrepancies, accepted evidence and operator sign-off. Only then select a reviewed cutover. Preserve the original source/failed state until retention and investigation permit cleanup. An app rollback alone does not restore data or undo a Shopify action.

The supplied Supabase project has not been inspected after login. Backup coverage, Auth email settings, storage transfer, role provisioning and a physical-device recovery test remain launch blockers. Confirm actual CLI version/options on the selected host before a hosted rehearsal; the CLI is not installed by this project.

## Local sample preservation

The sample directory is not a real customer backup. Before copying `work/grading-preview/` and its paired `work/grading-photos/`, stop the single preview server cleanly and confirm it has exited. Copy both complete directories into a new timestamped private local location; never open the same directory with two processes. Test a copy in an isolated rehearsal rather than replacing the working preview. `tests/release.test.ts` uses its own temporary database/archive, leaves the user's saved preview untouched, and removes only its own temporary fixture afterward.

## Northside Exam recovery addition — September 16

Include the five exam tables from migration `20260916174953_grading_photos_and_northside_exam.sql`, their RLS/immutability triggers, and every referenced `northside-private` photograph, including images retained by older published revisions. Do not prune objects merely because they are no longer active. Preserve pending upload metadata as well as confirmed records, raw-file identity hashes and stored-byte hashes.

After restoration, confirm front/back downloads against their stored hashes, reopen drafts and every selected published revision, inspect a printed report, and verify private notes/paper images remain hidden from customers. A missing or mismatched object must not be marked complete or silently replaced. Resume uncertain attempts with the same file and card identity. `tests/exam.test.ts` closes/reopens an isolated database and local image directory to prove local persistence; it does not certify a coordinated hosted restore.

## Customer grading approval recovery addition — September 16

Preserve `ns.grading_quotes`, `ns.grading_approval_requests` and `ns.grading_approval_cards`, their immutable revision/order identities, exact selection snapshots, actor/time and linked exam/photo evidence. Include batch service, card membership and immutable grading audit history: dispatch history freezes service/membership even when a card's later status is On hold. Restore the two customer grading migrations' functions, RLS and dispatch guards with the same data point. Never manufacture approval from a Ready to submit status or upgrade a historical legacy consent into current approval.

After isolated restoration, compare quote/exam/decision revisions, selected returns and current approval results. Verify that stale or absent approval still blocks single-card and selected-batch dispatch, including a service mismatch. Reopen an owned receipt/report/CSV and deny another owner/tenant. A response-loss retry must resolve the original immutable request, without duplicate decisions or recreated cards. `tests/grading-portal.test.ts` closes/reopens database and private images for local persistence evidence; coordinated hosted restore and multiple concurrent PostgreSQL connections still need acceptance.

## Staff custody recovery addition — September 16

Include the new custody migration, all staged scan histories, dispatch headers/exact manifests, outcome revisions, pickup headers/selected cards/returned photo references, operation requests, status import mappings/versions/fingerprints, withdrawal reviews and grading notification topic/jobs. Preserve original and returned private image bytes, including snapshots no longer active. Restore immutable evidence and original request keys; never regenerate manifests, approvals, recipient acknowledgments or queue jobs from status alone. Reconcile physical cards and any externally accepted notifications before resuming. Local operations tests close/reopen the paired database and images, then verify manifest/release/retry/notification persistence and cross-owner denial. This is not hosted restore evidence.
