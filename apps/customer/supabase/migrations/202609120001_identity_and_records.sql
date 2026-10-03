-- Supabase PostgreSQL. Run as the migration owner, never the application runtime.
begin;
do $$ begin
  if not exists(select from pg_roles where rolname='northside_runtime') then create role northside_runtime nologin nosuperuser nobypassrls; end if;
  if not exists(select from pg_roles where rolname='northside_auth') then create role northside_auth nologin nosuperuser nobypassrls; end if;
end $$;
create schema ns;
revoke all on schema ns from public;
grant usage on schema ns to northside_runtime, northside_auth;
alter default privileges in schema ns revoke execute on functions from public;
create table ns.tenants(id uuid primary key default gen_random_uuid(), slug text unique not null, shop text unique not null, is_test boolean not null default false);
insert into ns.tenants(id,slug,shop) values('11111111-1111-4111-8111-111111111111','northside','9i3hnb-jw.myshopify.com');
create table ns.customers(tenant_id uuid not null references ns.tenants, id uuid not null default gen_random_uuid(), display_name text not null default 'Collector', primary key(tenant_id,id));
create table ns.customer_identities(tenant_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null, shop text not null, provider text not null check(provider='shopify'), subject text not null, verified_at timestamptz not null default now(), primary key(tenant_id,id), unique(tenant_id,shop,provider,subject), foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.staff_memberships(tenant_id uuid not null references ns.tenants, id uuid not null default gen_random_uuid(), auth_user_id uuid not null, role text not null check(role in ('owner','admin','operations','content_editor','read_only')), active boolean not null default true, invited_by uuid, invited_at timestamptz not null default now(), primary key(tenant_id,id), unique(tenant_id,auth_user_id));
create table ns.sessions(token_hash text primary key check(length(token_hash)=64),tenant_id uuid not null references ns.tenants,customer_id uuid,staff_id uuid,provider text not null check(provider in ('shopify','supabase')),encrypted_tokens text not null, token_expires_at timestamptz not null,expires_at timestamptz not null,created_at timestamptz not null default now(), revoked_at timestamptz,check((customer_id is null) <> (staff_id is null)),check((provider='shopify')=(customer_id is not null)),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id));
create table ns.oauth_attempts(token_hash text primary key,encrypted_payload text not null,expires_at timestamptz not null,created_at timestamptz not null default now());
create table ns.service_cases(tenant_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null, kind text not null check(kind in ('grading','consignment')), status text not null default 'received', created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,id,customer_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.grading_batches(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),reference text not null,provider text,created_at timestamptz not null default now(),primary key(tenant_id,id));
create table ns.card_items(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,case_id uuid not null,batch_id uuid,description text not null,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,id,customer_id),foreign key(tenant_id,case_id,customer_id) references ns.service_cases(tenant_id,id,customer_id),foreign key(tenant_id,batch_id) references ns.grading_batches(tenant_id,id));
create table ns.staff_notes(tenant_id uuid not null,id uuid not null default gen_random_uuid(),card_id uuid not null,body text not null,primary key(tenant_id,id),foreign key(tenant_id,card_id) references ns.card_items(tenant_id,id));
create table ns.status_events(tenant_id uuid not null,id uuid not null default gen_random_uuid(),card_id uuid not null,customer_id uuid not null,label text not null check(length(label) between 1 and 100),reason text not null check(length(reason) between 1 and 1000),source text not null check(source in ('staff','import','provider')),actor_id uuid not null,created_at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,card_id,customer_id) references ns.card_items(tenant_id,id,customer_id));
create table ns.consignment_items(tenant_id uuid not null,id uuid not null default gen_random_uuid(),card_id uuid not null,customer_id uuid not null,provider_reference text,sale_cents integer check(sale_cents>=0),fees_cents integer check(fees_cents>=0),currency text not null default 'USD' check(currency='USD'),payout_status text not null default 'unknown',primary key(tenant_id,id),foreign key(tenant_id,card_id,customer_id) references ns.card_items(tenant_id,id,customer_id));
create table ns.file_objects(tenant_id uuid not null,id uuid not null default gen_random_uuid(),card_id uuid not null,customer_id uuid not null,object_key text unique not null check(object_key like tenant_id::text || '/' || customer_id::text || '/%'),mime_type text not null,ready boolean not null default false,created_at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,card_id,customer_id) references ns.card_items(tenant_id,id,customer_id));
create table ns.break_events(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),title text not null,starts_at timestamptz,status text not null default 'draft',primary key(tenant_id,id));
create table ns.shopify_spot_mappings(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,variant_id text not null,spot_key text not null,primary key(tenant_id,id),unique(tenant_id,variant_id),foreign key(tenant_id,event_id) references ns.break_events(tenant_id,id));
create table ns.consent(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,purpose text not null,granted boolean not null,recorded_at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.imports(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),source text not null,status text not null default 'review',actor_id uuid not null,created_at timestamptz not null default now(),primary key(tenant_id,id));
create table ns.integration_connections(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),provider text not null,status text not null default 'disconnected',last_checked_at timestamptz,primary key(tenant_id,id),unique(tenant_id,provider));
create table ns.webhook_receipts(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),provider text not null,source_id text not null,received_at timestamptz not null default now(),processed_at timestamptz,primary key(tenant_id,id),unique(tenant_id,provider,source_id));
create table ns.audit_records(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),actor_id uuid not null,action text not null,object_id uuid not null,reason text not null,source text not null,created_at timestamptz not null default now(),primary key(tenant_id,id));
create table ns.loyalty_accounts(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,enrolled_at timestamptz,primary key(tenant_id,id),unique(tenant_id,id,customer_id),unique(tenant_id,customer_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.loyalty_rules(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),version integer not null,parameters jsonb not null,approved_by uuid,effective_at timestamptz,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,version));
create table ns.loyalty_ledger(tenant_id uuid not null,id uuid not null default gen_random_uuid(),account_id uuid not null,customer_id uuid not null,rule_id uuid not null,points integer not null check(points<>0),source_object text not null,operation text not null,reason text not null,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source_object,operation),foreign key(tenant_id,account_id,customer_id) references ns.loyalty_accounts(tenant_id,id,customer_id),foreign key(tenant_id,rule_id) references ns.loyalty_rules(tenant_id,id));
create table ns.tier_qualifications(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,rule_id uuid not null,tier text not null,period_start timestamptz not null,period_end timestamptz not null,qualifying_cents integer not null,primary key(tenant_id,id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,rule_id) references ns.loyalty_rules(tenant_id,id));
create table ns.rewards(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),rule_id uuid not null,points_cost integer not null check(points_cost>0),value_cents integer not null check(value_cents>0),currency text not null default 'USD' check(currency='USD'),active boolean not null default false,primary key(tenant_id,id),foreign key(tenant_id,rule_id) references ns.loyalty_rules(tenant_id,id));
create table ns.redemption_reservations(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,account_id uuid not null,reward_id uuid not null,source_id text not null,status text not null default 'held',points integer not null check(points>0),created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,id,customer_id),unique(tenant_id,source_id),foreign key(tenant_id,account_id,customer_id) references ns.loyalty_accounts(tenant_id,id,customer_id),foreign key(tenant_id,reward_id) references ns.rewards(tenant_id,id));
create table ns.shopify_vouchers(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,reservation_id uuid not null,shopify_discount_id text not null,code text not null,issued_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,reservation_id),unique(tenant_id,code),foreign key(tenant_id,reservation_id,customer_id) references ns.redemption_reservations(tenant_id,id,customer_id));

