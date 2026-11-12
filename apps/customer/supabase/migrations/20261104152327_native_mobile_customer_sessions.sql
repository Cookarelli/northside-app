begin;

create table ns.mobile_intents (
  id_hash text primary key check(id_hash ~ '^[a-f0-9]{64}$'),
  encrypted_payload text not null check(length(encrypted_payload)<=16384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  started_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '5 minutes 5 seconds')
);
create table ns.mobile_attempts (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  intent_hash text not null unique references ns.mobile_intents(id_hash) on delete cascade,
  encrypted_payload text not null check(length(encrypted_payload)<=16384),
  expires_at timestamptz not null
);
create table ns.mobile_families (
  family_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  parent_hash text not null unique references ns.sessions(token_hash),
  encrypted_parent text not null check(length(encrypted_parent)<=4096),
  variant text not null check(variant in('development','preview','production')),
  api_origin text not null check(api_origin ~ '^https://[^/?#@]+$' and length(api_origin)<=2048),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),
  check(expires_at>created_at and expires_at<=created_at+interval '8 hours 5 seconds')
);
create table ns.mobile_handoffs (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  intent_hash text not null unique references ns.mobile_intents(id_hash) on delete cascade,
  family_id uuid not null references ns.mobile_families(family_id) on delete cascade,
  challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'),
  app_state text not null check(app_state ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '65 seconds')
);
create table ns.mobile_credentials (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  family_id uuid not null references ns.mobile_families(family_id) on delete cascade,
  kind text not null check(kind in('access','renewal')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check(expires_at>created_at),
  check(kind<>'access' or expires_at<=created_at+interval '10 minutes 5 seconds')
);

create index mobile_intents_expiry on ns.mobile_intents(expires_at);
create index mobile_intents_rate on ns.mobile_intents(created_at);
create index mobile_attempts_expiry on ns.mobile_attempts(expires_at);
create index mobile_handoffs_expiry on ns.mobile_handoffs(expires_at);
create index mobile_families_expiry on ns.mobile_families(expires_at);
create index mobile_credentials_family on ns.mobile_credentials(family_id);

create function ns.mobile_family_guard() returns trigger language plpgsql
set search_path=pg_catalog,ns as $$
declare p ns.sessions;
begin
  if tg_op='UPDATE' then
    if row(new.family_id,new.tenant_id,new.customer_id,new.parent_hash,new.variant,new.api_origin,new.created_at,new.expires_at)
      is distinct from row(old.family_id,old.tenant_id,old.customer_id,old.parent_hash,old.variant,old.api_origin,old.created_at,old.expires_at)
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
      or (new.encrypted_parent is distinct from old.encrypted_parent and not(new.revoked_at is not null and new.encrypted_parent='revoked')) then
      raise exception 'mobile_family_immutable';
    end if;
  else
    select * into p from ns.sessions where token_hash=new.parent_hash;
    if not found or p.provider<>'shopify' or p.staff_id is not null or p.customer_id is null
      or p.tenant_id<>new.tenant_id or p.customer_id<>new.customer_id
      or p.revoked_at is not null or p.expires_at<=now() or new.expires_at>p.expires_at then
      raise exception 'invalid_mobile_parent';
    end if;
  end if;
  return new;
end $$;
revoke all on function ns.mobile_family_guard() from public;
create trigger mobile_family_guard before insert or update on ns.mobile_families for each row execute function ns.mobile_family_guard();

create function ns.mobile_credential_guard() returns trigger language plpgsql
set search_path=pg_catalog,ns as $$
declare f ns.mobile_families;
begin
  if tg_op='UPDATE' then
    if row(new.token_hash,new.family_id,new.kind,new.created_at,new.expires_at)
      is distinct from row(old.token_hash,old.family_id,old.kind,old.created_at,old.expires_at)
      or (old.used_at is not null and new.used_at is distinct from old.used_at) then
      raise exception 'mobile_credential_immutable';
    end if;
  else
    select * into f from ns.mobile_families where family_id=new.family_id;
    if not found or f.revoked_at is not null or f.expires_at<=now() or new.expires_at>f.expires_at then
      raise exception 'invalid_mobile_credential';
    end if;
  end if;
  return new;
end $$;
revoke all on function ns.mobile_credential_guard() from public;
create trigger mobile_credential_guard before insert or update on ns.mobile_credentials for each row execute function ns.mobile_credential_guard();

alter table ns.mobile_intents enable row level security;
alter table ns.mobile_attempts enable row level security;
alter table ns.mobile_families enable row level security;
alter table ns.mobile_handoffs enable row level security;
alter table ns.mobile_credentials enable row level security;
revoke all on ns.mobile_intents,ns.mobile_attempts,ns.mobile_families,ns.mobile_handoffs,ns.mobile_credentials from public;
grant select,insert,update,delete on ns.mobile_intents,ns.mobile_attempts,ns.mobile_families,ns.mobile_handoffs,ns.mobile_credentials to northside_auth;
create policy mobile_intents_auth on ns.mobile_intents to northside_auth using(true) with check(true);
create policy mobile_attempts_auth on ns.mobile_attempts to northside_auth using(true) with check(true);
create policy mobile_families_auth on ns.mobile_families to northside_auth using(true) with check(true);
create policy mobile_handoffs_auth on ns.mobile_handoffs to northside_auth using(true) with check(true);
create policy mobile_credentials_auth on ns.mobile_credentials to northside_auth using(true) with check(true);
commit;
