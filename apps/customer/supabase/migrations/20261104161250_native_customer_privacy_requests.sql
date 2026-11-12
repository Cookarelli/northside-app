begin;
create table ns.mobile_privacy_requests (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 customer_id uuid not null,
 status text not null default 'requested' check(status in('requested','processing','completed','rejected')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id)
);
create unique index mobile_privacy_one_active on ns.mobile_privacy_requests(tenant_id,customer_id) where status in('requested','processing');
create index mobile_privacy_owner on ns.mobile_privacy_requests(tenant_id,customer_id,created_at desc);
alter table ns.mobile_privacy_requests enable row level security;
revoke all on ns.mobile_privacy_requests from public;
grant select,insert on ns.mobile_privacy_requests to northside_auth;
create policy mobile_privacy_auth on ns.mobile_privacy_requests to northside_auth using(true) with check(true);
-- No runtime/anon/staff update/delete grant; fulfillment needs reviewed operator work.
commit;
