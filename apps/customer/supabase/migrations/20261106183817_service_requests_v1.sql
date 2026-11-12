begin;
-- Pre-receipt records do not create customers, service cases or physical cards.
create table ns.service_requests (
 tenant_id uuid not null references ns.tenants, id uuid not null default gen_random_uuid(),
 reference text not null default ('NS-'||upper(replace(gen_random_uuid()::text,'-',''))),
 submission_id uuid not null, payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 contract_version text not null default '1' check(contract_version='1'),
 kind text not null check(kind in ('inquiry','service_request')), service text not null check(service in ('grading','consignment')),
 source text not null check(source in ('shopify_website','customer_web','native_ios','native_android','staff')),
 customer_id uuid, submitted_customer_id uuid, contact jsonb not null, details jsonb not null,
 state text not null default 'new' check(state in ('new','review','assigned','follow_up','intake','in_progress','completed')),
 staff_owner uuid, follow_up_at timestamptz, version integer not null default 1,
 terms_id uuid, terms_version text, terms_hash text, terms_accepted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 received_at timestamptz, receipt_evidence text, intake_result jsonb, conversion_hash text,
 primary key(tenant_id,id), unique(tenant_id,reference), unique(tenant_id,submission_id),
 foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),
 foreign key(tenant_id,submitted_customer_id) references ns.customers(tenant_id,id),
 foreign key(tenant_id,staff_owner) references ns.staff_memberships(tenant_id,id),
 foreign key(tenant_id,terms_id,service,terms_version) references ns.service_terms(tenant_id,id,service,version),
 check((kind='inquiry' and terms_id is null and terms_accepted_at is null) or (kind='service_request' and terms_id is not null and terms_hash is not null and terms_accepted_at is not null)),
 check((received_at is null and receipt_evidence is null and intake_result is null) or (received_at is not null and receipt_evidence is not null and length(btrim(receipt_evidence))>0 and intake_result is not null and conversion_hash is not null and customer_id is not null and kind='service_request'))
);
create index service_requests_customer on ns.service_requests(tenant_id,customer_id,created_at desc);
create index service_requests_queue on ns.service_requests(tenant_id,state,follow_up_at);
create function ns.freeze_request_intake() returns trigger language plpgsql set search_path=pg_catalog,ns as $$ begin
 if old.intake_result is not null and (new.intake_result is distinct from old.intake_result or new.received_at is distinct from old.received_at or new.receipt_evidence is distinct from old.receipt_evidence or new.conversion_hash is distinct from old.conversion_hash) then raise exception 'Physical conversion is immutable';end if;
 return new;end $$;
revoke all on function ns.freeze_request_intake() from public;
create trigger freeze_request_intake before update on ns.service_requests for each row execute function ns.freeze_request_intake();
create table ns.service_request_secrets (
 tenant_id uuid not null,request_id uuid not null,claim_hash text not null check(claim_hash ~ '^[0-9a-f]{64}$'),
 primary key(tenant_id,request_id),foreign key(tenant_id,request_id) references ns.service_requests(tenant_id,id)
);
create table ns.service_request_events (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), request_id uuid not null,
 state text not null,message text not null check(length(message)<=3000),staff_id uuid,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),
 foreign key(tenant_id,request_id) references ns.service_requests(tenant_id,id),
 foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create index service_request_history on ns.service_request_events(tenant_id,request_id,created_at);
