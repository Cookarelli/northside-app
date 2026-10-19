-- Isolated pilot inbox, never ns.shopify_orders/order_jobs or the control plane.
-- Credentials are provisioned separately; this migration creates NOLOGIN only.
create role northside_webhook_receiver nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
create schema ns_webhook_pilot;
revoke all on schema ns_webhook_pilot from public;
grant usage on schema ns_webhook_pilot to northside_webhook_receiver;
create table ns_webhook_pilot.receipts (
  shop text not null check (shop='9i3hnb-jw.myshopify.com'),
  delivery_id uuid not null,
  topic text not null check (topic in ('orders/paid','orders/cancelled','orders/updated','refunds/create')),
  order_id text not null check (order_id ~ '^gid://shopify/Order/[1-9][0-9]{0,24}$'),
  api_version text not null check (api_version='2026-07'),
  body_hash text not null check (body_hash ~ '^[a-f0-9]{64}$'),
  is_test boolean not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key(shop,delivery_id)
);
alter table ns_webhook_pilot.receipts enable row level security;
alter table ns_webhook_pilot.receipts force row level security;
revoke all on ns_webhook_pilot.receipts from public;
grant select on ns_webhook_pilot.receipts to northside_webhook_receiver;
grant insert(shop,delivery_id,topic,order_id,api_version,body_hash,is_test) on ns_webhook_pilot.receipts to northside_webhook_receiver;
create policy receiver_read on ns_webhook_pilot.receipts for select to northside_webhook_receiver using(shop='9i3hnb-jw.myshopify.com');
create policy receiver_insert on ns_webhook_pilot.receipts for insert to northside_webhook_receiver with check(shop='9i3hnb-jw.myshopify.com');
comment on table ns_webhook_pilot.receipts is 'Pilot metadata quarantine only; no raw payload, financial evidence or job dispatch. Operator-managed retention.';
