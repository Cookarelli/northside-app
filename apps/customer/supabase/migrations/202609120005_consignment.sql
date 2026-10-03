begin;
alter table ns.consignment_items add column case_id uuid,add column request_id uuid not null default gen_random_uuid(),add column state_key text not null default 'received',add column submission_reference text not null default '',add column listing_reference text not null default '',add column received_date date,add column channel text not null default '',add column asking_cents integer check(asking_cents>=0),add column sale_verified_at timestamptz,add column customer_notes text not null default '',add column version integer not null default 1,add column updated_at timestamptz not null default now(),add column source_updated_at timestamptz;
update ns.consignment_items i set case_id=c.case_id from ns.card_items c where c.tenant_id=i.tenant_id and c.id=i.card_id;
alter table ns.consignment_items alter column case_id set not null,add unique(tenant_id,request_id),add unique(tenant_id,id,customer_id),add unique(tenant_id,card_id),add foreign key(tenant_id,case_id,customer_id) references ns.service_cases(tenant_id,id,customer_id),add constraint consignment_states check(state_key in ('received','preparing','submitted','processing','listed','sold','awaiting_settlement','paid','returned','exception'));
alter table ns.consignment_items add foreign key(tenant_id,card_id,case_id,customer_id) references ns.card_items(tenant_id,id,case_id,customer_id);
create table ns.consignment_events(tenant_id uuid not null,id uuid not null default gen_random_uuid(),item_id uuid not null,customer_id uuid not null,label text not null,source text not null check(source in ('northside','reviewed_csv')),created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),foreign key(tenant_id,item_id,customer_id) references ns.consignment_items(tenant_id,id,customer_id));
create table ns.consignment_audit(tenant_id uuid not null,id uuid not null default gen_random_uuid(),object_id uuid not null,staff_id uuid not null,action text not null,reason text not null check(length(reason) between 1 and 1000),before_record jsonb,after_record jsonb,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id));
create table ns.consignment_settlements(tenant_id uuid not null,id uuid not null default gen_random_uuid(),item_id uuid not null,customer_id uuid not null,amount_cents integer not null,reference text not null,recorded_date date not null,currency text not null check(currency='USD'),source text not null check(source='northside'),reverses_id uuid,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),unique(tenant_id,reference),unique(tenant_id,reverses_id),foreign key(tenant_id,item_id,customer_id) references ns.consignment_items(tenant_id,id,customer_id),foreign key(tenant_id,reverses_id) references ns.consignment_settlements(tenant_id,id),check((reverses_id is null and amount_cents>=0) or (reverses_id is not null and amount_cents<=0)));
create table ns.consignment_external_links(tenant_id uuid not null,source text not null,external_id text not null,item_id uuid not null,customer_id uuid not null,fingerprint text not null,source_updated_at timestamptz not null,staff_id uuid not null,primary key(tenant_id,source,external_id),foreign key(tenant_id,item_id,customer_id) references ns.consignment_items(tenant_id,id,customer_id),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id));
create table ns.consignment_import_rows(tenant_id uuid not null,import_id uuid not null,row_number integer not null,external_id text not null,input jsonb not null,fingerprint text not null,state text not null check(state in ('ready','unmatched','duplicate','conflict','error','applied','rejected')),message text not null,target_item_id uuid,customer_id uuid,expected_version integer,current_snapshot jsonb,primary key(tenant_id,import_id,row_number),foreign key(tenant_id,import_id) references ns.imports(tenant_id,id),foreign key(tenant_id,target_item_id,customer_id) references ns.consignment_items(tenant_id,id,customer_id));

grant insert,update on ns.consignment_items to northside_runtime;
grant update(description) on ns.card_items to northside_runtime;
create policy consignment_insert on ns.consignment_items for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy consignment_update on ns.consignment_items for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
do $$ declare t text; begin
 foreach t in array array['consignment_events','consignment_audit','consignment_settlements','consignment_external_links','consignment_import_rows'] loop
  execute format('alter table ns.%I enable row level security',t);
 end loop;
 foreach t in array array['consignment_events','consignment_settlements'] loop
  execute format('grant select on ns.%I to northside_runtime',t);
  execute format('create policy consignment_read on ns.%I for select to northside_runtime using(ns.can_read(tenant_id,customer_id))',t);
  execute format('create trigger immutable before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
 end loop;
 foreach t in array array['consignment_audit','consignment_external_links','consignment_import_rows'] loop
  execute format('grant select,insert,update on ns.%I to northside_runtime',t);
  execute format('create policy consignment_staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
  execute format('create policy consignment_staff_insert on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
  execute format('create policy consignment_staff_update on ns.%I for update to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
 end loop;
end $$;
grant insert on ns.consignment_settlements to northside_runtime;
create policy settlement_insert on ns.consignment_settlements for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create trigger immutable_consignment_audit before update or delete on ns.consignment_audit for each row execute function ns.prevent_rewrite();
create function ns.consignment_audit_item() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; why text; src text; label text;
begin
 select * into x from ns.context();why:=nullif(current_setting('ns.consignment_reason',true),'');src:=coalesce(nullif(current_setting('ns.consignment_source',true),''),'northside');
 if x.tenant_id is distinct from new.tenant_id or x.staff_id is null or x.staff_role not in ('owner','admin','operations') or why is null or length(why)>1000 or src not in ('northside','reviewed_csv') then raise exception 'Consignment staff actor and reason required';end if;
 if tg_op='UPDATE' and (new.tenant_id<>old.tenant_id or new.id<>old.id or new.card_id<>old.card_id or new.customer_id<>old.customer_id or new.case_id<>old.case_id or new.request_id<>old.request_id) then raise exception 'Consignment identity is immutable';end if;
 label:=case new.state_key when 'received' then 'Received at Northside' when 'preparing' then 'Preparing submission' when 'submitted' then 'Submitted to partner' when 'processing' then 'Partner processing' when 'listed' then 'Listed' when 'sold' then 'Sold' when 'awaiting_settlement' then 'Awaiting settlement' when 'paid' then 'Settlement recorded in full' when 'returned' then 'Returned' else 'Exception' end;
 insert into ns.consignment_events(tenant_id,item_id,customer_id,label,source) values(new.tenant_id,new.id,new.customer_id,label,src);
 insert into ns.consignment_audit(tenant_id,object_id,staff_id,action,reason,before_record,after_record) values(new.tenant_id,new.id,x.staff_id,'item.'||lower(tg_op),why,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));return new;
end $$;
create trigger consignment_item_audit after insert or update on ns.consignment_items for each row execute function ns.consignment_audit_item();
create function ns.freeze_consignment_link() returns trigger language plpgsql as $$ begin
 if new.tenant_id<>old.tenant_id or new.source<>old.source or new.external_id<>old.external_id or new.item_id<>old.item_id or new.customer_id<>old.customer_id then raise exception 'Approved external ownership cannot be rematched';end if;return new;
end $$;
create trigger stable_consignment_link before update on ns.consignment_external_links for each row execute function ns.freeze_consignment_link();
create index consignment_events_item on ns.consignment_events(tenant_id,item_id,created_at);
create index consignment_queue on ns.consignment_import_rows(tenant_id,state);
commit;
