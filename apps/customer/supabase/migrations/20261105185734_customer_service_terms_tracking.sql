begin;
-- Additive tracking metadata. Existing receipt timestamps and final certificates
-- retain their meaning; historical drop-off dates are not invented.
alter table ns.grading_intakes add column received_date date;
alter table ns.grading_cards add column provider_card_reference text not null default '' check(length(provider_card_reference)<=200);
alter table ns.consignment_items add column provider_card_reference text not null default '' check(length(provider_card_reference)<=200);
alter table ns.file_objects add column content_sha256 text check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),add column byte_length integer check(byte_length between 1 and 5242880);

create table ns.service_terms (
 tenant_id uuid not null references ns.tenants, id uuid not null default gen_random_uuid(),
 service text not null check(service in ('grading','consignment')), revision bigint generated always as identity,
 version text not null check(length(btrim(version)) between 1 and 80),
 title text not null check(length(btrim(title)) between 1 and 200),
 body text not null check(length(btrim(body)) between 1 and 16000),
 approval_reference text not null check(length(btrim(approval_reference)) between 1 and 1000),
 published_by uuid not null, published_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,id), unique(tenant_id,service,version), unique(tenant_id,id,service,version),
 foreign key(tenant_id,published_by) references ns.staff_memberships(tenant_id,id)
);
create table ns.service_terms_acceptances (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null,
 service text not null, terms_id uuid not null, version text not null, first_card_id uuid not null,
 accepted_at timestamptz not null default clock_timestamp(), primary key(tenant_id,id),
 unique(tenant_id,customer_id,service,version),
 foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id),
 foreign key(tenant_id,first_card_id) references ns.card_items(tenant_id,id),
 foreign key(tenant_id,terms_id,service,version) references ns.service_terms(tenant_id,id,service,version)
);
alter table ns.service_terms enable row level security;
alter table ns.service_terms_acceptances enable row level security;
grant select(tenant_id,id,service,revision,version,title,body,published_at) on ns.service_terms to northside_runtime;
grant select on ns.service_terms_acceptances to northside_runtime;
create policy service_terms_read on ns.service_terms for select to northside_runtime using(
 tenant_id=(select tenant_id from ns.context()) and ((select customer_id from ns.context()) is not null or ns.staff_can(tenant_id,array['owner','admin','operations','read_only'])));
create policy own_terms_acceptance on ns.service_terms_acceptances for select to northside_runtime using(ns.can_read(tenant_id,customer_id));
create trigger immutable_service_terms before update or delete on ns.service_terms for each row execute function ns.prevent_rewrite();
create trigger immutable_service_terms_acceptances before update or delete on ns.service_terms_acceptances for each row execute function ns.prevent_rewrite();
create index service_terms_current on ns.service_terms(tenant_id,service,revision desc);

-- These narrowly granted functions derive actor/tenant/time from the existing
-- verified server session. No browser-chosen identity or direct INSERT grant.
create function ns.publish_service_terms(s text,v text,t text,b text,ref text,previous uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; latest uuid; old ns.service_terms; result uuid;
begin
 select * into x from ns.context();
 if x.tenant_id is null or x.customer_id is not null or x.staff_role not in ('owner','admin') then raise exception 'Terms publisher permission required'; end if;
 if s not in ('grading','consignment') or v is null or t is null or b is null or ref is null or length(btrim(v)) not between 1 and 80 or length(btrim(t)) not between 1 and 200 or length(btrim(b)) not between 1 and 16000 or length(btrim(ref)) not between 1 and 1000 then raise exception 'Valid configured terms required'; end if;
 perform pg_advisory_xact_lock(hashtext(x.tenant_id::text||':service-terms:'||s));
 select * into old from ns.service_terms where tenant_id=x.tenant_id and service=s and version=v;
 if found then
  if old.title<>t or old.body<>b or old.approval_reference<>ref then raise exception 'Terms version is immutable'; end if;
  return old.id;
 end if;
 select id into latest from ns.service_terms where tenant_id=x.tenant_id and service=s order by revision desc limit 1;
 if latest is distinct from previous then raise exception 'Terms changed; reload'; end if;
 insert into ns.service_terms(tenant_id,service,version,title,body,approval_reference,published_by) values(x.tenant_id,s,v,t,b,ref,x.staff_id) returning id into result;
 return result;
end $$;
create function ns.accept_service_terms(s text,term uuid,card uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; c record; current_terms ns.service_terms; result uuid;
begin
 select * into x from ns.context();
 if x.tenant_id is null or x.customer_id is null or x.staff_id is not null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified customer acceptance required'; end if;
 if s not in ('grading','consignment') then raise exception 'Unknown service'; end if;
 select i.*,sc.kind into c from ns.card_items i join ns.service_cases sc on sc.tenant_id=i.tenant_id and sc.id=i.case_id where i.tenant_id=x.tenant_id and i.id=card;
 if not found or c.kind<>s or not(c.customer_id=x.customer_id or (s='grading' and ns.grading_access(x.tenant_id,c.case_id))) then raise exception 'Owned service card required'; end if;
 perform pg_advisory_xact_lock(hashtext(x.tenant_id::text||':service-terms:'||s));
 select * into current_terms from ns.service_terms where tenant_id=x.tenant_id and service=s order by revision desc limit 1;
 if current_terms.id is null or current_terms.id is distinct from term then raise exception 'Terms changed; reload'; end if;
 select id into result from ns.service_terms_acceptances where tenant_id=x.tenant_id and customer_id=x.customer_id and service=s and terms_id=term;
 if result is not null then return result; end if;
 insert into ns.service_terms_acceptances(tenant_id,customer_id,service,terms_id,version,first_card_id) values(x.tenant_id,x.customer_id,s,term,current_terms.version,card) returning id into result;
 return result;
end $$;
revoke all on function ns.publish_service_terms(text,text,text,text,text,uuid),ns.accept_service_terms(text,uuid,uuid) from public;
grant execute on function ns.publish_service_terms(text,text,text,text,text,uuid),ns.accept_service_terms(text,uuid,uuid) to northside_runtime;
-- No terms, acceptances, fictional identities or provider stages are seeded.
commit;
