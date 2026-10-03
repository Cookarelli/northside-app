begin;
create table ns.grading_settings(tenant_id uuid primary key references ns.tenants, examination_cents integer not null default 500 check(examination_cents between 0 and 100000),version integer not null default 1);
insert into ns.grading_settings(tenant_id) values('11111111-1111-4111-8111-111111111111');
create table ns.grading_states(tenant_id uuid not null references ns.tenants,key text not null,label text not null check(length(label) between 1 and 80),enabled boolean not null default true,position integer not null,primary key(tenant_id,key));
insert into ns.grading_states(tenant_id,key,label,position) select '11111111-1111-4111-8111-111111111111',key,label,position from (values
 ('received','Received at Northside',1),('examining','Examination in progress',2),('awaiting_decision','Awaiting customer decision',3),('ready_to_submit','Ready to submit',4),('sent_to_grader','Sent to grader',5),('grader_received','Grader received',6),('grading','Grading in progress',7),('returned','Returned to Northside',8),('ready_for_pickup','Ready for pickup',9),('completed','Completed',10),('return_requested','Return requested',11),('cancelled','Canceled',12),('on_hold','On hold',13),('exception','Exception',14)) as s(key,label,position);
create table ns.grading_providers(tenant_id uuid not null references ns.tenants,key text not null,label text not null,confirmed boolean not null default false,primary key(tenant_id,key));
insert into ns.grading_providers values('11111111-1111-4111-8111-111111111111','psa','PSA',true),('11111111-1111-4111-8111-111111111111','unconfirmed','BGP — identity unconfirmed',false);
alter table ns.grading_batches add column carrier text not null default '',add column tracking text not null default '',add column version integer not null default 1;
alter table ns.imports add column module text,add column preview jsonb,add column committed_at timestamptz,add column reversed_at timestamptz;
create table ns.grading_intakes(tenant_id uuid not null,case_id uuid not null,customer_id uuid not null,examination_cents integer not null check(examination_cents between 0 and 100000),settings_version integer not null,request_id uuid not null,import_id uuid,voided_at timestamptz,primary key(tenant_id,case_id),unique(tenant_id,request_id),foreign key(tenant_id,case_id,customer_id) references ns.service_cases(tenant_id,id,customer_id),foreign key(tenant_id,import_id) references ns.imports(tenant_id,id));
alter table ns.card_items add unique(tenant_id,id,case_id,customer_id);
create table ns.grading_cards(tenant_id uuid not null,card_id uuid not null,case_id uuid not null,customer_id uuid not null,status_key text not null default 'received',sport text not null default '',year text not null default '',manufacturer text not null default '',card_set text not null default '',card_number text not null default '',parallel text not null default '',findings text not null default '',customer_notes text not null default '',result text not null default '',certificate text not null default '',version integer not null default 1,updated_at timestamptz not null default now(),primary key(tenant_id,card_id),unique(tenant_id,card_id,case_id),foreign key(tenant_id,card_id,case_id,customer_id) references ns.card_items(tenant_id,id,case_id,customer_id),foreign key(tenant_id,case_id) references ns.grading_intakes(tenant_id,case_id),foreign key(tenant_id,status_key) references ns.grading_states(tenant_id,key));
create table ns.grading_events(tenant_id uuid not null, id uuid not null default gen_random_uuid(),card_id uuid not null,case_id uuid not null,label text not null,source text not null check(source in ('northside','customer','import')),created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),foreign key(tenant_id,card_id,case_id) references ns.grading_cards(tenant_id,card_id,case_id));
create table ns.grading_audit(tenant_id uuid not null references ns.tenants,id uuid not null default gen_random_uuid(),object_id uuid not null,staff_id uuid,customer_actor_id uuid,action text not null,reason text not null check(length(reason) between 1 and 1000),before_record jsonb,after_record jsonb,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id),check((staff_id is null)<>(customer_actor_id is null)),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id),foreign key(tenant_id,customer_actor_id) references ns.customers(tenant_id,id));
create table ns.grading_external_rows(tenant_id uuid not null,source text not null,external_id text not null,fingerprint text not null,case_id uuid not null,primary key(tenant_id,source,external_id),foreign key(tenant_id,case_id) references ns.grading_intakes(tenant_id,case_id));
create table ns.grading_claim_tokens(tenant_id uuid not null,case_id uuid not null,token_hash text not null unique,expires_at timestamptz not null,primary key(tenant_id,case_id),foreign key(tenant_id,case_id) references ns.grading_intakes(tenant_id,case_id));
create table ns.grading_claim_requests(tenant_id uuid not null,id uuid not null default gen_random_uuid(),case_id uuid not null,verified_customer_id uuid not null,status text not null default 'pending' check(status in ('pending','approved','denied')),evidence text,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,case_id,verified_customer_id),foreign key(tenant_id,case_id) references ns.grading_intakes(tenant_id,case_id),foreign key(tenant_id,verified_customer_id) references ns.customers(tenant_id,id));
create unique index grading_one_approved_claim on ns.grading_claim_requests(tenant_id,case_id) where status='approved';
create table ns.grading_decisions(tenant_id uuid not null,card_id uuid not null,customer_id uuid not null,request_id uuid not null,choice text not null check(choice in ('submit','return')),created_at timestamptz not null default now(),primary key(tenant_id,request_id),foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.grading_payments(tenant_id uuid not null,id uuid not null default gen_random_uuid(),case_id uuid not null,source text not null check(source in ('shopify_order_link','external_staff_record')),reference text not null,recorded_date date not null,amount_cents integer check(amount_cents>=0),staff_id uuid not null,reason text not null,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source,reference),foreign key(tenant_id,case_id) references ns.grading_intakes(tenant_id,case_id),foreign key(tenant_id,staff_id) references ns.staff_memberships(tenant_id,id));