create table ns.service_request_notes (
 tenant_id uuid not null,id uuid not null default gen_random_uuid(),request_id uuid not null,staff_id uuid not null,
 reason text not null,note text not null,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),
 foreign key(tenant_id,request_id) references ns.service_requests(tenant_id,id),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create table ns.service_request_claims (
 tenant_id uuid not null,id uuid not null default gen_random_uuid(),request_id uuid not null,customer_id uuid not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),staff_id uuid,verification_reference text,
 created_at timestamptz not null default clock_timestamp(),reviewed_at timestamptz,primary key(tenant_id,id),unique(tenant_id,request_id,customer_id),
 foreign key(tenant_id,request_id) references ns.service_requests(tenant_id,id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id)
);
create table ns.service_request_outbox (
 tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,request_id uuid not null,
 state text not null default 'pending' check(state in ('pending','failed','test_delivered')),attempts integer not null default 0,
 next_attempt_at timestamptz not null default clock_timestamp(),last_error text,delivered_at timestamptz,
 primary key(tenant_id,id),unique(tenant_id,event_id),foreign key(tenant_id,event_id) references ns.service_request_events(tenant_id,id),foreign key(tenant_id,request_id) references ns.service_requests(tenant_id,id)
);
create index service_request_retry on ns.service_request_outbox(tenant_id,state,next_attempt_at);
create table ns.service_request_test_sink (
 tenant_id uuid not null,outbox_id uuid not null,reference text not null,state text not null,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,outbox_id),foreign key(tenant_id,outbox_id) references ns.service_request_outbox(tenant_id,id)
);
create table ns.service_request_limits (tenant_id uuid not null,key_hash text not null,hour timestamptz not null,hits integer not null,primary key(tenant_id,key_hash,hour));
-- Availability is configured separately from service levels/prices. No prices or timelines are seeded.
insert into ns.grading_providers(tenant_id,key,label,confirmed) select id,'sgc','SGC',false from ns.tenants on conflict do nothing;
create table ns.request_grading_service_levels (
 tenant_id uuid not null,id uuid not null default gen_random_uuid(),provider text not null check(provider in ('PSA','SGC')),name text not null,
 declared_value_limit_cents integer check(declared_value_limit_cents>=0),active boolean not null default false,approval_reference text not null,
 primary key(tenant_id,id),unique(tenant_id,id,provider)
);
-- Internal only: these are not offers advertised to customers. Activation has no application route.
create table ns.consignment_offers (
 tenant_id uuid not null,id uuid not null default gen_random_uuid(),version text not null,basis text not null check(basis='hammer_price'),
 total_bps integer not null check(total_bps between 0 and 20000),state text not null check(state in ('pending_confirmation','inactive','confirmed')),
 terms_id uuid,approval_reference text,effective_from timestamptz,effective_until timestamptz,
 primary key(tenant_id,id),unique(tenant_id,version),foreign key(tenant_id,terms_id) references ns.service_terms(tenant_id,id),
 check(state<>'confirmed' or (terms_id is not null and approval_reference is not null and length(btrim(approval_reference))>0 and effective_from is not null))
);
insert into ns.consignment_offers(tenant_id,version,basis,total_bps,state) select id,'proposed-105-total','hammer_price',10500,'pending_confirmation' from ns.tenants;
insert into ns.consignment_offers(tenant_id,version,basis,total_bps,state) select id,'historical-may-102','hammer_price',10200,'inactive' from ns.tenants;
create table ns.consignment_offer_eligibility (
 tenant_id uuid not null,item_id uuid not null,offer_id uuid not null,approval_reference text not null check(length(btrim(approval_reference)) between 1 and 1000),
 primary key(tenant_id,item_id,offer_id),foreign key(tenant_id,item_id) references ns.consignment_items(tenant_id,id),foreign key(tenant_id,offer_id) references ns.consignment_offers(tenant_id,id)
);
alter table ns.consignment_offer_eligibility enable row level security;
create trigger immutable_eligibility before update or delete on ns.consignment_offer_eligibility for each row execute function ns.prevent_rewrite();
create table ns.consignment_offer_acceptances (
 tenant_id uuid not null,item_id uuid not null,customer_id uuid not null,offer_id uuid not null,terms_id uuid not null,
 offer_version text not null,basis text not null check(basis='hammer_price'),total_bps integer not null,
 hammer_cents integer not null check(hammer_cents>=0),payout_due_cents bigint not null check(payout_due_cents>=0),
 accepted_at timestamptz not null default clock_timestamp(),primary key(tenant_id,item_id),
 foreign key(tenant_id,item_id,customer_id) references ns.consignment_items(tenant_id,id,customer_id),
 foreign key(tenant_id,offer_id) references ns.consignment_offers(tenant_id,id),foreign key(tenant_id,terms_id) references ns.service_terms(tenant_id,id)
);
do $$ declare t text; begin
 foreach t in array array['service_requests','service_request_secrets','service_request_events','service_request_notes','service_request_claims','service_request_outbox','service_request_test_sink','service_request_limits','request_grading_service_levels','consignment_offers','consignment_offer_acceptances'] loop
  execute format('alter table ns.%I enable row level security',t);
 end loop;
 foreach t in array array['service_requests','service_request_events'] loop
  execute format('grant select on ns.%I to northside_runtime',t);
 end loop;
 foreach t in array array['service_request_notes','service_request_claims','service_request_outbox','service_request_test_sink','request_grading_service_levels','consignment_offers'] loop
  execute format('grant select on ns.%I to northside_runtime',t);
  execute format('create policy staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
 end loop;
 foreach t in array array['service_request_notes','service_request_events','service_request_test_sink','consignment_offer_acceptances'] loop
  execute format('create trigger immutable_record before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
 end loop;
end $$;
create policy own_requests on ns.service_requests for select to northside_runtime using(ns.can_read(tenant_id,customer_id));
create policy own_request_events on ns.service_request_events for select to northside_runtime using(exists(select from ns.service_requests r where r.tenant_id=service_request_events.tenant_id and r.id=service_request_events.request_id));
grant select on ns.consignment_offer_acceptances to northside_runtime;
create policy own_offer on ns.consignment_offer_acceptances for select to northside_runtime using(ns.can_read(tenant_id,customer_id));
grant update(state,staff_owner,follow_up_at,version,updated_at,received_at,receipt_evidence,intake_result,conversion_hash) on ns.service_requests to northside_runtime;
create policy staff_update_request on ns.service_requests for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
grant insert on ns.service_request_notes,ns.service_request_events,ns.service_request_test_sink to northside_runtime;
grant update(state,attempts,next_attempt_at,last_error,delivered_at) on ns.service_request_outbox to northside_runtime;
create policy staff_update_outbox on ns.service_request_outbox for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy staff_insert_note on ns.service_request_notes for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']) and staff_id=(select staff_id from ns.context()));
create policy staff_insert_event on ns.service_request_events for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']) and staff_id=(select staff_id from ns.context()));
create policy staff_insert_sink on ns.service_request_test_sink for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create function ns.request_event_outbox() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 insert into ns.service_request_outbox(tenant_id,event_id,request_id) values(new.tenant_id,new.id,new.request_id);return new;end $$;
revoke all on function ns.request_event_outbox() from public;
create trigger queue_request_event after insert on ns.service_request_events for each row execute function ns.request_event_outbox();

create function ns.service_request_config(t uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,ns as $$
 select jsonb_build_object('terms',coalesce((select jsonb_agg(x) from (select distinct on(service) id,service,version,title,body from ns.service_terms where tenant_id=t order by service,revision desc) x),'[]'::jsonb),
 'serviceLevels',coalesce((select jsonb_agg(x) from (select id,provider,name,declared_value_limit_cents from ns.request_grading_service_levels where tenant_id=t and active order by provider,name) x),'[]'::jsonb))
$$;
revoke all on function ns.service_request_config(uuid) from public;
grant execute on function ns.service_request_config(uuid) to northside_runtime;

create function ns.submit_service_request(t uuid,k uuid,ph text,ch text,src text,typ text,svc text,ct jsonb,dt jsonb,term uuid,lim text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record;r ns.service_requests; tr ns.service_terms; cust uuid; count_hits integer; begin
 select * into x from ns.context();
 if x.tenant_id is not null and x.tenant_id<>t then raise exception 'Tenant mismatch';end if;
 cust:=x.customer_id;
 if cust is not null and not ns.grading_verified(t,cust) then raise exception 'Verified customer required';end if;
 if ch !~ '^[0-9a-f]{64}$' or ph !~ '^[0-9a-f]{64}$' or jsonb_typeof(ct)<>'object' or jsonb_typeof(dt)<>'object' or octet_length(ct::text||dt::text)>10000 then raise exception 'Invalid payload';end if;
 perform pg_advisory_xact_lock(hashtext(t::text||':request:'||k::text));
 select * into r from ns.service_requests where tenant_id=t and submission_id=k;
 if found then
  if r.payload_hash<>ph or r.source<>src or r.submitted_customer_id is distinct from cust or not exists(select from ns.service_request_secrets where tenant_id=t and request_id=r.id and claim_hash=ch) then raise exception 'Idempotency conflict';end if;
  return jsonb_build_object('id',r.id,'reference',r.reference,'state',r.state,'duplicate',true);
 end if;
 if cust is null then
  if lim is null or lim !~ '^[0-9a-f]{64}$' then raise exception 'Public rate limit required';end if;
  insert into ns.service_request_limits values(t,lim,date_trunc('hour',clock_timestamp()),1) on conflict(tenant_id,key_hash,hour) do update set hits=ns.service_request_limits.hits+1 returning hits into count_hits;
  if count_hits>20 then raise exception 'Rate limited';end if;
 end if;
 if typ='service_request' then
  perform pg_advisory_xact_lock(hashtext(t::text||':service-terms:'||svc));
  select * into tr from ns.service_terms where tenant_id=t and service=svc order by revision desc limit 1;
  if tr.id is null or tr.id is distinct from term then raise exception 'Current approved terms required';end if;
 elsif term is not null then raise exception 'Inquiry terms invalid';end if;
 insert into ns.service_requests(tenant_id,submission_id,payload_hash,kind,service,source,customer_id,submitted_customer_id,contact,details,terms_id,terms_version,terms_hash,terms_accepted_at)
 values(t,k,ph,typ,svc,src,cust,cust,ct,dt,term,tr.version,case when tr.id is not null then encode(sha256(convert_to(tr.body,'UTF8')),'hex') end,case when tr.id is not null then clock_timestamp() end) returning * into r;
 insert into ns.service_request_secrets values(t,r.id,ch);
 insert into ns.service_request_events(tenant_id,request_id,state,message) values(t,r.id,'new','Request saved for staff review. Physical receipt and provider submission have not been recorded.');
 return jsonb_build_object('id',r.id,'reference',r.reference,'state',r.state,'duplicate',false);
end $$;
revoke all on function ns.submit_service_request(uuid,uuid,text,text,text,text,text,jsonb,jsonb,uuid,text) from public;
grant execute on function ns.submit_service_request(uuid,uuid,text,text,text,text,text,jsonb,jsonb,uuid,text) to northside_runtime;

create function ns.claim_service_request(rid uuid,secret text) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record;r ns.service_requests; result uuid;begin
 select * into x from ns.context();
 if x.customer_id is null or x.staff_id is not null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified sign-in required';end if;
 select * into r from ns.service_requests where tenant_id=x.tenant_id and id=rid for update;
 if not found or r.customer_id is not null or not exists(select from ns.service_request_secrets where tenant_id=x.tenant_id and request_id=rid and claim_hash=secret) then raise exception 'Claim unavailable';end if;
 insert into ns.service_request_claims(tenant_id,request_id,customer_id) values(x.tenant_id,rid,x.customer_id) on conflict(tenant_id,request_id,customer_id) do nothing;
 select id into result from ns.service_request_claims where tenant_id=x.tenant_id and request_id=rid and customer_id=x.customer_id;return result;
end $$;
create function ns.review_service_request_claim(cid uuid,approve boolean,ref text) returns void language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record;c ns.service_request_claims;r ns.service_requests;begin
 select * into x from ns.context();
 if x.staff_id is null or x.staff_role not in ('owner','admin','operations') or approve is null or ref is null or length(btrim(ref)) not between 1 and 1000 then raise exception 'Independent staff identity evidence required';end if;
 select * into c from ns.service_request_claims where tenant_id=x.tenant_id and id=cid;
 if not found then raise exception 'Claim unavailable';end if;
 select * into r from ns.service_requests where tenant_id=x.tenant_id and id=c.request_id for update;
 select * into c from ns.service_request_claims where tenant_id=x.tenant_id and id=cid for update;
 if c.status<>'pending' or r.customer_id is not null then raise exception 'Claim already reviewed';end if;
 update ns.service_request_claims set status=case when approve then 'approved' else 'rejected' end,staff_id=x.staff_id,verification_reference=ref,reviewed_at=clock_timestamp() where tenant_id=x.tenant_id and id=cid;
 if approve then
  if not ns.grading_verified(x.tenant_id,c.customer_id) then raise exception 'Verified identity required';end if;
  update ns.service_requests set customer_id=c.customer_id,version=version+1,updated_at=clock_timestamp() where tenant_id=x.tenant_id and id=c.request_id;
  insert into ns.service_request_events(tenant_id,request_id,state,message,staff_id) values(x.tenant_id,r.id,r.state,'Request linked after verified sign-in and independent staff identity review.',x.staff_id);
 end if;
end $$;
revoke all on function ns.claim_service_request(uuid,text),ns.review_service_request_claim(uuid,boolean,text) from public;
grant execute on function ns.claim_service_request(uuid,text),ns.review_service_request_claim(uuid,boolean,text) to northside_runtime;

create function ns.accept_consignment_offer(item uuid,offer uuid) returns void language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record;o ns.consignment_offers;c ns.consignment_items;begin
 select * into x from ns.context();
 if x.customer_id is null or x.staff_id is not null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified customer required';end if;
 select * into c from ns.consignment_items where tenant_id=x.tenant_id and id=item and customer_id=x.customer_id for update;
 select * into o from ns.consignment_offers where tenant_id=x.tenant_id and id=offer and state='confirmed' and effective_from<=clock_timestamp() and (effective_until is null or effective_until>clock_timestamp()) for share;
 if c.id is null or o.id is null or c.service_request_id is null or c.state_key not in ('sold','awaiting_settlement') or c.sale_verified_at is null or c.sale_cents is null or not exists(select from ns.consignment_offer_eligibility where tenant_id=x.tenant_id and item_id=item and offer_id=offer) or not exists(select from ns.service_terms_acceptances where tenant_id=x.tenant_id and customer_id=x.customer_id and terms_id=o.terms_id and service='consignment') then raise exception 'Confirmed applicable offer and customer terms required';end if;
 if exists(select from ns.consignment_settlements where tenant_id=x.tenant_id and item_id=item) then raise exception 'Historical settlements cannot change basis';end if;
 insert into ns.consignment_offer_acceptances values(x.tenant_id,item,x.customer_id,o.id,o.terms_id,o.version,o.basis,o.total_bps,c.sale_cents,(c.sale_cents::bigint*o.total_bps+5000)/10000,clock_timestamp());
end $$;
revoke all on function ns.accept_consignment_offer(uuid,uuid) from public;
grant execute on function ns.accept_consignment_offer(uuid,uuid) to northside_runtime;
-- Preserve legacy records. Request-origin items cannot fall back to legacy net
-- proceeds while the new applicable financial agreement remains unconfirmed.
alter table ns.consignment_items add column service_request_id uuid;
alter table ns.consignment_items add foreign key(tenant_id,service_request_id) references ns.service_requests(tenant_id,id);
create function ns.guard_request_settlement() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare c ns.consignment_items;a ns.consignment_offer_acceptances;due bigint;settled bigint;begin
 select * into c from ns.consignment_items where tenant_id=new.tenant_id and id=new.item_id for update;
 select * into a from ns.consignment_offer_acceptances where tenant_id=new.tenant_id and item_id=new.item_id;
 if new.reverses_id is null and (c.service_request_id is not null or a.item_id is not null) then
  if a.item_id is null or c.sale_verified_at is null or c.sale_cents is null then raise exception 'Approved agreement and verified hammer sale required';end if;
  if c.state_key not in ('sold','awaiting_settlement') then raise exception 'Sold stage required for payout';end if;
  if c.sale_cents<>a.hammer_cents then raise exception 'Accepted hammer snapshot changed';end if;
  due:=a.payout_due_cents;
  select coalesce(sum(amount_cents),0) into settled from ns.consignment_settlements where tenant_id=new.tenant_id and item_id=new.item_id;
  if settled+new.amount_cents>due then raise exception 'Payout exceeds accepted agreement';end if;
 end if;return new;end $$;
revoke all on function ns.guard_request_settlement() from public;
create trigger guard_request_settlement before insert on ns.consignment_settlements for each row execute function ns.guard_request_settlement();
create function ns.freeze_consignment_request_link() returns trigger language plpgsql set search_path=pg_catalog,ns as $$ begin
 if old.service_request_id is not null and new.service_request_id is distinct from old.service_request_id then raise exception 'Request linkage is immutable';end if;
 if exists(select from ns.consignment_offer_acceptances where tenant_id=old.tenant_id and item_id=old.id) and (new.sale_cents is distinct from old.sale_cents or new.sale_verified_at is distinct from old.sale_verified_at) then raise exception 'Accepted hammer snapshot is immutable';end if;
 return new;end $$;
revoke all on function ns.freeze_consignment_request_link() from public;
create trigger freeze_consignment_request_link before update on ns.consignment_items for each row execute function ns.freeze_consignment_request_link();
alter table ns.consignment_items drop constraint consignment_states;
alter table ns.consignment_items add constraint consignment_states check(state_key in ('received','accepted','declined','preparing','submitted','processing','listed','sold','awaiting_settlement','paid','returned','exception'));
create or replace function ns.consignment_audit_item() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; why text; src text; label text;
begin
 select * into x from ns.context();why:=nullif(current_setting('ns.consignment_reason',true),'');src:=coalesce(nullif(current_setting('ns.consignment_source',true),''),'northside');
 if x.tenant_id is distinct from new.tenant_id or x.staff_id is null or x.staff_role not in ('owner','admin','operations') or why is null or length(why)>1000 or src not in ('northside','reviewed_csv') then raise exception 'Consignment staff actor and reason required';end if;
 if tg_op='UPDATE' and (new.tenant_id<>old.tenant_id or new.id<>old.id or new.card_id<>old.card_id or new.customer_id<>old.customer_id or new.case_id<>old.case_id or new.request_id<>old.request_id) then raise exception 'Consignment identity is immutable';end if;
 label:=case new.state_key when 'received' then 'Received at Northside' when 'accepted' then 'Accepted for consignment' when 'declined' then 'Declined for consignment' when 'preparing' then 'Preparing submission' when 'submitted' then 'Submitted to partner' when 'processing' then 'Partner processing' when 'listed' then 'Listed' when 'sold' then 'Sold' when 'awaiting_settlement' then 'Awaiting settlement' when 'paid' then 'Settlement recorded in full' when 'returned' then 'Returned' else 'Exception' end;
 insert into ns.consignment_events(tenant_id,item_id,customer_id,label,source) values(new.tenant_id,new.id,new.customer_id,label,src);
 insert into ns.consignment_audit(tenant_id,object_id,staff_id,action,reason,before_record,after_record) values(new.tenant_id,new.id,x.staff_id,'item.'||lower(tg_op),why,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));return new;
end $$;
commit;
