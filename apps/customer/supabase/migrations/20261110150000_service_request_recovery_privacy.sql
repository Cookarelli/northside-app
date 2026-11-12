begin;
-- Preserve applied history; tighten request-note access without changing writer roles.
alter policy staff_read on ns.service_request_notes using(ns.staff_can(tenant_id,array['owner','admin','operations']));
-- Exact duplicate receipts recover before checking current terms or service levels.
create or replace function ns.submit_service_request(t uuid,k uuid,ph text,ch text,src text,typ text,svc text,ct jsonb,dt jsonb,term uuid,lim text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record;r ns.service_requests; tr ns.service_terms; cust uuid; count_hits integer; level_row ns.request_grading_service_levels; begin
 select * into x from ns.context();
 if x.tenant_id is not null and x.tenant_id<>t then raise exception 'Tenant mismatch';end if;
 cust:=x.customer_id;
 if cust is not null and not ns.grading_verified(t,cust) then raise exception 'Verified customer required';end if;
 if ch !~ '^[0-9a-f]{64}$' or ph !~ '^[0-9a-f]{64}$' or jsonb_typeof(ct)<>'object' or jsonb_typeof(dt)<>'object' or octet_length(ct::text||dt::text)>10000 then raise exception 'Invalid payload';end if;
 perform pg_advisory_xact_lock(hashtext(t::text||':request:'||k::text));
 select * into r from ns.service_requests where tenant_id=t and submission_id=k;
 if found then
  if r.payload_hash<>ph or r.source<>src or r.submitted_customer_id is distinct from cust or not exists(select from ns.service_request_secrets where tenant_id=t and request_id=r.id and claim_hash=ch) then raise exception 'Idempotency conflict';end if;
  return jsonb_build_object('id',r.id,'reference',r.reference,'state',r.state,'duplicate',true);
 end if;
 if cust is null then
  if lim is null or lim !~ '^[0-9a-f]{64}$' then raise exception 'Public rate limit required';end if;
  insert into ns.service_request_limits values(t,lim,date_trunc('hour',clock_timestamp()),1) on conflict(tenant_id,key_hash,hour) do update set hits=ns.service_request_limits.hits+1 returning hits into count_hits;
  if count_hits>20 then raise exception 'Rate limited';end if;
 end if;
 if typ='service_request' then
  perform pg_advisory_xact_lock(hashtext(t::text||':service-terms:'||svc));
  select * into tr from ns.service_terms where tenant_id=t and service=svc order by revision desc limit 1;
  if tr.id is null or tr.id is distinct from term then raise exception 'Current approved terms required';end if;
 elsif term is not null then raise exception 'Inquiry terms invalid';end if;
 if typ='service_request' and svc='grading' and dt->>'service_level_id' is not null then
  select * into level_row from ns.request_grading_service_levels where tenant_id=t and id=(dt->>'service_level_id')::uuid and provider=dt->>'provider' and active;
  if level_row.id is null or (level_row.declared_value_limit_cents is not null and (dt->>'declared_value_cents' is null or (dt->>'declared_value_cents')::bigint>level_row.declared_value_limit_cents)) then
   raise exception 'Configured service level and declared value required';
  end if;
 end if;
 insert into ns.service_requests(tenant_id,submission_id,payload_hash,kind,service,source,customer_id,submitted_customer_id,contact,details,terms_id,terms_version,terms_hash,terms_accepted_at)
 values(t,k,ph,typ,svc,src,cust,cust,ct,dt,term,tr.version,case when tr.id is not null then encode(sha256(convert_to(tr.body,'UTF8')),'hex') end,case when tr.id is not null then clock_timestamp() end) returning * into r;
 insert into ns.service_request_secrets values(t,r.id,ch);
 insert into ns.service_request_events(tenant_id,request_id,state,message) values(t,r.id,'new','Request saved for staff review. Physical receipt and provider submission have not been recorded.');
 return jsonb_build_object('id',r.id,'reference',r.reference,'state',r.state,'duplicate',false);
end $$;

create or replace function ns.claim_service_request(rid uuid,secret text) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record;r ns.service_requests; result uuid;begin
 select * into x from ns.context();
 if x.customer_id is null or x.staff_id is not null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified sign-in required';end if;
 select * into r from ns.service_requests where tenant_id=x.tenant_id and id=rid for update;
 if not found or r.customer_id is not null or not exists(select from ns.service_request_secrets where tenant_id=x.tenant_id and request_id=rid and claim_hash=secret) then raise exception 'Claim unavailable';end if;
 insert into ns.service_request_claims(tenant_id,request_id,customer_id) values(x.tenant_id,rid,x.customer_id) on conflict(tenant_id,request_id,customer_id) do nothing;
 select id into result from ns.service_request_claims where tenant_id=x.tenant_id and request_id=rid and customer_id=x.customer_id and status='pending';
 if result is null then raise exception 'Claim unavailable';end if;
 return result;
end $$;
-- CREATE OR REPLACE preserves ownership and grants; make the existing boundary explicit.
revoke all on function ns.submit_service_request(uuid,uuid,text,text,text,text,text,jsonb,jsonb,uuid,text),ns.claim_service_request(uuid,text) from public;
grant execute on function ns.submit_service_request(uuid,uuid,text,text,text,text,text,jsonb,jsonb,uuid,text),ns.claim_service_request(uuid,text) to northside_runtime;
commit;
