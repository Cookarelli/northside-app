begin;
-- Existing batches migrated with an unset service. It can be configured before
-- dispatch; immutable card audit history prevents rewriting dispatched service
-- even if staff later puts a card back on hold or completes its return.
create function ns.guard_dispatched_batch_service() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if (new.provider,new.service) is distinct from (old.provider,old.service) and exists(
  select from ns.card_items c join ns.grading_audit a on a.tenant_id=c.tenant_id and a.object_id=c.id
  where c.tenant_id=old.tenant_id and c.batch_id=old.id and a.after_record->>'status_key' in ('sent_to_grader','grader_received','grading')
 ) then raise exception 'Create a new batch to change provider or service after dispatch'; end if;
 return new;
end $$;
revoke all on function ns.guard_dispatched_batch_service() from public;
drop trigger grading_batch_identity on ns.grading_batches;
create trigger grading_batch_service_guard before update on ns.grading_batches for each row execute function ns.guard_dispatched_batch_service();
drop function ns.guard_grading_batch_identity();
create or replace function ns.guard_dispatched_batch() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if new.batch_id is distinct from old.batch_id and exists(select from ns.grading_audit where tenant_id=new.tenant_id and object_id=new.id and after_record->>'status_key' in ('sent_to_grader','grader_received','grading')) then raise exception 'Dispatched card batch cannot change'; end if;
 return new;
end $$;
revoke all on function ns.guard_dispatched_batch() from public;
commit;
