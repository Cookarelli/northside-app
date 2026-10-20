-- Pin the twelve trigger functions reported by the hosted search-path advisor.
-- Additive hardening only: preserve bodies, signatures, ownership, ACLs and
-- SECURITY INVOKER behavior. The original thirteen migration hashes stay intact.
begin;
alter function ns.prevent_rewrite() set search_path = pg_catalog, ns;
alter function ns.freeze_grading_card() set search_path = pg_catalog, ns;
alter function ns.freeze_grading_rate() set search_path = pg_catalog, ns;
alter function ns.freeze_consignment_link() set search_path = pg_catalog, ns;
alter function ns.loyalty_fixed_record() set search_path = pg_catalog, ns;
alter function ns.freeze_break_identity() set search_path = pg_catalog, ns;
alter function ns.freeze_store_identity() set search_path = pg_catalog, ns;
alter function ns.freeze_exam_photo() set search_path = pg_catalog, ns;
alter function ns.guard_exam_publication() set search_path = pg_catalog, ns;
alter function ns.snapshot_exam_photos() set search_path = pg_catalog, ns;
alter function ns.guard_exam_photo_snapshot() set search_path = pg_catalog, ns;
alter function ns.grading_audit_source() set search_path = pg_catalog, ns;
commit;
