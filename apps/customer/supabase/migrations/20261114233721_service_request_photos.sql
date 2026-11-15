begin;
-- Request photographs are private draft evidence, never physically received cards.
create table ns.service_request_photos (
 tenant_id uuid not null, id uuid not null, customer_id uuid not null,
 submission_id uuid not null, object_key text not null unique,
 content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 byte_length integer not null check(byte_length between 1 and 4194304),
 ready boolean not null default false, created_at timestamptz not null default now(),
 primary key(tenant_id,id),
 foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),
 check(object_key = tenant_id::text || '/' || customer_id::text || '/requests/' || submission_id::text || '/' || id::text || '.jpg')
);
create index request_photos_submission on ns.service_request_photos(tenant_id,customer_id,submission_id);
alter table ns.service_request_photos enable row level security;
alter table ns.service_request_photos force row level security;
revoke all on ns.service_request_photos from public;
grant select,insert on ns.service_request_photos to northside_runtime;
grant update(ready) on ns.service_request_photos to northside_runtime;
create policy request_photo_read on ns.service_request_photos for select to northside_runtime using(
 exists(select from ns.context() x where x.tenant_id=service_request_photos.tenant_id and x.customer_id=service_request_photos.customer_id)
 or (ns.staff_can(tenant_id,array['owner','admin','operations','read_only']) and exists(
  select from ns.service_requests r where r.tenant_id=service_request_photos.tenant_id and r.submission_id=service_request_photos.submission_id
  and r.submitted_customer_id=service_request_photos.customer_id and r.details->'photo_ids' ? service_request_photos.id::text
 ))
);
create policy request_photo_insert on ns.service_request_photos for insert to northside_runtime with check(
 exists(select from ns.context() x where x.tenant_id=service_request_photos.tenant_id and x.customer_id=service_request_photos.customer_id and x.staff_id is null)
);
create policy request_photo_confirm on ns.service_request_photos for update to northside_runtime using(
 exists(select from ns.context() x where x.tenant_id=service_request_photos.tenant_id and x.customer_id=service_request_photos.customer_id and x.staff_id is null)
) with check(
 exists(select from ns.context() x where x.tenant_id=service_request_photos.tenant_id and x.customer_id=service_request_photos.customer_id and x.staff_id is null)
);
create function ns.validate_request_photo_snapshot() returns trigger language plpgsql security invoker set search_path=pg_catalog,ns as $$
declare photo text; total integer; begin
 if new.details ? 'photo_ids' then
  if jsonb_typeof(new.details->'photo_ids')<>'array' or jsonb_array_length(new.details->'photo_ids')>10 then raise exception 'Invalid request photos'; end if;
  select count(distinct value) into total from jsonb_array_elements_text(new.details->'photo_ids');
  if total<>jsonb_array_length(new.details->'photo_ids') then raise exception 'Invalid request photos';end if;
  for photo in select jsonb_array_elements_text(new.details->'photo_ids') loop
   if not exists(select from ns.service_request_photos p where p.tenant_id=new.tenant_id and p.customer_id=new.submitted_customer_id and p.submission_id=new.submission_id and p.id::text=photo and p.ready) then raise exception 'Invalid request photos';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function ns.validate_request_photo_snapshot() from public;
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
  if exists(select from pg_roles where rolname=role_name) then
   execute format('revoke all on ns.service_request_photos from %I',role_name);
   execute format('revoke all on function ns.validate_request_photo_snapshot() from %I',role_name);
  end if;
 end loop;
end $$;
create trigger request_photo_snapshot before insert on ns.service_requests for each row execute function ns.validate_request_photo_snapshot();
commit;
