begin;
-- Existing milestones are retained. Custody is independent of holds/exceptions.
insert into ns.grading_states(tenant_id,key,label,position)
select tenant_id,'return_without_grading','Return without grading',15 from ns.grading_settings;
alter table ns.grading_cards add column custody text not null default 'northside' check(custody in ('northside','grader','released')),
 add column last_milestone text not null default 'received',
 add column result_kind text check(result_kind in ('graded','no_grade'));
alter table ns.grading_cards disable trigger grading_card_audit;
update ns.grading_cards g set last_milestone=case when status_key not in ('on_hold','exception') then status_key else coalesce((select a.after_record->>'status_key' from ns.grading_audit a where a.tenant_id=g.tenant_id and a.object_id=g.card_id and a.after_record->>'status_key' not in ('on_hold','exception') order by a.created_at desc limit 1),'received') end;
update ns.grading_cards set custody=case when last_milestone in ('sent_to_grader','grader_received','grading') then 'grader' when last_milestone='completed' then 'released' else 'northside' end;
alter table ns.grading_cards enable trigger grading_card_audit;
alter table ns.grading_batches add column phase text not null default 'draft' check(phase in ('draft','dispatched','legacy_dispatched','cancelled'));
-- Historical dispatches are not relabeled as newly verified manifests.
update ns.grading_batches b set phase='legacy_dispatched' where exists(select from ns.card_items c join ns.grading_audit a on a.tenant_id=c.tenant_id and a.object_id=c.id where c.tenant_id=b.tenant_id and c.batch_id=b.id and a.after_record->>'status_key' in ('sent_to_grader','grader_received','grading'));

create table ns.grading_batch_scans (
 tenant_id uuid not null, id uuid not null, batch_id uuid not null, card_id uuid not null,
 method text not null check(method in ('camera','image','scanner','manual')), staff_id uuid not null,
 created_at timestamptz not null default clock_timestamp(), removed_at timestamptz,
 primary key(tenant_id,id), foreign key(tenant_id,batch_id) references ns.grading_batches(tenant_id,id),
 foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id), foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create unique index grading_one_active_scan on ns.grading_batch_scans(tenant_id,card_id) where removed_at is null;
