-- Prompt 9. No provider configuration, sends, sample data or store activation.
do $$ begin if not exists(select from pg_roles where rolname='northside_engagement') then create role northside_engagement nologin nosuperuser nobypassrls; end if; end $$;
grant usage on schema ns to northside_engagement;
create table ns.notification_preferences(tenant_id uuid not null,customer_id uuid not null,kind text not null check(kind in('grading','consignment','break')),in_app boolean not null default true,email boolean not null default false,push boolean not null default false,updated_at timestamptz not null default now(),primary key(tenant_id,customer_id,kind),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.notification_contacts(tenant_id uuid not null,customer_id uuid not null,email_sealed text,verified_at timestamptz,primary key(tenant_id,customer_id),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.push_subscriptions(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,endpoint_hash text not null,subscription_sealed text not null,active boolean not null default true,updated_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,endpoint_hash),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.notifications(tenant_id uuid not null,id uuid not null default gen_random_uuid(),customer_id uuid not null,kind text not null check(kind in('grading','consignment','break')),source_key text not null,break_id uuid,due_at timestamptz not null default now(),visible boolean not null default true,cancelled boolean not null default false,read_at timestamptz,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,source_key),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.notification_jobs(tenant_id uuid not null,id uuid not null default gen_random_uuid(),notification_id uuid not null,channel text not null check(channel in('email','push')),destination_key text not null default '',subscription_id uuid,state text not null default 'pending' check(state in('pending','processing','accepted','unsent','failed','cancelled')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,first_attempt_at timestamptz,last_error text,created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,notification_id,channel,destination_key),foreign key(tenant_id,notification_id) references ns.notifications(tenant_id,id),foreign key(tenant_id,subscription_id) references ns.push_subscriptions(tenant_id,id));
create index notification_due on ns.notification_jobs(available_at) where state in('pending','processing');
create table ns.notification_attempts(tenant_id uuid not null,id uuid not null default gen_random_uuid(),job_id uuid not null,outcome text not null,code text not null,at timestamptz not null default now(),primary key(tenant_id,id),foreign key(tenant_id,job_id) references ns.notification_jobs(tenant_id,id));
create table ns.show_events(tenant_id uuid not null,id uuid not null default gen_random_uuid(),slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),brand text not null check(brand in('northside','hobby_key')),title text not null check(length(title) between 1 and 120),description text not null default '',starts_at timestamptz,location text,published boolean not null default false,fixture boolean not null default false,version integer not null default 1,primary key(tenant_id,id),unique(tenant_id,slug));
create table ns.show_placements(tenant_id uuid not null,ref text not null,event_id uuid not null,placement_key text not null,utm_source text not null check(utm_source ~ '^[a-z0-9_]+$'),utm_medium text not null check(utm_medium ~ '^[a-z0-9_]+$'),utm_campaign text not null check(utm_campaign ~ '^[a-z0-9_]+$'),utm_content text not null check(utm_content ~ '^[a-z0-9_]+$'),enabled boolean not null default false,primary key(tenant_id,ref),unique(tenant_id,utm_content),unique(tenant_id,placement_key),foreign key(tenant_id,ref) references ns.campaign_refs(tenant_id,ref),foreign key(tenant_id,event_id) references ns.show_events(tenant_id,id));
create table ns.measurement_visitors(tenant_id uuid not null,token_hash text not null,customer_id uuid,analytics_consent boolean not null default false,consented_at timestamptz not null default now(),first_ref text,latest_ref text,first_at timestamptz,latest_at timestamptz,expires_at timestamptz not null default now()+interval '30 days',primary key(tenant_id,token_hash),foreign key(tenant_id,customer_id) references ns.customers(tenant_id,id));
create table ns.measurement_events(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event text not null check(event in('landing_view','install_prompt_accepted','signup_completed','meaningful_activation','product_view','checkout_initiation','verified_purchase','saved_break_reminder','grading_status_view','vendor_interest_submission')),source_key text not null,first_ref text,latest_ref text,observed_at timestamptz not null default now(),fixture boolean not null default false,primary key(tenant_id,id),unique(tenant_id,event,source_key));
create table ns.signup_sources(tenant_id uuid not null,customer_id uuid not null,verified_at timestamptz not null,primary key(tenant_id,customer_id));
create table ns.vendor_interests(tenant_id uuid not null,id uuid not null default gen_random_uuid(),event_id uuid not null,placement_ref text,contact_sealed text not null,followup_consent boolean not null check(followup_consent),consented_at timestamptz not null default now(),request_hash text not null,fixture boolean not null default false,primary key(tenant_id,id),unique(tenant_id,request_hash),foreign key(tenant_id,event_id) references ns.show_events(tenant_id,id));
create table ns.measurement_jobs(tenant_id uuid not null,order_id text not null,revision integer not null default 1,state text not null default 'pending' check(state in('pending','processing','complete','failed')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,last_error text,primary key(tenant_id,order_id));
create table ns.measured_orders(tenant_id uuid not null,order_id text not null,channel text not null check(channel in('online','pos','other_shopify','external_legacy')),paid_at timestamptz not null,gross_cents bigint not null check(gross_cents>=0),refund_cents bigint not null check(refund_cents>=0),first_ref text,latest_ref text,provider_updated_at timestamptz not null,last_sync_at timestamptz not null default now(),fixture boolean not null default false,primary key(tenant_id,order_id));
-- No private case description, price, grade, payout, or customer name in notification payloads.
create function ns.queue_notification(t uuid,c uuid,k text,src text,due timestamptz default now(),b uuid default null) returns uuid language plpgsql security definer set search_path=pg_catalog,ns as $$ declare n uuid;p ns.notification_preferences;s record;begin
 insert into ns.notification_preferences(tenant_id,customer_id,kind) values(t,c,k) on conflict do nothing;
 select * into p from ns.notification_preferences where tenant_id=t and customer_id=c and kind=k;
 insert into ns.notifications(tenant_id,customer_id,kind,source_key,due_at,break_id,visible) values(t,c,k,src,due,b,p.in_app) on conflict do nothing returning id into n;
 if n is null then return null;end if;
 if p.email then insert into ns.notification_jobs(tenant_id,notification_id,channel,available_at) values(t,n,'email',due);end if;
 if p.push then
  for s in select id from ns.push_subscriptions where tenant_id=t and customer_id=c and active loop
   insert into ns.notification_jobs(tenant_id,notification_id,channel,destination_key,subscription_id,available_at) values(t,n,'push',s.id::text,s.id,due);
  end loop;
  if not found then insert into ns.notification_jobs(tenant_id,notification_id,channel,available_at) values(t,n,'push',due);end if;
 end if;return n;
end $$;
create function ns.notify_status() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ declare c uuid;begin
 if tg_table_name='grading_events' then select customer_id into c from ns.grading_intakes where tenant_id=new.tenant_id and case_id=new.case_id;
 else c:=new.customer_id;end if;
 if c is not null then perform ns.queue_notification(new.tenant_id,c,case when tg_table_name='grading_events' then 'grading' else 'consignment' end,tg_table_name||'/'||new.id::text);end if;return new;end $$;
create trigger grading_notification after insert on ns.grading_events for each row execute function ns.notify_status();
create trigger consignment_notification after insert on ns.consignment_events for each row execute function ns.notify_status();
create function ns.notify_break() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 update ns.notifications set cancelled=true where tenant_id=new.tenant_id and customer_id=new.customer_id and break_id=new.event_id and not cancelled;
 update ns.notification_jobs j set state='cancelled',lease_token=null,lease_until=null from ns.notifications n where n.tenant_id=j.tenant_id and n.id=j.notification_id and n.tenant_id=new.tenant_id and n.customer_id=new.customer_id and n.break_id=new.event_id and n.cancelled and j.state in('pending','processing');
 if new.active and new.scheduled_for is not null and exists(select from ns.break_events where tenant_id=new.tenant_id and id=new.event_id and published and status not in('canceled','complete')) then
 perform ns.queue_notification(new.tenant_id,new.customer_id,'break','break/'||new.customer_id::text||'/'||new.event_id::text||'/'||new.updated_at::text||'/'||coalesce(new.scheduled_for::text,'')||'/'||new.event_version::text,new.scheduled_for,new.event_id);end if;return new;end $$;
create trigger break_notification after insert or update on ns.break_reminders for each row execute function ns.notify_break();
create function ns.cancel_preferences() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 update ns.notifications set visible=new.in_app where tenant_id=new.tenant_id and customer_id=new.customer_id and kind=new.kind;
 update ns.notification_jobs j set state='cancelled',lease_token=null,lease_until=null from ns.notifications n where n.tenant_id=j.tenant_id and n.id=j.notification_id and n.tenant_id=new.tenant_id and n.customer_id=new.customer_id and n.kind=new.kind and j.state in('pending','processing') and ((j.channel='email' and not new.email) or(j.channel='push' and not new.push));return new;end $$;
create trigger cancel_notification_preferences after insert or update on ns.notification_preferences for each row execute function ns.cancel_preferences();
create function ns.record_signup_source() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin insert into ns.signup_sources values(new.tenant_id,new.customer_id,new.verified_at) on conflict do nothing;return new;end $$;
create trigger signup_source after insert on ns.customer_identities for each row execute function ns.record_signup_source();
-- Deliberately no historical signup backfill; existing members are not new signups.
create function ns.queue_measurement_order() returns trigger language plpgsql security definer set search_path=pg_catalog,ns as $$ begin
 insert into ns.measurement_jobs(tenant_id,order_id) values(new.tenant_id,new.order_id) on conflict(tenant_id,order_id) do update set revision=ns.measurement_jobs.revision+1,state='pending',available_at=now(),attempts=0,lease_token=null,lease_until=null;return new;end $$;
create trigger measurement_order after insert on ns.order_ledger for each row execute function ns.queue_measurement_order();
-- Only staff can change published show metadata. Runtime sees published public content without identity.
do $$ declare t text;begin
 foreach t in array array['notification_preferences','notification_contacts','push_subscriptions','notifications','notification_jobs','notification_attempts','show_events','show_placements','measurement_visitors','measurement_events','signup_sources','vendor_interests','measurement_jobs','measured_orders'] loop
 execute format('alter table ns.%I enable row level security',t);
 execute format('grant select,insert,update,delete on ns.%I to northside_engagement',t);
 execute format('create policy engagement_tenant on ns.%I to northside_engagement using(tenant_id=''11111111-1111-4111-8111-111111111111'') with check(tenant_id=''11111111-1111-4111-8111-111111111111'')',t);
 end loop;
 foreach t in array array['notification_preferences','notification_contacts','push_subscriptions'] loop
 execute format('grant select,insert,update,delete on ns.%I to northside_runtime',t);
 execute format('create policy own_preference on ns.%I to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context())) with check(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()))',t);
 end loop;
 foreach t in array array['show_events','show_placements'] loop
 execute format('grant select,insert,update on ns.%I to northside_runtime',t);
 execute format('create policy show_read on ns.%I for select to northside_runtime using(tenant_id=''11111111-1111-4111-8111-111111111111'')',t);
 execute format('create policy show_write on ns.%I to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''content_editor''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''content_editor'']))',t);
 end loop;
 foreach t in array array['notification_jobs','notification_attempts','measurement_events','measurement_jobs','measured_orders'] loop
 execute format('grant select on ns.%I to northside_runtime',t);
 execute format('create policy engagement_staff_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'',''read_only'']))',t);
 end loop;
end $$;
grant select on ns.notifications to northside_runtime;
grant update(read_at) on ns.notifications to northside_runtime;
create policy own_notification on ns.notifications to northside_runtime using(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context())) with check(tenant_id=(select tenant_id from ns.context()) and customer_id=(select customer_id from ns.context()));
grant select,insert,update on ns.campaign_refs to northside_runtime,northside_engagement;
create policy campaign_staff on ns.campaign_refs to northside_runtime using(ns.staff_can(tenant_id,array['owner','admin','operations','content_editor'])) with check(ns.staff_can(tenant_id,array['owner','admin','operations','content_editor']));
create policy campaign_worker on ns.campaign_refs to northside_engagement using(tenant_id='11111111-1111-4111-8111-111111111111') with check(tenant_id='11111111-1111-4111-8111-111111111111');
grant select,insert,update,delete on ns.campaign_touches to northside_engagement;
create policy campaign_touch_worker on ns.campaign_touches to northside_engagement using(tenant_id='11111111-1111-4111-8111-111111111111') with check(tenant_id='11111111-1111-4111-8111-111111111111');
-- Private functions callable only by their triggers; no API can enqueue arbitrary notices.
revoke all on function ns.queue_notification(uuid,uuid,text,text,timestamptz,uuid),ns.notify_status(),ns.notify_break(),ns.cancel_preferences(),ns.record_signup_source(),ns.queue_measurement_order() from public;
create function ns.authenticated_metric(ev text,source text) returns void language plpgsql security definer set search_path=pg_catalog,ns as $$ declare a record;v record;begin
 select * into a from ns.context();if a.customer_id is null or ev not in('saved_break_reminder','grading_status_view','meaningful_activation') or length(source)<>64 then return;end if;
 select * into v from ns.measurement_visitors where tenant_id=a.tenant_id and customer_id=a.customer_id and token_hash=nullif(current_setting('ns.measurement_hash',true),'') and analytics_consent and expires_at>now() order by latest_at desc nulls last limit 1;if not found then return;end if;
 insert into ns.measurement_events(tenant_id,event,source_key,first_ref,latest_ref,fixture) values(a.tenant_id,ev,md5(a.customer_id::text)||'/'||source,v.first_ref,v.latest_ref,coalesce((select fixture from ns.show_events s join ns.show_placements p on p.tenant_id=s.tenant_id and p.event_id=s.id where p.tenant_id=a.tenant_id and p.ref=v.first_ref),false)) on conflict do nothing;
 insert into ns.measurement_events(tenant_id,event,source_key,first_ref,latest_ref,fixture) values(a.tenant_id,'meaningful_activation',md5(a.customer_id::text),v.first_ref,v.latest_ref,coalesce((select fixture from ns.show_events s join ns.show_placements p on p.tenant_id=s.tenant_id and p.event_id=s.id where p.tenant_id=a.tenant_id and p.ref=v.first_ref),false)) on conflict do nothing;
end $$;
revoke all on function ns.authenticated_metric(text,text) from public;
grant execute on function ns.authenticated_metric(text,text) to northside_runtime;
