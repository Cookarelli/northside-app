begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='northside_commerce') then create role northside_commerce nologin nosuperuser nobypassrls; end if;
end $$;
grant usage on schema ns to northside_commerce;
create table ns.shopify_customers(
  tenant_id uuid not null, customer_id uuid not null, shop text not null, shopify_id text not null check(shopify_id ~ '^gid://shopify/Customer/[0-9]+$'), verified_at timestamptz not null default now(),
  primary key(tenant_id,customer_id), unique(tenant_id,shop,shopify_id),
  foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id), foreign key(tenant_id,shop) references ns.tenants(id,shop)
);
create table ns.commerce_carts(
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'), tenant_id uuid not null references ns.tenants,
  customer_id uuid, encrypted_cart text not null, expires_at timestamptz not null default now()+interval '10 days',
  foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id)
);
create table ns.order_jobs(
  tenant_id uuid not null, receipt_id uuid not null, shop text not null, order_id text not null check(order_id ~ '^gid://shopify/Order/[0-9]+$'),
  topic text not null check(topic in ('orders/paid','orders/cancelled','orders/updated','refunds/create')),
  state text not null default 'pending' check(state in ('pending','processing','complete','failed')), attempts integer not null default 0,
  available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz, last_error text,
  primary key(tenant_id,receipt_id), foreign key(tenant_id,receipt_id) references ns.webhook_receipts(tenant_id,id), foreign key(tenant_id,shop) references ns.tenants(id,shop)
);
create index order_jobs_due on ns.order_jobs(state,available_at);
create table ns.shopify_orders(
  tenant_id uuid not null, shop text not null, order_id text not null check(order_id ~ '^gid://shopify/Order/[0-9]+$'),
  shopify_customer_id text, name text not null, financial_status text not null, cancelled_at timestamptz,
  currency text not null check(currency='USD'), total_cents bigint not null check(total_cents>=0), received_cents bigint not null check(received_cents>=0), refunded_cents bigint not null check(refunded_cents>=0),
  provider_updated_at timestamptz not null, reconciled_at timestamptz not null default now(), fingerprint text not null,
  primary key(tenant_id,shop,order_id), foreign key(tenant_id,shop) references ns.tenants(id,shop)
);
create table ns.order_ledger(
  tenant_id uuid not null, id uuid not null default gen_random_uuid(), shop text not null, order_id text not null, receipt_id uuid not null,
  snapshot jsonb not null, recorded_at timestamptz not null default now(),
  primary key(tenant_id,id), unique(tenant_id,receipt_id), foreign key(tenant_id,shop,order_id) references ns.shopify_orders(tenant_id,shop,order_id), foreign key(tenant_id,receipt_id) references ns.webhook_receipts(tenant_id,id)
);
create trigger immutable_order_ledger before update or delete on ns.order_ledger for each row execute function ns.prevent_rewrite();
create table ns.campaign_refs(tenant_id uuid not null references ns.tenants, ref text not null check(ref ~ '^[A-Za-z0-9_-]{22,64}$'), enabled boolean not null default false, primary key(tenant_id,ref));
create table ns.campaign_touches(
  token_hash text primary key, tenant_id uuid not null references ns.tenants,
  first_ref text not null, last_ref text not null, first_at timestamptz not null default now(), last_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 days',
  consent boolean not null check(consent=true), foreign key(tenant_id,first_ref) references ns.campaign_refs(tenant_id,ref), foreign key(tenant_id,last_ref) references ns.campaign_refs(tenant_id,ref)
);
do $$ declare t text; begin
  foreach t in array array['shopify_customers','commerce_carts','order_jobs','shopify_orders','order_ledger','campaign_refs','campaign_touches'] loop
    execute format('alter table ns.%I enable row level security',t);
  end loop;
  foreach t in array array['commerce_carts','order_jobs','shopify_orders','campaign_touches'] loop
    execute format('grant select,insert,update on ns.%I to northside_commerce',t);
    execute format('create policy commerce_access on ns.%I to northside_commerce using(tenant_id=''11111111-1111-4111-8111-111111111111'') with check(tenant_id=''11111111-1111-4111-8111-111111111111'')',t);
  end loop;
end $$;
grant delete on ns.campaign_touches to northside_commerce;
grant select,insert,update on ns.webhook_receipts to northside_commerce;
create policy commerce_receipts on ns.webhook_receipts to northside_commerce using(tenant_id='11111111-1111-4111-8111-111111111111') with check(tenant_id='11111111-1111-4111-8111-111111111111' and provider='shopify');
grant select,insert on ns.order_ledger to northside_commerce;
create policy commerce_ledger on ns.order_ledger to northside_commerce using(tenant_id='11111111-1111-4111-8111-111111111111') with check(tenant_id='11111111-1111-4111-8111-111111111111');
grant select on ns.campaign_refs to northside_commerce;
create policy commerce_campaigns on ns.campaign_refs for select to northside_commerce using(tenant_id='11111111-1111-4111-8111-111111111111');
grant select,insert on ns.shopify_customers to northside_auth;
create policy auth_shopify_customers on ns.shopify_customers to northside_auth using(tenant_id='11111111-1111-4111-8111-111111111111') with check(tenant_id='11111111-1111-4111-8111-111111111111');
grant select on ns.shopify_customers,ns.shopify_orders,ns.order_ledger,ns.order_jobs to northside_runtime;
create policy owned_shopify_identity on ns.shopify_customers for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()));
create policy owned_orders on ns.shopify_orders for select to northside_runtime using(
  exists(select 1 from ns.shopify_customers c where c.tenant_id=shopify_orders.tenant_id and c.shop=shopify_orders.shop and c.shopify_id=shopify_orders.shopify_customer_id)
  or ns.staff_can(tenant_id,array['owner','admin','operations','read_only'])
);
create policy staff_order_ledger on ns.order_ledger for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations','read_only']));
create policy staff_order_jobs on ns.order_jobs for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations','read_only']));
commit;
