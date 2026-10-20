begin;
alter table ns.break_events add column products text[] not null default '{}', add column host text not null default '', add column description text not null default '', add column image_url text, add column format text not null default 'unconfirmed' check(format in ('unconfirmed','named','identical')), add column capacity integer check(capacity between 1 and 500), add column terms text not null default '', add column stream_url text, add column replay_url text, add column duration_minutes integer not null default 120 check(duration_minutes between 15 and 1440), add column published boolean not null default false, add column fixture boolean not null default false, add column version integer not null default 1, add column sale_open boolean not null default false, add column started_at timestamptz, add column updated_at timestamptz not null default now();
alter table ns.break_events add constraint break_status check(status in ('draft','scheduled','delayed','live','complete','canceled'));
alter table ns.shopify_spot_mappings add column product_id text, add column sku text, add column capacity integer not null default 1 check(capacity between 1 and 500), add column active boolean not null default true, add column created_at timestamptz not null default now();
alter table ns.shopify_spot_mappings add unique(tenant_id,event_id,spot_key), add unique(tenant_id,id,event_id);
create table ns.break_audit(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,actor_id uuid not null,action text not null,reason text not null,before_value jsonb,after_value jsonb,created_at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
create table ns.break_sale_checks(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,event_version integer not null,actor_id uuid not null,evidence jsonb not null,reason text not null,checked_at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
create table ns.break_reminders(tenant_id uuid not null,customer_id uuid not null,event_id uuid not null,lead_minutes integer not null check(lead_minutes in (0,5,15,30,60,1440)),active boolean not null default true,scheduled_for timestamptz,event_version integer not null,updated_at timestamptz not null default now(),primary key(tenant_id,customer_id,event_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id));
create table ns.break_participant_preferences(tenant_id uuid not null,customer_id uuid not null,event_id uuid not null,display_name text not null check(length(display_name) between 1 and 60 and position('@' in display_name)=0),consented boolean not null default false,updated_at timestamptz not null default now(),primary key(tenant_id,customer_id,event_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id));
create table ns.break_orders(tenant_id uuid not null references ns.tenants,order_id text not null,snapshot jsonb not null,provider_updated_at timestamptz not null,fingerprint text not null,state text not null,updated_at timestamptz not null default now(),primary key(tenant_id,order_id));
create table ns.break_jobs(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),order_id text not null,source_id text not null,state text not null default 'pending' check(state in ('pending','processing','complete','review')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,last_error text,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source_id));
create table ns.break_purchases(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,mapping_id uuid not null,customer_id uuid,source text not null check(source in ('shopify','legacy')),source_order text not null,source_line text not null,quantity integer not null check(quantity between 1 and 500),current_quantity integer not null check(current_quantity between 0 and 500),status text not null check(status in ('confirmed','partially_refunded','refunded','canceled','review')),paid_at timestamptz not null,amount_cents bigint not null check(amount_cents>=0),currency text not null default 'USD' check(currency='USD'),legacy_evidence text,updated_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source,source_order,source_line),unique(tenant_id,id,customer_id),unique(tenant_id,id,mapping_id,event_id),foreign key(tenant_id,mapping_id,event_id) references ns.shopify_spot_mappings(tenant_id,id,event_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.break_allocations(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,mapping_id uuid not null,purchase_id uuid not null,customer_id uuid not null,slot integer not null check(slot between 1 and 500),active boolean not null default true,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,purchase_id,slot),foreign key(tenant_id,purchase_id,customer_id) references ns.break_purchases(tenant_id,id,customer_id),foreign key(tenant_id,purchase_id,mapping_id,event_id) references ns.break_purchases(tenant_id,id,mapping_id,event_id));
create unique index break_exclusive_slot on ns.break_allocations(tenant_id,mapping_id,slot) where active;
create table ns.break_purchase_events(tenant_id uuid not null,id uuid not null default gen_random_uuid(),purchase_id uuid not null,customer_id uuid,event_id uuid not null,source_id text not null,details jsonb not null,recorded_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,purchase_id,source_id),foreign key(tenant_id,purchase_id) references ns.break_purchases(tenant_id,id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id));
create table ns.break_exceptions(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid,order_id text,kind text not null,source_id text not null,details text not null,status text not null default 'open' check(status in ('open','resolved')),resolution text,actor_id uuid,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source_id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
create index break_jobs_due on ns.break_jobs(state,available_at);
create index break_purchase_owner on ns.break_purchases(tenant_id,customer_id);
create function ns.freeze_break_identity() returns trigger language plpgsql as $$ begin
 if tg_table_name='shopify_spot_mappings' then
  if (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active') then raise exception 'Break mapping identity is immutable'; end if;
 elsif tg_table_name='break_allocations' then
  if (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active') or (not old.active and new.active) then raise exception 'Allocation identity and release are immutable'; end if;
 elsif tg_table_name='break_purchases' then
  if (new.tenant_id,new.id,new.event_id,new.mapping_id,new.source,new.source_order,new.source_line,new.quantity,new.paid_at,new.amount_cents,new.currency,new.legacy_evidence) is distinct from (old.tenant_id,old.id,old.event_id,old.mapping_id,old.source,old.source_order,old.source_line,old.quantity,old.paid_at,old.amount_cents,old.currency,old.legacy_evidence) then raise exception 'Original purchase identity and payment evidence are immutable'; end if;
  if old.customer_id is not null and new.customer_id is distinct from old.customer_id then raise exception 'Purchase owner cannot change'; end if;
 end if;
 return new; end $$;
create trigger break_mapping_identity before update on ns.shopify_spot_mappings for each row execute function ns.freeze_break_identity();
create trigger break_allocation_identity before update on ns.break_allocations for each row execute function ns.freeze_break_identity();
create trigger break_purchase_identity before update on ns.break_purchases for each row execute function ns.freeze_break_identity();
create function ns.sync_break_reminders() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 update ns.break_reminders set scheduled_for=new.starts_at-make_interval(mins=>lead_minutes),event_version=new.version,updated_at=now() where tenant_id=new.tenant_id and event_id=new.id;
 return new; end $$;
create trigger update_break_reminders after update of starts_at,status,published on ns.break_events for each row execute function ns.sync_break_reminders();
create function ns.public_break_spots(e uuid,sample boolean) returns table(id uuid,spot_key text,capacity integer,occupied bigint) language sql stable security definer set search_path=pg_catalog,ns as $$
 select m.id,m.spot_key,m.capacity,(select count(*) from ns.break_allocations a where a.tenant_id=m.tenant_id and a.mapping_id=m.id and a.active) from ns.shopify_spot_mappings m join ns.break_events b on b.tenant_id=m.tenant_id and b.id=m.event_id where b.tenant_id='11111111-1111-4111-8111-111111111111' and b.id=e and b.published and b.fixture=sample and m.active
$$;
create function ns.public_break_participants(e uuid,sample boolean) returns table(display_name text,spot_key text,quantity bigint) language sql stable security definer set search_path=pg_catalog,ns as $$
 select pref.display_name,m.spot_key,count(*) from ns.break_allocations a join ns.break_purchases p on p.tenant_id=a.tenant_id and p.id=a.purchase_id join ns.shopify_spot_mappings m on m.tenant_id=a.tenant_id and m.id=a.mapping_id join ns.break_events b on b.tenant_id=a.tenant_id and b.id=a.event_id join ns.break_participant_preferences pref on pref.tenant_id=a.tenant_id and pref.customer_id=a.customer_id and pref.event_id=a.event_id where b.tenant_id='11111111-1111-4111-8111-111111111111' and b.id=e and b.published and b.fixture=sample and pref.consented and a.active and p.status='confirmed' group by pref.customer_id,pref.display_name,m.spot_key
$$;
revoke all on function ns.public_break_spots(uuid,boolean),ns.public_break_participants(uuid,boolean) from public;
grant execute on function ns.public_break_spots(uuid,boolean),ns.public_break_participants(uuid,boolean) to northside_runtime;
create policy published_break_read on ns.break_events for select to northside_runtime using(tenant_id='11111111-1111-4111-8111-111111111111' and published);
create policy operation_break_write on ns.break_events to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy spot_management on ns.shopify_spot_mappings to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
do $$ declare t text; begin
 foreach t in array array['break_audit','break_sale_checks','break_reminders','break_participant_preferences','break_orders','break_jobs','break_purchases','break_allocations','break_purchase_events','break_exceptions'] loop
  execute format('alter table ns.%I enable row level security',t);
  execute format('grant select on ns.%I to northside_runtime',t);
  execute format('create policy break_staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
 end loop;
 foreach t in array array['break_reminders','break_participant_preferences'] loop
  execute format('grant insert,update on ns.%I to northside_runtime',t);
  execute format('create policy break_own on ns.%I to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context())) with check(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()))',t);
 end loop;
 foreach t in array array['break_purchases','break_allocations','break_purchase_events'] loop
  execute format('create policy break_owned_read on ns.%I for select to northside_runtime using(ns.can_read(tenant_id,customer_id))',t);
 end loop;
 foreach t in array array['break_audit','break_sale_checks','break_purchase_events'] loop
  execute format('create trigger immutable_break_record before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
 end loop;
 foreach t in array array['break_audit','break_sale_checks','break_purchases','break_allocations','break_purchase_events','break_jobs','break_exceptions'] loop
  execute format('grant insert on ns.%I to northside_runtime',t);
  execute format('create policy break_staff_insert on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
 end loop;
 foreach t in array array['break_events','shopify_spot_mappings','break_orders','break_jobs','break_purchases','break_allocations','break_purchase_events','break_exceptions','break_sale_checks','shopify_customers'] loop
  execute format('grant select on ns.%I to northside_commerce',t);
  execute format('create policy break_worker on ns.%I to northside_commerce using(tenant_id=''11111111-1111-4111-8111-111111111111'') with check(tenant_id=''11111111-1111-4111-8111-111111111111'')',t);
 end loop;
 foreach t in array array['break_orders','break_jobs','break_purchases','break_allocations','break_purchase_events','break_exceptions'] loop
  execute format('grant insert,update on ns.%I to northside_commerce',t);
 end loop;
end $$;
grant insert on ns.break_audit to northside_runtime;
create policy editor_break_audit on ns.break_audit for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations','content_editor']) and actor_id=(select staff_id from ns.context()));
grant update(current_quantity,status,updated_at) on ns.break_purchases to northside_runtime;
grant update(active) on ns.break_allocations to northside_runtime;
grant update(status,resolution,actor_id) on ns.break_exceptions to northside_runtime;
grant update(state,attempts,available_at,lease_token,lease_until,last_error) on ns.break_jobs to northside_runtime;
create policy purchase_correction on ns.break_purchases for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy allocation_release on ns.break_allocations for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy exception_resolve on ns.break_exceptions for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy break_retry on ns.break_jobs for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create unique index break_unique_sku on ns.shopify_spot_mappings(tenant_id,sku) where sku is not null;
create policy own_break_event on ns.break_events for select to northside_runtime using(exists(select 1 from ns.break_reminders r where r.tenant_id=break_events.tenant_id and r.event_id=break_events.id and r.customer_id=(select customer_id from ns.context())) or exists(select 1 from ns.break_purchases p where p.tenant_id=break_events.tenant_id and p.event_id=break_events.id and p.customer_id=(select customer_id from ns.context())));
create policy own_break_mapping on ns.shopify_spot_mappings for select to northside_runtime using(exists(select 1 from ns.break_purchases p where p.tenant_id=shopify_spot_mappings.tenant_id and p.mapping_id=shopify_spot_mappings.id and p.customer_id=(select customer_id from ns.context())));
-- A worker locks events for serialized allocation, but cannot change schedule content.
grant update(sale_open) on ns.break_events to northside_commerce;
create function ns.check_break_slot() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 if new.slot > (select capacity from ns.shopify_spot_mappings where tenant_id=new.tenant_id and id=new.mapping_id) then raise exception 'Slot exceeds mapped capacity'; end if; return new; end $$;
create trigger break_slot_limit before insert on ns.break_allocations for each row execute function ns.check_break_slot();
commit;