create function ns.grading_access(t uuid,c uuid) returns boolean language sql stable security definer set search_path=pg_catalog,ns as $$
 select exists(select from ns.service_cases s,ns.context() x where s.tenant_id=t and s.id=c and s.kind='grading' and x.tenant_id=t and
 (s.customer_id=x.customer_id or x.staff_role in ('owner','admin','operations','read_only') or exists(select from ns.grading_claim_requests r where r.tenant_id=t and r.case_id=c and r.status='approved' and r.verified_customer_id=x.customer_id)))
$$;
create function ns.grading_verified(t uuid,c uuid) returns boolean language sql stable security definer set search_path=pg_catalog,ns as $$
 select exists(select from ns.customer_identities i,ns.context() x where i.tenant_id=t and i.customer_id=c and i.provider='shopify' and x.tenant_id=t and (x.customer_id=c or x.staff_role in ('owner','admin','operations','read_only')))
$$;
grant execute on function ns.grading_access(uuid,uuid),ns.grading_verified(uuid,uuid) to northside_runtime;

do $$ declare t text; begin
 foreach t in array array['grading_settings','grading_states','grading_providers','grading_intakes','grading_cards','grading_events','grading_audit','grading_external_rows','grading_claim_tokens','grading_claim_requests','grading_decisions','grading_payments'] loop
   execute format('alter table ns.%I enable row level security',t);
 end loop;
 foreach t in array array['grading_settings','grading_states','grading_providers'] loop
   execute format('grant select,update on ns.%I to northside_runtime',t);
   execute format('create policy settings_read on ns.%I for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()))',t);
   execute format('create policy settings_write on ns.%I for update to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'']))',t);
 end loop;
 foreach t in array array['grading_intakes','grading_cards'] loop
   execute format('grant select,insert,update on ns.%I to northside_runtime',t);
   execute format('create policy grading_read on ns.%I for select to northside_runtime using(ns.grading_access(tenant_id,case_id))',t);
   execute format('create policy grading_create on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
   execute format('create policy grading_write on ns.%I for update to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
 end loop;
 foreach t in array array['grading_events','grading_payments'] loop
   execute format('grant select on ns.%I to northside_runtime',t);
   execute format('create policy grading_read on ns.%I for select to northside_runtime using(ns.grading_access(tenant_id,case_id))',t);
   execute format('create trigger immutable before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
 end loop;
 foreach t in array array['grading_audit','grading_external_rows','grading_claim_tokens','grading_claim_requests'] loop
   execute format('grant select,insert,update on ns.%I to northside_runtime',t);
   execute format('create policy grading_staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
   execute format('create policy grading_staff_insert on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
   execute format('create policy grading_staff_update on ns.%I for update to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
 end loop;
 foreach t in array array['customers','service_cases','card_items','grading_batches','imports'] loop
   execute format('grant insert,update on ns.%I to northside_runtime',t);
   execute format('create policy grading_staff_insert on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
   execute format('create policy grading_staff_update on ns.%I for update to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
 end loop;
end $$;
revoke update on ns.customers,ns.service_cases,ns.card_items from northside_runtime;
grant update(batch_id) on ns.card_items to northside_runtime;
drop policy settings_read on ns.grading_providers;
create policy provider_read on ns.grading_providers for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and (confirmed or ns.staff_can(tenant_id,array['owner','admin','operations','read_only'])));
create policy grading_staff_order_mapping on ns.shopify_customers for select to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations']));
create function ns.freeze_grading_card() returns trigger language plpgsql as $$ begin
 if new.tenant_id<>old.tenant_id or new.card_id<>old.card_id or new.case_id<>old.case_id or new.customer_id<>old.customer_id then raise exception 'Physical card identity is immutable'; end if;
 return new;
end $$;
create trigger stable_grading_card before update on ns.grading_cards for each row execute function ns.freeze_grading_card();
create trigger immutable_grading_audit before update or delete on ns.grading_audit for each row execute function ns.prevent_rewrite();
create trigger immutable_grading_decisions before update or delete on ns.grading_decisions for each row execute function ns.prevent_rewrite();
create policy claimed_cases on ns.service_cases for select to northside_runtime using(ns.grading_access(tenant_id,id));
create policy claimed_cards on ns.card_items for select to northside_runtime using(ns.grading_access(tenant_id,case_id));
create policy claimed_events on ns.status_events for select to northside_runtime using(exists(select from ns.card_items c where c.tenant_id=status_events.tenant_id and c.id=status_events.card_id and ns.grading_access(c.tenant_id,c.case_id)));
create policy claimed_files on ns.file_objects for select to northside_runtime using(exists(select from ns.card_items c where c.tenant_id=file_objects.tenant_id and c.id=file_objects.card_id and ns.grading_access(c.tenant_id,c.case_id)));
create policy own_claim_request on ns.grading_claim_requests for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and verified_customer_id=(select customer_id from ns.context()));
grant select on ns.grading_decisions to northside_runtime;
create policy own_decisions on ns.grading_decisions for select to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()));
grant insert on ns.grading_payments to northside_runtime;
create policy staff_payment on ns.grading_payments for insert to northside_runtime with check(ns.staff_can(tenant_id,array['owner','admin','operations']) and staff_id=(select staff_id from ns.context()));

create function ns.audit_grading_card() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; why text; src text; label text;
begin
 select * into x from ns.context();
 why:=nullif(current_setting('ns.grading_reason',true),''); src:=coalesce(nullif(current_setting('ns.grading_source',true),''),'northside');
 if x.tenant_id is distinct from new.tenant_id or why is null or length(why)>1000 then raise exception 'Grading actor and reason required'; end if;
 if x.staff_id is null then
   if tg_op<>'UPDATE' or src<>'customer' or old.status_key<>'awaiting_decision' or new.status_key not in ('ready_to_submit','return_requested') or not ns.grading_access(new.tenant_id,new.case_id) then raise exception 'Invalid customer decision'; end if;
 elsif x.staff_role not in ('owner','admin','operations') or src not in ('northside','import') then raise exception 'Grading staff permission required'; end if;
 select s.label into label from ns.grading_states s where s.tenant_id=new.tenant_id and s.key=new.status_key and s.enabled;
 if label is null then raise exception 'Grading state unavailable'; end if;
 insert into ns.grading_events(tenant_id,card_id,case_id,label,source) values(new.tenant_id,new.card_id,new.case_id,label,src);
 insert into ns.grading_audit(tenant_id,object_id,staff_id,customer_actor_id,action,reason,before_record,after_record) values(new.tenant_id,new.card_id,x.staff_id,x.customer_id,'card.'||lower(tg_op),why,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger grading_card_audit after insert or update on ns.grading_cards for each row execute function ns.audit_grading_card();
create function ns.freeze_grading_rate() returns trigger language plpgsql as $$ begin
 if new.examination_cents<>old.examination_cents or new.settings_version<>old.settings_version or new.customer_id<>old.customer_id or new.case_id<>old.case_id or new.request_id<>old.request_id or new.import_id is distinct from old.import_id then raise exception 'Intake snapshot is immutable'; end if; return new;
end $$;
create trigger grading_rate_snapshot before update on ns.grading_intakes for each row execute function ns.freeze_grading_rate();

create function ns.grading_decide(c uuid,v integer,choice text,request uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; card ns.grading_cards; prior ns.grading_decisions;
begin
 select * into x from ns.context();
 if x.customer_id is null then raise exception 'Customer sign-in required'; end if;
 select * into prior from ns.grading_decisions where tenant_id=x.tenant_id and request_id=request;
 if found then
   if prior.customer_id<>x.customer_id or prior.card_id<>c or prior.choice<>choice then raise exception 'Decision request conflict'; end if; return request;
 end if;
 select * into card from ns.grading_cards where tenant_id=x.tenant_id and card_id=c for update;
 if not found or not ns.grading_access(x.tenant_id,card.case_id) or card.version<>v or card.status_key<>'awaiting_decision' or choice not in ('submit','return') then raise exception 'Decision unavailable or record changed'; end if;
 if exists(select from ns.grading_intakes where tenant_id=x.tenant_id and case_id=card.case_id and voided_at is not null) then raise exception 'Intake reversed'; end if;
 perform set_config('ns.grading_reason','Authenticated customer requested '||choice,true); perform set_config('ns.grading_source','customer',true);
 insert into ns.grading_decisions(tenant_id,card_id,customer_id,request_id,choice) values(x.tenant_id,c,x.customer_id,request,choice);
 update ns.grading_cards set status_key=case when choice='submit' then 'ready_to_submit' else 'return_requested' end,version=version+1,updated_at=clock_timestamp() where tenant_id=x.tenant_id and card_id=c;
 return request;
end $$;
create function ns.grading_request_claim(hash text) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$
declare x record; c uuid; r uuid;
begin
 select * into x from ns.context();
 if x.customer_id is null or not ns.grading_verified(x.tenant_id,x.customer_id) then raise exception 'Verified customer required'; end if;
 select t.case_id into c from ns.grading_claim_tokens t join ns.grading_intakes i on i.tenant_id=t.tenant_id and i.case_id=t.case_id where t.tenant_id=x.tenant_id and t.token_hash=hash and t.expires_at>now() and i.voided_at is null;
 if c is null then raise exception 'Claim code unavailable'; end if;
 insert into ns.grading_claim_requests(tenant_id,case_id,verified_customer_id) values(x.tenant_id,c,x.customer_id) on conflict(tenant_id,case_id,verified_customer_id) do update set verified_customer_id=excluded.verified_customer_id returning id into r;
 return r;
end $$;
grant execute on function ns.grading_decide(uuid,integer,text,uuid),ns.grading_request_claim(text) to northside_runtime;
create index grading_case_items on ns.grading_cards(tenant_id,case_id);
create index grading_events_card on ns.grading_events(tenant_id,card_id,created_at);
commit;
