begin;
-- Quotes are per physical card. Every saved revision is immutable and visible
-- to that card's collector; null is unquoted, never zero/free.
create table ns.grading_quotes (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), card_id uuid not null,
 revision integer not null check(revision>0), request_id uuid not null,
 provider text not null, service text not null default '' check(length(service)<=120),
 grading_cents integer check(grading_cents between 0 and 10000000),
 shipping_cents integer check(shipping_cents between 0 and 10000000),
 insurance_cents integer check(insurance_cents between 0 and 10000000),
 other_cents integer check(other_cents between 0 and 10000000),
 other_label text not null default '' check(length(other_label)<=160),
 terms text not null default '' check(length(terms)<=3000),
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,id), unique(tenant_id,card_id,id), unique(tenant_id,card_id,revision), unique(tenant_id,request_id),
 foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),
 foreign key(tenant_id,provider) references ns.grading_providers(tenant_id,key),
 foreign key(tenant_id,created_by) references ns.staff_memberships(tenant_id,id),
 check(other_cents is null or other_cents=0 or length(trim(other_label))>0)
);
create table ns.grading_approval_requests (
 tenant_id uuid not null, id uuid not null, customer_id uuid not null,
 choice text not null check(choice in ('submit','return')), selection jsonb not null check(jsonb_typeof(selection)='array' and jsonb_array_length(selection) between 1 and 100),
 sequence bigint generated always as identity, created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,id), foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id)
);
create table ns.grading_approval_cards (
 tenant_id uuid not null, request_id uuid not null, card_id uuid not null,
 quote_id uuid, exam_revision_id uuid, card_version integer not null,
 primary key(tenant_id,request_id,card_id),
 foreign key(tenant_id,request_id) references ns.grading_approval_requests(tenant_id,id),
 foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),
 foreign key(tenant_id,card_id,quote_id) references ns.grading_quotes(tenant_id,card_id,id),
 foreign key(tenant_id,card_id,exam_revision_id) references ns.grading_exam_revisions(tenant_id,card_id,id)
);
create index grading_approval_card_history on ns.grading_approval_cards(tenant_id,card_id,request_id);
alter table ns.grading_batches add column service text not null default '' check(length(service)<=120);

do $$ declare t text; begin
 foreach t in array array['grading_quotes','grading_approval_requests','grading_approval_cards'] loop
  execute format('alter table ns.%I enable row level security',t);
  execute format('grant select on ns.%I to northside_runtime',t);
  execute format('create trigger immutable before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
 end loop;
end $$;
grant insert on ns.grading_quotes to northside_runtime;
create policy quote_read on ns.grading_quotes for select to northside_runtime using(exists(select from ns.grading_cards c where c.tenant_id=grading_quotes.tenant_id and c.card_id=grading_quotes.card_id and ns.grading_access(c.tenant_id,c.case_id)));
create policy quote_write on ns.grading_quotes for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']) and created_by=(select staff_id from ns.context()));
-- The full selected-card list is visible only to the authenticated decision
-- maker or staff, never to another owner who shares a physical batch.
create policy approval_read on ns.grading_approval_requests for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and (customer_id=(select customer_id from ns.context()) or ns.staff_can(tenant_id,array['owner','admin','operations','read_only'])));
create policy approval_cards_read on ns.grading_approval_cards for select to northside_runtime using(exists(select from ns.grading_cards c where c.tenant_id=grading_approval_cards.tenant_id and c.card_id=grading_approval_cards.card_id and ns.grading_access(c.tenant_id,c.case_id)));
-- Card photographs are available at drop-off, before an exam is published.
-- Paper exams and draft assessment/internal notes remain staff-only.
create policy received_photo_read on ns.grading_photos for select to northside_runtime using(ready and active and kind<>'paper' and exists(select from ns.grading_cards c where c.tenant_id=grading_photos.tenant_id and c.card_id=grading_photos.card_id and ns.grading_access(c.tenant_id,c.case_id)));

create function ns.guard_grading_quote() returns trigger language plpgsql set search_path=pg_catalog,ns as $$
declare c ns.grading_cards; latest integer; begin
 select * into c from ns.grading_cards where tenant_id=new.tenant_id and card_id=new.card_id for update;
 if not found or c.status_key not in ('received','examining','awaiting_decision','ready_to_submit','return_requested','on_hold','exception') or exists(select from ns.grading_intakes where tenant_id=c.tenant_id and case_id=c.case_id and voided_at is not null) then raise exception 'Quote cannot change at this stage'; end if;
 if not exists(select from ns.grading_providers where tenant_id=new.tenant_id and key=new.provider and confirmed) then raise exception 'Confirmed provider required'; end if;
 select coalesce(max(revision),0) into latest from ns.grading_quotes where tenant_id=new.tenant_id and card_id=new.card_id;
 if new.revision<>latest+1 then raise exception 'Quote changed; reload'; end if;
 new.created_at:=clock_timestamp(); return new;
end $$;
create trigger quote_guard before insert on ns.grading_quotes for each row execute function ns.guard_grading_quote();

