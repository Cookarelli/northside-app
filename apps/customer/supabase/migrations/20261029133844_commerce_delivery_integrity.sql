begin;
-- Nullable for historical jobs; never invent a digest for an old delivery.
alter table ns.order_jobs add column body_hash text check(body_hash ~ '^[a-f0-9]{64}$');
alter table ns.order_jobs add column api_version text check(api_version = '2026-07');
create function ns.freeze_order_delivery() returns trigger language plpgsql set search_path=pg_catalog,ns as $$
begin
  if row(new.tenant_id,new.receipt_id,new.shop,new.order_id,new.topic,new.body_hash,new.api_version)
    is distinct from row(old.tenant_id,old.receipt_id,old.shop,old.order_id,old.topic,old.body_hash,old.api_version) then
    raise exception 'order_delivery_immutable';
  end if;
  return new;
end $$;
revoke all on function ns.freeze_order_delivery() from public;
create trigger freeze_order_delivery before update on ns.order_jobs for each row execute function ns.freeze_order_delivery();
-- Optional existing quarantine. No new public writer, no receiver privilege expansion.
-- Apply the root pilot-inbox migration first on installations using that receiver.
do $$ begin
  if to_regclass('ns_webhook_pilot.receipts') is not null then
    grant usage on schema ns_webhook_pilot to northside_commerce;
    grant select on ns_webhook_pilot.receipts to northside_commerce;
    create policy commerce_receipt_read on ns_webhook_pilot.receipts for select to northside_commerce
      using(shop='9i3hnb-jw.myshopify.com');
  end if;
end $$;
commit;