create index grading_batch_scan_members on ns.grading_batch_scans(tenant_id,batch_id) where removed_at is null;
create table ns.grading_dispatches (
 tenant_id uuid not null, batch_id uuid not null, request_id uuid not null, payload jsonb not null,
 reference text not null, provider text not null, service text not null, carrier text not null, tracking text not null,
 staff_id uuid not null, reason text not null, source text not null check(source='northside'), dispatched_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,batch_id), unique(tenant_id,request_id), foreign key(tenant_id,batch_id) references ns.grading_batches(tenant_id,id),
 foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create table ns.grading_manifest_cards (
 tenant_id uuid not null, batch_id uuid not null, card_id uuid not null, customer_id uuid not null, description text not null,
 card_version integer not null, approval_request_id uuid not null, quote_id uuid not null, exam_revision_id uuid not null,
 primary key(tenant_id,batch_id,card_id), unique(tenant_id,card_id),
 foreign key(tenant_id,batch_id) references ns.grading_dispatches(tenant_id,batch_id),
 foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),
 foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),
 foreign key(tenant_id,approval_request_id) references ns.grading_approval_requests(tenant_id,id),
 foreign key(tenant_id,card_id,quote_id) references ns.grading_quotes(tenant_id,card_id,id),
 foreign key(tenant_id,card_id,exam_revision_id) references ns.grading_exam_revisions(tenant_id,card_id,id)
);
create table ns.grading_outcomes (
 tenant_id uuid not null, id uuid not null, card_id uuid not null, revision integer not null, kind text not null check(kind in ('graded','no_grade')),
 result text not null check(length(trim(result)) between 1 and 3000), certificate text not null default '',
 staff_id uuid not null, source text not null check(source in ('northside','import')), reason text not null,
 created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,id), unique(tenant_id,card_id,revision),
 foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id), foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create table ns.grading_pickups (
 tenant_id uuid not null, id uuid not null, customer_id uuid not null, recipient_name text not null,
 recipient_kind text not null check(recipient_kind in ('collector','representative')),
 verification_method text not null check(verification_method in ('photo_id_in_person','verified_account_and_receipt','independent_callback_and_receipt')),
 verification_evidence text not null check(length(trim(verification_evidence)) between 1 and 1000),
 authorization_evidence text not null, acknowledgment text not null check(length(trim(acknowledgment)) between 1 and 500),
 staff_id uuid not null, reason text not null, source text not null check(source='northside'),
 payload jsonb not null, created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,id),
 foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id), foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id),
 check(recipient_kind<>'representative' or length(trim(authorization_evidence)) between 1 and 1000)
);
create table ns.grading_pickup_cards (
 tenant_id uuid not null, pickup_id uuid not null, card_id uuid not null, card_version integer not null,
 scan_method text not null check(scan_method in ('camera','image','scanner','manual')), photo_ids uuid[] not null,
 primary key(tenant_id,pickup_id,card_id), unique(tenant_id,card_id),
 foreign key(tenant_id,pickup_id) references ns.grading_pickups(tenant_id,id), foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id)
);
create table ns.grading_operation_requests (
 tenant_id uuid not null, id uuid not null, staff_id uuid not null, payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,id), foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create table ns.grading_status_import_rows (
 tenant_id uuid not null, source text not null, external_id text not null, fingerprint text not null, import_id uuid not null, card_id uuid not null,
 primary key(tenant_id,source,external_id), foreign key(tenant_id,import_id) references ns.imports(tenant_id,id), foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id)
);
create table ns.grading_withdrawals (
 tenant_id uuid not null, id uuid not null, card_id uuid not null, customer_id uuid not null, requested_version integer not null,
 created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,id),
 foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id), foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id)
);
create table ns.grading_withdrawal_reviews (
 tenant_id uuid not null, id uuid not null, withdrawal_id uuid not null, staff_id uuid not null,
 resolution text not null check(resolution in ('reviewing_with_grader','return_when_received','unable_to_withdraw','closed')),
 reason text not null, created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,id),
 foreign key(tenant_id,withdrawal_id) references ns.grading_withdrawals(tenant_id,id), foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);