-- This private helper needs to inspect immutable decisions independently of
-- which staff/customer is checking readiness. It exposes only a scoped boolean.
create function ns.grading_approval_current(t uuid,c uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,ns as $$
declare card ns.grading_cards; q ns.grading_quotes; r record; e uuid; begin
 select * into card from ns.grading_cards where tenant_id=t and card_id=c;
 if not found or not ns.grading_access(t,card.case_id) or exists(select from ns.grading_intakes where tenant_id=t and case_id=card.case_id and voided_at is not null) then return false; end if;
 select * into q from ns.grading_quotes where tenant_id=t and card_id=c order by revision desc limit 1;
 select id into e from ns.grading_exam_revisions where tenant_id=t and card_id=c order by revision desc limit 1;
 select a.choice,a.customer_id,p.quote_id,p.exam_revision_id into r from ns.grading_approval_cards p join ns.grading_approval_requests a on a.tenant_id=p.tenant_id and a.id=p.request_id where p.tenant_id=t and p.card_id=c order by a.sequence desc limit 1;
 if not found or r.choice<>'submit' or q.id is null or e is null or q.id is distinct from r.quote_id or e is distinct from r.exam_revision_id then return false; end if;
 return length(trim(q.service))>0 and q.grading_cents is not null and q.shipping_cents is not null and q.insurance_cents is not null and q.other_cents is not null
 and exists(select from ns.grading_providers where tenant_id=t and key=q.provider and confirmed)
 and (card.customer_id=r.customer_id or exists(select from ns.grading_claim_requests where tenant_id=t and case_id=card.case_id and verified_customer_id=r.customer_id and status='approved'));
end $$;
revoke all on function ns.grading_approval_current(uuid,uuid) from public;
grant execute on function ns.grading_approval_current(uuid,uuid) to northside_runtime;

-- Replace the unversioned legacy consent function. Existing historical rows
-- remain, but cannot authorize a new dispatch.
create or replace function ns.grading_decide(c uuid,v integer,choice text,request uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 raise exception 'Use the current exam and quote approval flow';
end $$;

create function ns.grading_approve(request uuid, decision text, items jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; prior ns.grading_approval_requests; item jsonb; card ns.grading_cards; q ns.grading_quotes; e uuid; seen uuid[]:='{}';
begin
 select * into x from ns.context();
 if x.customer_id is null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified customer sign-in required'; end if;
 if request is null or decision not in ('submit','return') or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 then raise exception 'Invalid decision selection'; end if;
 perform pg_advisory_xact_lock(hashtext(x.tenant_id::text||request::text));
 select * into prior from ns.grading_approval_requests where tenant_id=x.tenant_id and id=request;
 if found then
  if prior.customer_id<>x.customer_id or prior.choice<>decision or prior.selection<>items then raise exception 'Decision request conflict'; end if;
  -- Recheck current ownership even on replay.
  for item in select value from jsonb_array_elements(items) loop
   if not exists(select from ns.grading_cards c where c.tenant_id=x.tenant_id and c.card_id=(item->>'card_id')::uuid and ns.grading_access(c.tenant_id,c.case_id)) then raise exception 'Card unavailable'; end if;
  end loop;
  return request;
 end if;
 -- All card locks use the same sorted order, shared with quotes/exam writes.
 for item in select value from jsonb_array_elements(items) order by value->>'card_id' loop
  if jsonb_typeof(item) is distinct from 'object' or (item->>'card_id')::uuid=any(seen) then raise exception 'Invalid or duplicate card selection'; end if;
  select * into card from ns.grading_cards where tenant_id=x.tenant_id and card_id=(item->>'card_id')::uuid for update;
  if not found or not ns.grading_access(x.tenant_id,card.case_id) then raise exception 'Card unavailable'; end if;
  if (item->>'version')::integer is distinct from card.version or card.status_key not in ('received','examining','awaiting_decision','ready_to_submit','return_requested','on_hold','exception') or exists(select from ns.grading_intakes where tenant_id=x.tenant_id and case_id=card.case_id and voided_at is not null) then raise exception 'Card changed or decision unavailable; reload'; end if;
  select * into q from ns.grading_quotes where tenant_id=x.tenant_id and card_id=card.card_id order by revision desc limit 1;
  select id into e from ns.grading_exam_revisions where tenant_id=x.tenant_id and card_id=card.card_id order by revision desc limit 1;
  if (item->>'quote_id')::uuid is distinct from q.id or (item->>'exam_revision_id')::uuid is distinct from e then raise exception 'Exam or quote changed; review the current revisions'; end if;
  if decision='submit' and (card.status_key not in ('awaiting_decision','ready_to_submit') or q.id is null or e is null or length(trim(q.service))=0 or q.grading_cents is null or q.shipping_cents is null or q.insurance_cents is null or q.other_cents is null or not exists(select from ns.grading_providers where tenant_id=x.tenant_id and key=q.provider and confirmed)) then raise exception 'Published exam, configured service and complete quote required'; end if;
  seen:=array_append(seen,card.card_id);
 end loop;
 insert into ns.grading_approval_requests(tenant_id,id,customer_id,choice,selection) values(x.tenant_id,request,x.customer_id,decision,items);
 for item in select value from jsonb_array_elements(items) order by value->>'card_id' loop
  insert into ns.grading_approval_cards(tenant_id,request_id,card_id,quote_id,exam_revision_id,card_version) values(x.tenant_id,request,(item->>'card_id')::uuid,(item->>'quote_id')::uuid,(item->>'exam_revision_id')::uuid,(item->>'version')::integer);
  perform set_config('ns.grading_reason','Authenticated collector '||decision||' decision against saved card, exam and quote revisions',true);
  perform set_config('ns.grading_source','customer',true);
  update ns.grading_cards set status_key=case when decision='submit' then 'ready_to_submit' else 'return_requested' end,version=version+1,updated_at=clock_timestamp() where tenant_id=x.tenant_id and card_id=(item->>'card_id')::uuid;
 end loop;
 return request;
end $$;
revoke all on function ns.grading_approve(uuid,text,jsonb) from public;
grant execute on function ns.grading_approve(uuid,text,jsonb) to northside_runtime;

-- Customer status changes are accepted only when a matching immutable decision
-- was written for the previous card version in this transaction.
create or replace function ns.audit_grading_card() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; why text; src text; label text; begin
 select * into x from ns.context();
 why:=nullif(current_setting('ns.grading_reason',true),''); src:=coalesce(nullif(current_setting('ns.grading_source',true),''),'northside');
 if x.tenant_id is distinct from new.tenant_id or why is null or length(why)>1000 then raise exception 'Grading actor and reason required'; end if;
 if x.staff_id is null then
  if tg_op<>'UPDATE' or src<>'customer' or new.status_key not in ('ready_to_submit','return_requested') or not ns.grading_access(new.tenant_id,new.case_id) or not exists(select from ns.grading_approval_cards p join ns.grading_approval_requests a on a.tenant_id=p.tenant_id and a.id=p.request_id where p.tenant_id=new.tenant_id and p.card_id=new.card_id and p.card_version=old.version and a.customer_id=x.customer_id and a.choice=case when new.status_key='ready_to_submit' then 'submit' else 'return' end) then raise exception 'Invalid customer decision'; end if;
 elsif x.staff_role not in ('owner','admin','operations') or src not in ('northside','import') then raise exception 'Grading staff permission required'; end if;
 select s.label into label from ns.grading_states s where s.tenant_id=new.tenant_id and s.key=new.status_key and s.enabled;
 if label is null then raise exception 'Grading state unavailable'; end if;
 insert into ns.grading_events(tenant_id,card_id,case_id,label,source) values(new.tenant_id,new.card_id,new.case_id,label,src);
 insert into ns.grading_audit(tenant_id,object_id,staff_id,customer_actor_id,action,reason,before_record,after_record) values(new.tenant_id,new.card_id,x.staff_id,x.customer_id,'card.'||lower(tg_op),why,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;

create function ns.guard_grading_dispatch() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare q ns.grading_quotes; b ns.grading_batches; begin
 if new.status_key=old.status_key then return new; end if;
 if new.status_key in ('ready_to_submit','sent_to_grader','grader_received','grading') then
  if not ns.grading_approval_current(new.tenant_id,new.card_id) then raise exception 'Current collector approval required; review current exam and quote'; end if;
 end if;
 if new.status_key in ('sent_to_grader','grader_received','grading') then
  select * into q from ns.grading_quotes where tenant_id=new.tenant_id and card_id=new.card_id order by revision desc limit 1;
  select b2.* into b from ns.grading_batches b2 join ns.card_items c on c.tenant_id=b2.tenant_id and c.batch_id=b2.id where c.tenant_id=new.tenant_id and c.id=new.card_id;
  if b.id is null or (b.provider,b.service) is distinct from (q.provider,q.service) then raise exception 'Batch provider and service must match the current approved quote'; end if;
 end if; return new;
end $$;
create trigger grading_dispatch_guard before update on ns.grading_cards for each row execute function ns.guard_grading_dispatch();
create function ns.guard_grading_batch_identity() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if (new.provider,new.service) is distinct from (old.provider,old.service) and exists(select from ns.card_items where tenant_id=old.tenant_id and batch_id=old.id) then raise exception 'Create a new batch to change provider or service after assignment'; end if; return new;
end $$;
create trigger grading_batch_identity before update on ns.grading_batches for each row execute function ns.guard_grading_batch_identity();
create function ns.guard_dispatched_batch() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if new.batch_id is distinct from old.batch_id and exists(select from ns.grading_cards where tenant_id=new.tenant_id and card_id=new.id and status_key in ('sent_to_grader','grader_received','grading','returned')) then raise exception 'Dispatched card batch cannot change'; end if; return new;
end $$;
create trigger grading_dispatched_batch before update of batch_id on ns.card_items for each row execute function ns.guard_dispatched_batch();
-- No direct public execution of trigger helpers, including security-definer ones.
revoke all on function ns.guard_grading_dispatch(),ns.guard_grading_batch_identity(),ns.guard_dispatched_batch(),ns.audit_grading_card() from public;
commit;
