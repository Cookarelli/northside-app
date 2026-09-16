begin;
-- Supabase-managed Storage schema. There are deliberately no anon/authenticated object policies.
-- The service credential bypasses Storage RLS; the server authorizes ns.file_objects first.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('northside-private','northside-private',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy northside_private_deny_client on storage.objects as restrictive for all to anon,authenticated using(bucket_id <> 'northside-private') with check(bucket_id <> 'northside-private');
commit;
