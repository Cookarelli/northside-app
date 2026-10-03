-- Run once on a dedicated Northside App Supabase project. Never Northside HQ.
-- The private schema must NOT be added to Supabase's exposed schemas.
create schema if not exists northside_private;
revoke all on schema northside_private from public, anon, authenticated;
create table if not exists northside_private.app_state (
  namespace text primary key check (namespace ~ '^[a-z][a-z0-9_-]{0,63}$'),
  state jsonb not null check (octet_length(state::text) <= 16777216),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table northside_private.app_state enable row level security;
revoke all on northside_private.app_state from public, anon, authenticated;
-- Passwordless logins: set independent random passwords privately before use.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='northside_control_server') then
    create role northside_control_server login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists(select 1 from pg_roles where rolname='northside_customer_server') then
    create role northside_customer_server login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
grant usage on schema northside_private to northside_control_server, northside_customer_server;
grant select, insert, update on northside_private.app_state to northside_control_server, northside_customer_server;
create policy control_aggregates on northside_private.app_state
  for all to northside_control_server
  using (namespace in ('control','auth_operator')) with check (namespace in ('control','auth_operator'));
create policy customer_aggregates on northside_private.app_state
  for all to northside_customer_server
  using (namespace in ('commerce','auth_staff')) with check (namespace in ('commerce','auth_staff'));
-- Browser clients receive no direct row access. Different app credentials cannot
-- read or modify each other's aggregate, even if an application is compromised.