alter table ns.tenants add unique(id,shop);
alter table ns.customer_identities add foreign key(tenant_id,shop) references ns.tenants(id,shop);
alter table ns.staff_memberships add foreign key(tenant_id,invited_by) references ns.staff_memberships(tenant_id,id);

alter table ns.status_events add foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id);
alter table ns.imports add foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id);
alter table ns.audit_records add foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id);
alter table ns.loyalty_rules add foreign key(tenant_id,approved_by) references ns.staff_memberships(tenant_id,id);

-- Only the server auth connection may create identity/session records after provider verification.
grant select on ns.tenants to northside_auth;
grant select,insert,update on ns.customers,ns.customer_identities,ns.staff_memberships to northside_auth;
grant select,insert,update,delete on ns.sessions,ns.oauth_attempts to northside_auth;
-- Security-definer lookup exposes only the current unguessable session context, never tokens.
create function ns.context() returns table(tenant_id uuid,customer_id uuid,staff_id uuid,staff_role text)
language sql stable security definer set search_path=pg_catalog,ns as $$
 select s.tenant_id,s.customer_id,s.staff_id,m.role from ns.sessions s
 left join ns.staff_memberships m on m.tenant_id=s.tenant_id and m.id=s.staff_id and m.active
 where s.token_hash=nullif(current_setting('ns.session_hash',true),'') and s.revoked_at is null and s.expires_at>now() and s.token_expires_at>now()
 and (s.customer_id is not null or m.id is not null)