do $$ declare t text; begin
 foreach t in array array['grading_batch_scans','grading_dispatches','grading_manifest_cards','grading_outcomes','grading_pickups','grading_pickup_cards','grading_operation_requests','grading_status_import_rows','grading_withdrawals','grading_withdrawal_reviews'] loop
  execute format('alter table ns.%I enable row level security',t);
  execute format('grant select,insert on ns.%I to northside_runtime',t);
  execute format('create policy operations_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
  execute format('create policy operations_write on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
  if t<>'grading_batch_scans' then execute format('create trigger immutable before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t); end if;
 end loop;
end $$;
grant update(removed_at) on ns.grading_batch_scans to northside_runtime;
create policy scans_remove on ns.grading_batch_scans for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
-- Staff outcome reasons stay private; collectors read the explicit final-result projection.
create policy owned_withdrawal on ns.grading_withdrawals for select to northside_runtime using(customer_id=(select customer_id from ns.context()) and tenant_id=(select tenant_id from ns.context()));
create policy owned_withdrawal_review on ns.grading_withdrawal_reviews for select to northside_runtime using(exists(select from ns.grading_withdrawals w where w.tenant_id=grading_withdrawal_reviews.tenant_id and w.id=grading_withdrawal_reviews.withdrawal_id));

alter table ns.grading_photos drop constraint grading_photos_kind_check;
alter table ns.grading_photos add constraint grading_photos_kind_check check(kind in ('front','back','closeup','paper','returned_front','returned_back','returned_closeup'));
create unique index grading_return_photo_side on ns.grading_photos(tenant_id,card_id,kind) where active and kind in ('returned_front','returned_back');
create or replace function ns.snapshot_exam_photos() returns trigger language plpgsql as $$ begin
 insert into ns.grading_exam_revision_photos(tenant_id,card_id,revision_id,photo_id)
 select tenant_id,card_id,new.id,id from ns.grading_photos where tenant_id=new.tenant_id and card_id=new.card_id and ready and active and kind in ('front','back','closeup','paper');
 return new;
end $$;

-- Database-level protection covers older update routes and reviewed imports too.
create or replace function ns.guard_grading_dispatch() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare phase text; manifest ns.grading_manifest_cards; q ns.grading_quotes; b ns.grading_batches; begin
 new.custody:=old.custody; new.last_milestone:=old.last_milestone;
 if (new.result_kind,new.result,new.certificate) is distinct from (old.result_kind,old.result,old.certificate) and not exists(select from ns.grading_outcomes o where o.tenant_id=new.tenant_id and o.card_id=new.card_id and (o.kind,o.result,o.certificate)=(new.result_kind,new.result,new.certificate) and o.staff_id=(select staff_id from ns.context()) order by revision desc limit 1) then raise exception 'Record an evidenced external outcome through returns'; end if;
 if new.status_key=old.status_key then return new; end if;
 phase:=old.last_milestone;
 if old.custody='released' then raise exception 'Card already released; history cannot be reopened'; end if;
 if new.status_key in ('on_hold','exception') then return new; end if;
 if new.status_key='sent_to_grader' then
  if old.status_key<>'ready_to_submit' or old.custody<>'northside' or not ns.grading_approval_current(new.tenant_id,new.card_id) then raise exception 'Current collector approval and physically ready card required'; end if;
  select * into manifest from ns.grading_manifest_cards where tenant_id=new.tenant_id and card_id=new.card_id;
  select * into q from ns.grading_quotes where tenant_id=new.tenant_id and card_id=new.card_id order by revision desc limit 1;
  select b2.* into b from ns.grading_batches b2 join ns.card_items c on c.tenant_id=b2.tenant_id and c.batch_id=b2.id where c.tenant_id=new.tenant_id and c.id=new.card_id;
  if manifest.card_id is null or manifest.batch_id is distinct from b.id or manifest.card_version<>old.version or b.phase<>'draft' or (b.provider,b.service) is distinct from (q.provider,q.service) then raise exception 'Scanned approved dispatch manifest required'; end if;
  new.custody:='grader';
 elsif new.status_key in ('grader_received','grading') then
  if old.custody<>'grader' or (new.status_key='grader_received' and phase not in ('sent_to_grader','grader_received')) or (new.status_key='grading' and phase not in ('grader_received','grading')) then raise exception 'Physical grading milestone is out of order'; end if;
 elsif new.status_key='returned' then
  if old.custody<>'grader' or phase not in ('sent_to_grader','grader_received','grading') or new.result_kind is null then raise exception 'Receive the card and record its actual grade or no-grade outcome'; end if;
  new.custody:='northside';
 elsif new.status_key='ready_for_pickup' then
  if old.custody<>'northside' or phase not in ('returned','return_without_grading','cancelled','ready_for_pickup') then raise exception 'Physical return or return-without-grading required before pickup'; end if;
  if phase='returned' and (new.result_kind is null or not exists(select from ns.grading_photos where tenant_id=new.tenant_id and card_id=new.card_id and kind='returned_front' and ready and active) or not exists(select from ns.grading_photos where tenant_id=new.tenant_id and card_id=new.card_id and kind='returned_back' and ready and active)) then raise exception 'Confirmed returned front and back photos and actual outcome required'; end if;
 elsif new.status_key='completed' then
  if old.status_key<>'ready_for_pickup' or old.custody<>'northside' or not exists(select from ns.grading_pickup_cards p where p.tenant_id=new.tenant_id and p.card_id=new.card_id and p.card_version=old.version) then raise exception 'Verified scanned pickup and recipient acknowledgment required'; end if;
  new.custody:='released';
 elsif new.status_key in ('cancelled','return_without_grading','return_requested') then
  if old.custody<>'northside' or exists(select from ns.grading_audit a where a.tenant_id=new.tenant_id and a.object_id=new.card_id and a.after_record->>'status_key' in ('sent_to_grader','grader_received','grading')) then raise exception 'Post-dispatch withdrawal requires staff review'; end if;
 elsif new.status_key in ('received','examining','awaiting_decision','ready_to_submit') then
  if old.custody<>'northside' or phase in ('returned','ready_for_pickup','completed','return_without_grading','cancelled') then raise exception 'Physical grading milestone is out of order'; end if;
  if new.status_key='received' and phase<>'received' then raise exception 'Received history cannot be reset'; end if;
  if new.status_key='ready_to_submit' and not ns.grading_approval_current(new.tenant_id,new.card_id) then raise exception 'Current collector approval required; review current exam and quote'; end if;
 else raise exception 'Unsupported grading milestone'; end if;
 new.last_milestone:=new.status_key; return new;
end $$;

create function ns.guard_grading_manifest() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare g ns.grading_cards; q ns.grading_quotes; e uuid; a uuid; b ns.grading_batches; begin
 select * into g from ns.grading_cards where tenant_id=new.tenant_id and card_id=new.card_id for update;
 select * into q from ns.grading_quotes where tenant_id=new.tenant_id and card_id=new.card_id order by revision desc limit 1;
 select id into e from ns.grading_exam_revisions where tenant_id=new.tenant_id and card_id=new.card_id order by revision desc limit 1;
 select r.id into a from ns.grading_approval_cards c join ns.grading_approval_requests r on r.tenant_id=c.tenant_id and r.id=c.request_id where c.tenant_id=new.tenant_id and c.card_id=new.card_id order by r.sequence desc limit 1;
 select * into b from ns.grading_batches where tenant_id=new.tenant_id and id=new.batch_id;
 if not ns.staff_can(new.tenant_id,array['owner','admin','operations']) or g.card_id is null or g.status_key<>'ready_to_submit' or g.custody<>'northside' or not ns.grading_approval_current(new.tenant_id,new.card_id) or (new.customer_id,new.card_version,new.quote_id,new.exam_revision_id,new.approval_request_id) is distinct from (g.customer_id,g.version,q.id,e,a) or b.phase<>'draft' or (b.provider,b.service) is distinct from (q.provider,q.service) or not exists(select from ns.grading_batch_scans where tenant_id=new.tenant_id and card_id=new.card_id and batch_id=new.batch_id and removed_at is null) then raise exception 'Current scanned approval and matching batch required'; end if;
 return new;
end $$;
create trigger manifest_guard before insert on ns.grading_manifest_cards for each row execute function ns.guard_grading_manifest();
create function ns.guard_grading_release() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare g ns.grading_cards; p ns.grading_pickups; begin
 select * into g from ns.grading_cards where tenant_id=new.tenant_id and card_id=new.card_id for update;
 select * into p from ns.grading_pickups where tenant_id=new.tenant_id and id=new.pickup_id;
 if not ns.staff_can(new.tenant_id,array['owner','admin','operations']) or p.staff_id is distinct from (select staff_id from ns.context()) or g.version is distinct from new.card_version or g.status_key<>'ready_for_pickup' or g.custody<>'northside' or not (g.customer_id=p.customer_id or exists(select from ns.grading_claim_requests where tenant_id=g.tenant_id and case_id=g.case_id and status='approved' and verified_customer_id=p.customer_id)) then raise exception 'Verified collector and physically ready card required for release'; end if;
 return new;
end $$;
create trigger release_guard before insert on ns.grading_pickup_cards for each row execute function ns.guard_grading_release();
create function ns.guard_grading_batch_phase() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if old.phase<>'draft' and new.phase<>old.phase then raise exception 'Dispatched or cancelled batch cannot reopen'; end if;
 if new.phase='dispatched' and old.phase='draft' and (not exists(select from ns.grading_dispatches where tenant_id=new.tenant_id and batch_id=new.id) or not exists(select from ns.grading_manifest_cards where tenant_id=new.tenant_id and batch_id=new.id) or exists(select from ns.grading_batch_scans s where s.tenant_id=new.tenant_id and s.batch_id=new.id and s.removed_at is null and not exists(select from ns.grading_manifest_cards m where m.tenant_id=s.tenant_id and m.batch_id=s.batch_id and m.card_id=s.card_id))) then raise exception 'Complete immutable dispatch manifest required'; end if;
 return new;
end $$;
create trigger batch_phase_guard before update on ns.grading_batches for each row execute function ns.guard_grading_batch_phase();

-- Generic notifications only. Recipient claims, not contact-email matching,
-- determine the collector. Existing channel preferences and jobs are reused.
alter table ns.notifications add column topic text not null default 'account_update', add column grading_card_id uuid;
create or replace function ns.notify_status() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare c uuid; n uuid; state text; vtopic text; begin
 if tg_table_name='grading_events' then
  select coalesce((select verified_customer_id from ns.grading_claim_requests where tenant_id=new.tenant_id and case_id=new.case_id and status='approved'),i.customer_id) into c from ns.grading_intakes i where i.tenant_id=new.tenant_id and i.case_id=new.case_id;
  select status_key into state from ns.grading_cards where tenant_id=new.tenant_id and card_id=new.card_id;
  vtopic:=case when state='awaiting_decision' then 'decision_required' when state in ('ready_to_submit','return_requested') then 'decision_recorded' when state='ready_for_pickup' then 'pickup_ready' when state='completed' then 'pickup_completed' else 'grading_update' end;
 else c:=new.customer_id; end if;
 if c is not null then
  n:=ns.queue_notification(new.tenant_id,c,case when tg_table_name='grading_events' then 'grading' else 'consignment' end,tg_table_name||'/'||new.id::text);
  if tg_table_name='grading_events' then update ns.notifications set topic=vtopic,grading_card_id=new.card_id where tenant_id=new.tenant_id and id=n; end if;
 end if; return new;
end $$;

create function ns.request_grading_withdrawal(request uuid,card uuid,v integer) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; g ns.grading_cards; w ns.grading_withdrawals; n uuid; begin
 select * into x from ns.context();
 if x.customer_id is null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified collector required'; end if;
 select * into g from ns.grading_cards where tenant_id=x.tenant_id and card_id=card for update;
 if not found or not ns.grading_access(g.tenant_id,g.case_id) then raise exception 'Card unavailable'; end if;
 select * into w from ns.grading_withdrawals where tenant_id=x.tenant_id and id=request;
 if found then if (w.customer_id,w.card_id,w.requested_version) is distinct from (x.customer_id,card,v) then raise exception 'Withdrawal request conflict'; end if; return request; end if;
 if g.custody<>'grader' or g.version<>v then raise exception 'Withdrawal requires a currently dispatched card'; end if;
 if exists(select from ns.grading_withdrawals w2 where w2.tenant_id=x.tenant_id and w2.card_id=card and coalesce((select resolution from ns.grading_withdrawal_reviews r where r.tenant_id=w2.tenant_id and r.withdrawal_id=w2.id order by created_at desc limit 1),'pending') not in ('closed','unable_to_withdraw')) then raise exception 'Withdrawal already awaiting staff review'; end if;
 insert into ns.grading_withdrawals(tenant_id,id,card_id,customer_id,requested_version) values(x.tenant_id,request,card,x.customer_id,v);
 insert into ns.grading_audit(tenant_id,object_id,customer_actor_id,action,reason,after_record) values(x.tenant_id,card,x.customer_id,'withdrawal.requested','Authenticated collector requested staff review after dispatch',jsonb_build_object('request_id',request));
 n:=ns.queue_notification(x.tenant_id,x.customer_id,'grading','withdrawal/'||request::text);
 update ns.notifications set topic='withdrawal_review',grading_card_id=card where tenant_id=x.tenant_id and id=n;
 return request;
end $$;
revoke all on function ns.guard_grading_manifest(),ns.guard_grading_release(),ns.guard_grading_batch_phase(),ns.request_grading_withdrawal(uuid,uuid,integer) from public;
grant execute on function ns.request_grading_withdrawal(uuid,uuid,integer) to northside_runtime;

-- Source is explicit for new changes; historical unknown sources remain null.
alter table ns.grading_audit add column source text check(source in ('northside','customer','import'));
create function ns.grading_audit_source() returns trigger language plpgsql as $$ begin
 new.source:=coalesce(new.source,case when new.after_record->>'source' in ('northside','customer','import') then new.after_record->>'source' end,case when new.customer_actor_id is not null then 'customer' else coalesce(nullif(current_setting('ns.grading_source',true),''),'northside') end);
 return new;
end $$;
create trigger audit_source before insert on ns.grading_audit for each row execute function ns.grading_audit_source();
create policy grading_notice_staff_read on ns.notifications for select to northside_runtime using(kind='grading' and ns.staff_can(tenant_id,array['owner','admin','operations','read_only']));
create function ns.notify_grading_review() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare c uuid; card uuid; n uuid; begin
 if tg_table_name='grading_withdrawal_reviews' then select customer_id,card_id into c,card from ns.grading_withdrawals where tenant_id=new.tenant_id and id=new.withdrawal_id;
 else
  card:=new.card_id;
  select coalesce((select r.verified_customer_id from ns.grading_claim_requests r where r.tenant_id=g.tenant_id and r.case_id=g.case_id and r.status='approved'),g.customer_id) into c from ns.grading_cards g where g.tenant_id=new.tenant_id and g.card_id=card and g.status_key in ('awaiting_decision','ready_to_submit');
 end if;
 if c is not null then
  n:=ns.queue_notification(new.tenant_id,c,'grading',tg_table_name||'/'||new.id::text);
  update ns.notifications set topic=case when tg_table_name='grading_withdrawal_reviews' then 'withdrawal_review' else 'decision_required' end,grading_card_id=card where tenant_id=new.tenant_id and id=n;
 end if; return new;
end $$;
create trigger withdrawal_review_notification after insert on ns.grading_withdrawal_reviews for each row execute function ns.notify_grading_review();
create trigger exam_review_notification after insert on ns.grading_exam_revisions for each row execute function ns.notify_grading_review();
create trigger quote_review_notification after insert on ns.grading_quotes for each row execute function ns.notify_grading_review();
revoke all on function ns.grading_audit_source(),ns.notify_grading_review() from public;


-- Customers can read a withdrawal resolution but never its internal reason.
revoke select on ns.grading_withdrawal_reviews from northside_runtime;
grant select(tenant_id,id,withdrawal_id,staff_id,resolution,created_at) on ns.grading_withdrawal_reviews to northside_runtime;
create or replace function ns.guard_dispatched_batch() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if new.batch_id is distinct from old.batch_id then
  if exists(select from ns.grading_audit where tenant_id=new.tenant_id and object_id=new.id and after_record->>'status_key' in ('sent_to_grader','grader_received','grading')) then raise exception 'Dispatched card batch cannot change'; end if;
  if new.batch_id is not null and exists(select from ns.grading_batches where tenant_id=new.tenant_id and id=new.batch_id and phase<>'draft') then raise exception 'Cannot add a card to a dispatched or cancelled batch'; end if;
 end if; return new;
end $$;


-- A local return/cancellation must not leave a released card staged outbound.
-- Server custody writers take the same tenant lock before batch/card locks.
create function ns.clear_unshipped_grading_assignment() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare b uuid; x record; begin
 if new.status_key=old.status_key or new.status_key not in ('return_requested','return_without_grading','cancelled','completed') then return new; end if;
 select c.batch_id into b from ns.card_items c join ns.grading_batches s on s.tenant_id=c.tenant_id and s.id=c.batch_id where c.tenant_id=new.tenant_id and c.id=new.card_id and s.phase='draft';
 if b is not null then
  update ns.grading_batches set version=version+1 where tenant_id=new.tenant_id and id=b;
  update ns.grading_batch_scans set removed_at=clock_timestamp() where tenant_id=new.tenant_id and card_id=new.card_id and batch_id=b and removed_at is null;
  update ns.card_items set batch_id=null where tenant_id=new.tenant_id and id=new.card_id;
  select * into x from ns.context();
  insert into ns.grading_audit(tenant_id,object_id,staff_id,customer_actor_id,action,reason,after_record) values(new.tenant_id,new.card_id,x.staff_id,x.customer_id,'batch.removed_before_dispatch',current_setting('ns.grading_reason',true),jsonb_build_object('batch_id',b,'status_key',new.status_key));
 end if; return new;
end $$;
create trigger grading_clear_staging after update on ns.grading_cards for each row execute function ns.clear_unshipped_grading_assignment();
revoke all on function ns.clear_unshipped_grading_assignment() from public;

commit;
