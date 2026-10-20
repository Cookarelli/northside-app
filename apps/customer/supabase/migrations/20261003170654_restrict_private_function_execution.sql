-- Per-schema default privileges do not remove PostgreSQL's global PUBLIC
-- function EXECUTE default. Retain the explicit application grants and revoke
-- only inherited/browser access in our private schema. Do not change global
-- defaults for the shared Supabase migration owner or unrelated schemas.
begin;
revoke execute on all functions in schema ns from public, anon, authenticated;
commit;
