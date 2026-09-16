begin;
do $$ begin
  if not exists(select from pg_roles where rolname='northside_loyalty') then create role northside_loyalty nologin nosuperuser nobypassrls; end if;
end $$;
grant usage on schema ns to northside_loyalty;
alter table ns.loyalty_accounts add column cached_points bigint not null default 0;
alter table ns.tier_qualifications alter column qualifying_cents type bigint;
update ns.loyalty_accounts a set cached_points=coalesce((select sum(l.points) from ns.loyalty_ledger l where l.tenant_id=a.tenant_id and l.account_id=a.id),0);
alter table ns.loyalty_rules add column fixture boolean not null default false;
alter table ns.loyalty_ledger add column kind text not null default 'adjustment' check(kind in ('earned','reversal','exchange','restoration','adjustment'));
alter table ns.loyalty_ledger add column actor_id uuid;
alter table ns.loyalty_ledger add foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id);
alter table ns.rewards add column terms jsonb not null default '{}';
alter table ns.rewards add column approved_by uuid;
alter table ns.rewards add column approved_at timestamptz;
alter table ns.rewards add foreign key(tenant_id,approved_by) references ns.staff_memberships(tenant_id,id);
alter table ns.redemption_reservations add column snapshot jsonb not null default '{}';
alter table ns.redemption_reservations add column code text;
alter table ns.redemption_reservations add unique(tenant_id,code);
alter table ns.redemption_reservations add constraint reservation_status check(status in ('held','issued','failed','review'));
alter table ns.shopify_vouchers add column status text not null default 'issued' check(status in ('issued','deactivated','review'));
alter table ns.shopify_vouchers add column checked_at timestamptz;
alter table ns.shopify_vouchers add column snapshot jsonb not null default '{}';
alter table ns.shopify_vouchers add unique(tenant_id,id,customer_id);
create table ns.loyalty_audit(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),actor_id uuid not null,object_id text not null,action text not null,reason text not null,created_at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
create table ns.loyalty_orders(tenant_id uuid not null,order_id text not null,customer_id uuid,rule_id uuid,created_at timestamptz not null,provider_updated_at timestamptz not null,fingerprint text not null,snapshot jsonb not null,state text not null,review_reason text,channel text not null,campaign_ref text,qualifying_cents bigint not null default 0,revision integer not null default 0,reconciled_at timestamptz not null default now(),primary key(tenant_id,order_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,rule_id) references ns.loyalty_rules(tenant_id,id));
create table ns.loyalty_line_allocations(tenant_id uuid not null,order_id text not null,line_id text not null,customer_id uuid not null,rule_id uuid not null,eligibility jsonb not null,original_cents bigint not null check(original_cents>=0),original_points integer not null check(original_points>=0),current_cents bigint not null check(current_cents>=0),current_points integer not null check(current_points>=0),revision integer not null default 0,primary key(tenant_id,order_id,line_id),foreign key(tenant_id,order_id) references ns.loyalty_orders(tenant_id,order_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,rule_id) references ns.loyalty_rules(tenant_id,id));
create table ns.loyalty_jobs(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),kind text not null check(kind in ('order','issue','deactivate')),object_id text not null,source_id text not null,state text not null default 'pending' check(state in ('pending','processing','complete','failed','review')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,last_error text,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,kind,source_id));
create index loyalty_jobs_due on ns.loyalty_jobs(state,available_at);
create table ns.loyalty_voucher_usage(tenant_id uuid not null,voucher_id uuid not null,customer_id uuid not null,order_id text not null,amount_cents bigint not null check(amount_cents>=0),paid_at timestamptz not null,recorded_at timestamptz not null default now(),primary key(tenant_id,voucher_id,order_id),foreign key(tenant_id,voucher_id,customer_id) references ns.shopify_vouchers(tenant_id,id,customer_id));
create table ns.loyalty_reviews(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),customer_id uuid,kind text not null,object_id text not null,source_id text not null,state text not null default 'open' check(state in ('open','resolved','rejected')),details text not null,actor_id uuid,resolution text,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
create table ns.loyalty_restorations(tenant_id uuid not null,reservation_id uuid not null,customer_id uuid not null,source_id text not null,points integer not null check(points>0),actor_id uuid not null,reason text not null,kind text not null check(kind in ('used_reward_refund','unused_cancelled')),created_at timestamptz not null default now(),primary key(tenant_id,source_id),foreign key(tenant_id,reservation_id,customer_id) references ns.redemption_reservations(tenant_id,id,customer_id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
create table ns.loyalty_clearances(tenant_id uuid not null,voucher_id uuid not null,actor_id uuid not null,reference text not null,checked_at timestamptz not null default now(),primary key(tenant_id,voucher_id),foreign key(tenant_id,voucher_id) references ns.shopify_vouchers(tenant_id,id),foreign key(tenant_id,actor_id) references ns.staff_memberships(tenant_id,id));
-- A clearance is staff evidence of independently reconciled pending and paid checkouts, never inferred from zero asynchronous usage.
create function ns.loyalty_cache_entry() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
  update ns.loyalty_accounts set cached_points=cached_points+new.points where tenant_id=new.tenant_id and id=new.account_id and customer_id=new.customer_id;
  new.created_at:=clock_timestamp(); return new;
end $$;
create trigger loyalty_cache after insert on ns.loyalty_ledger for each row execute function ns.loyalty_cache_entry();
create function ns.loyalty_fixed_record() returns trigger language plpgsql as $$ begin
  if tg_table_name='loyalty_line_allocations' then
    if (new.tenant_id,new.order_id,new.line_id,new.customer_id,new.rule_id,new.eligibility,new.original_cents,new.original_points) is distinct from (old.tenant_id,old.order_id,old.line_id,old.customer_id,old.rule_id,old.eligibility,old.original_cents,old.original_points) then raise exception 'Original allocation is immutable'; end if;
  elsif tg_table_name='rewards' then
    if (to_jsonb(new)-'active'-'approved_by'-'approved_at') is distinct from (to_jsonb(old)-'active'-'approved_by'-'approved_at') or (old.approved_by is not null and (new.approved_by,new.approved_at) is distinct from (old.approved_by,old.approved_at)) then raise exception 'Create a new reward definition'; end if;
  elsif tg_table_name='redemption_reservations' then
    if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'Reservation snapshot is immutable'; end if;
  elsif tg_table_name='shopify_vouchers' then
    if (to_jsonb(new)-'status'-'checked_at') is distinct from (to_jsonb(old)-'status'-'checked_at') then raise exception 'Voucher identity is immutable'; end if;
  end if; return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['loyalty_line_allocations','rewards','redemption_reservations','shopify_vouchers'] loop
 execute format('create trigger loyalty_fixed before update on ns.%I for each row execute function ns.loyalty_fixed_record()',t);
 end loop;
 foreach t in array array['loyalty_audit','loyalty_voucher_usage','loyalty_restorations','loyalty_clearances','tier_qualifications'] loop
 execute format('create trigger loyalty_immutable before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
 end loop;
 foreach t in array array['loyalty_audit','loyalty_orders','loyalty_line_allocations','loyalty_jobs','loyalty_voucher_usage','loyalty_reviews','loyalty_restorations','loyalty_clearances'] loop
 execute format('alter table ns.%I enable row level security',t);
 execute format('grant select on ns.%I to northside_runtime',t);
 execute format('create policy loyalty_staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
 end loop;
 foreach t in array array['loyalty_accounts','loyalty_rules','loyalty_ledger','rewards','redemption_reservations','shopify_vouchers','tier_qualifications','loyalty_orders','loyalty_line_allocations','loyalty_jobs','loyalty_reviews','loyalty_voucher_usage','loyalty_clearances','loyalty_restorations'] loop
 execute format('grant select on ns.%I to northside_loyalty',t);
 execute format('create policy loyalty_worker on ns.%I to northside_loyalty using(tenant_id=''11111111-1111-4111-8111-111111111111'') with check(tenant_id=''11111111-1111-4111-8111-111111111111'')',t);
 end loop;
 foreach t in array array['loyalty_orders','loyalty_line_allocations','loyalty_jobs','loyalty_reviews'] loop
 execute format('grant insert,update on ns.%I to northside_loyalty',t);
 end loop;
end $$;
grant select on ns.shopify_customers to northside_loyalty;
grant select on ns.campaign_refs to northside_loyalty;
create policy loyalty_campaign_read on ns.campaign_refs for select to northside_loyalty using(tenant_id='11111111-1111-4111-8111-111111111111');
create policy loyalty_identity_read on ns.shopify_customers for select to northside_loyalty using(tenant_id='11111111-1111-4111-8111-111111111111');
grant insert on ns.loyalty_ledger,ns.shopify_vouchers,ns.loyalty_voucher_usage,ns.tier_qualifications to northside_loyalty;
grant update(status) on ns.redemption_reservations to northside_loyalty;
grant update(status,checked_at) on ns.shopify_vouchers to northside_loyalty;
grant select,insert on ns.loyalty_jobs to northside_commerce;
create policy commerce_loyalty_job on ns.loyalty_jobs to northside_commerce using(tenant_id='11111111-1111-4111-8111-111111111111') with check(tenant_id='11111111-1111-4111-8111-111111111111' and kind='order');
create policy owned_loyalty_usage on ns.loyalty_voucher_usage for select to northside_runtime using(ns.can_read(tenant_id,customer_id));
create policy owned_loyalty_allocations on ns.loyalty_line_allocations for select to northside_runtime using(ns.can_read(tenant_id,customer_id));
create policy owned_loyalty_order on ns.loyalty_orders for select to northside_runtime using(customer_id=(select customer_id from ns.context()) and tenant_id=(select tenant_id from ns.context()));
create policy customer_rules on ns.loyalty_rules for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and approved_by is not null and effective_at is not null);
create policy customer_rewards on ns.rewards for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()));
grant insert on ns.loyalty_accounts to northside_runtime;
grant update(id) on ns.loyalty_accounts to northside_runtime;
create policy loyalty_account_lock on ns.loyalty_accounts for update to northside_runtime using(ns.can_read(tenant_id,customer_id)) with check(ns.can_read(tenant_id,customer_id));
grant update(cached_points) on ns.loyalty_accounts to northside_loyalty;
create policy enroll_own on ns.loyalty_accounts for insert to northside_runtime with check(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()) and cached_points=0);
grant insert on ns.redemption_reservations to northside_runtime;
create policy reserve_own on ns.redemption_reservations for insert to northside_runtime with check(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()) and status='held');
grant insert on ns.loyalty_jobs to northside_runtime;
create policy customer_issue_job on ns.loyalty_jobs for insert to northside_runtime with check(kind='issue' and exists(select 1 from ns.redemption_reservations r where r.tenant_id=loyalty_jobs.tenant_id and r.id::text=loyalty_jobs.object_id and r.customer_id=(select customer_id from ns.context())));
create policy staff_job_write on ns.loyalty_jobs for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin']));
grant update(state,attempts,available_at,last_error,lease_token,lease_until) on ns.loyalty_jobs to northside_runtime;
create policy staff_job_update on ns.loyalty_jobs for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin'])) with check(ns.staff_can(tenant_id,array['owner','admin']));
do $$ declare t text; begin
 foreach t in array array['loyalty_rules','rewards','loyalty_ledger','loyalty_restorations','loyalty_clearances','loyalty_audit'] loop
 execute format('grant insert on ns.%I to northside_runtime',t);
 execute format('create policy loyalty_admin_write on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'']))',t);
 end loop;
end $$;
grant update(active,approved_by,approved_at) on ns.rewards to northside_runtime;
create policy loyalty_reward_update on ns.rewards for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin'])) with check(ns.staff_can(tenant_id,array['owner','admin']));
grant insert,update on ns.loyalty_reviews to northside_runtime;
create policy own_dispute_read on ns.loyalty_reviews for select to northside_runtime using(customer_id=(select customer_id from ns.context()) and tenant_id=(select tenant_id from ns.context()) and kind='dispute');
create policy loyalty_review_write on ns.loyalty_reviews for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']) or (customer_id=(select customer_id from ns.context()) and tenant_id=(select tenant_id from ns.context()) and kind='dispute' and state='open'));
create policy loyalty_review_update on ns.loyalty_reviews for update to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin'])) with check(ns.staff_can(tenant_id,array['owner','admin']));
-- No production rule, reward, enrollment or points seed. Runtime/worker cannot read auth sessions, tokens or consignment data through this role.
commit;