$$;
create function ns.can_read(t uuid,c uuid) returns boolean language sql stable security definer set search_path=pg_catalog,ns as $$ select exists(select from ns.context() x where x.tenant_id=t and (x.customer_id=c or x.staff_role in ('owner','admin','operations','read_only'))) $$;
create function ns.staff_can(t uuid,roles text[]) returns boolean language sql stable security definer set search_path=pg_catalog,ns as $$ select exists(select from ns.context() x where x.tenant_id=t and x.staff_role=any(roles)) $$;
grant execute on function ns.context(),ns.can_read(uuid,uuid),ns.staff_can(uuid,text[]) to northside_runtime;

-- RLS enabled even in this non-exposed schema. No browser/anon/authenticated schema grants.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='ns' loop
   execute format('alter table ns.%I enable row level security',r.tablename);
 end loop;
end $$;
create policy auth_tenants on ns.tenants for select to northside_auth using(true);
create policy auth_customers on ns.customers to northside_auth using(true) with check(true);
create policy auth_identities on ns.customer_identities to northside_auth using(true) with check(true);
create policy auth_members on ns.staff_memberships to northside_auth using(true) with check(true);
create policy auth_sessions on ns.sessions to northside_auth using(true) with check(true);
create policy auth_attempts on ns.oauth_attempts to northside_auth using(true) with check(true);
create policy runtime_customers on ns.customers for select to northside_runtime using(ns.can_read(tenant_id,id));
grant select on ns.customers to northside_runtime;
do $$ declare t text; begin
 foreach t in array array['service_cases','card_items','status_events','consignment_items','file_objects','consent','loyalty_accounts','loyalty_ledger','tier_qualifications','redemption_reservations','shopify_vouchers'] loop
   execute format('grant select on ns.%I to northside_runtime',t);
   execute format('create policy owned_read on ns.%I for select to northside_runtime using(ns.can_read(tenant_id,customer_id))',t);
 end loop;
 foreach t in array array['grading_batches','imports','integration_connections','webhook_receipts','audit_records','loyalty_rules','rewards'] loop
   execute format('grant select on ns.%I to northside_runtime',t);
   execute format('create policy staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
 end loop;
end $$;
grant select on ns.staff_notes to northside_runtime;
create policy private_notes on ns.staff_notes for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations']));
grant select on ns.staff_memberships to northside_runtime;
create policy member_admin on ns.staff_memberships for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin']));
grant select,insert,update on ns.break_events,ns.shopify_spot_mappings to northside_runtime;
create policy content_read on ns.break_events for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations','content_editor','read_only']));
create policy content_write on ns.break_events for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','content_editor']));
create policy content_update on ns.break_events for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','content_editor'])) with check(ns.staff_can(tenant_id,array['owner','admin','content_editor']));
create policy spots_read on ns.shopify_spot_mappings for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations','content_editor','read_only']));
-- Spot writes withheld until paid spot mapping stage.
grant insert on ns.status_events to northside_runtime;
create policy status_write on ns.status_events for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']) and actor_id=(select staff_id from ns.context()) and source='staff');
grant insert,update on ns.file_objects to northside_runtime;
create policy file_write on ns.file_objects for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create policy file_update on ns.file_objects for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations']));
create function ns.prevent_rewrite() returns trigger language plpgsql as $$ begin raise exception 'Append-only record; use a compensating entry'; end $$;
create trigger immutable_ledger before update or delete on ns.loyalty_ledger for each row execute function ns.prevent_rewrite();
create trigger immutable_rules before update or delete on ns.loyalty_rules for each row execute function ns.prevent_rewrite();
create trigger immutable_audit before update or delete on ns.audit_records for each row execute function ns.prevent_rewrite();
create trigger immutable_events before update or delete on ns.status_events for each row execute function ns.prevent_rewrite();
create function ns.audit_status() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 new.created_at:=clock_timestamp();
 insert into ns.audit_records(tenant_id,actor_id,action,object_id,reason,source) values(new.tenant_id,new.actor_id,'status.append',new.card_id,new.reason,new.source);
 return new;
end $$;
create trigger status_audit before insert on ns.status_events for each row execute function ns.audit_status();
create index sessions_expiry on ns.sessions(expires_at);
create index card_owner on ns.card_items(tenant_id,customer_id);
create index status_card on ns.status_events(tenant_id,card_id,created_at);
commit;
