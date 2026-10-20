import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { matchesVerifier, scramVerifier } from "./pilot-provisioning";

// This is a local preparation tool, not a database client. Never print its SQL.
export const WEBHOOK_MIGRATION =
  "20261019133518_shopify_webhook_pilot_inbox.sql";
export const WEBHOOK_MIGRATION_SHA =
  "38ca95199539513fd5b8c58dfbf966e24d6e68c4c338eb7a513b71dc0bfeadaf";
const project = "nrsuosydvjqovrevmych";
const host = "aws-0-us-east-2.pooler.supabase.com";
const role = "northside_webhook_receiver";
type Recovery = {
  version: 1;
  project: string;
  host: string;
  migrationSha: string;
  password: string;
  verifier: string;
};
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";

export function webhookProvisioningSql(migration: string, verifier: string) {
  if (
    createHash("sha256").update(migration).digest("hex") !==
      WEBHOOK_MIGRATION_SHA ||
    !/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(
      verifier,
    )
  )
    throw new Error("WEBHOOK_PLAN_MISMATCH");
  return `-- PRIVATE credential material: do not share or save as a public snippet.
-- Run only in Supabase project ${project}, database postgres, role postgres.
-- Fresh receiver only. Existing role, schema or migration makes this abort.
-- Migration SHA256 ${WEBHOOK_MIGRATION_SHA}
begin;
set local statement_timeout='15s';
set local lock_timeout='3s';
set local search_path=pg_catalog;
set local createrole_self_grant='';
select pg_advisory_xact_lock(721938154);
do $guard$
begin
  if current_user <> 'postgres' or session_user <> 'postgres' or current_database() <> 'postgres'
     or to_regnamespace('ns') is null or to_regnamespace('northside_private') is null then
    raise exception 'WEBHOOK_WRONG_DATABASE';
  end if;
  if exists(select 1 from pg_roles where rolname='${role}')
     or to_regnamespace('ns_webhook_pilot') is not null
     or exists(select 1 from supabase_migrations.schema_migrations where version='20261019133518') then
    raise exception 'WEBHOOK_EXISTING_STATE_REVIEW_REQUIRED';
  end if;
end $guard$;
${migration}
do $verify$
declare receiver oid := (select oid from pg_roles where rolname='${role}');
begin
  if not exists(select 1 from pg_roles where oid=receiver and not rolcanlogin
    and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication
    and not rolbypassrls and not rolinherit and rolvaliduntil is null) then
    raise exception 'WEBHOOK_UNSAFE_ROLE';
  end if;
  if exists(select 1 from pg_auth_members where member=receiver
    or (roleid=receiver and not(member=(select oid from pg_roles where rolname='postgres')
      and admin_option and not inherit_option and not set_option))) then
    raise exception 'WEBHOOK_UNSAFE_MEMBERSHIP';
  end if;
  if has_schema_privilege('${role}','ns','USAGE')
    or has_schema_privilege('${role}','northside_private','USAGE')
    or has_schema_privilege('${role}','public','CREATE')
    or has_schema_privilege('${role}','ns_webhook_pilot','CREATE')
    or not has_schema_privilege('${role}','ns_webhook_pilot','USAGE') then
    raise exception 'WEBHOOK_UNSAFE_SCHEMA_ACCESS';
  end if;
  if exists(select 1 from pg_namespace n, lateral aclexplode(n.nspacl) a
    where n.nspname='ns_webhook_pilot' and a.grantee not in (n.nspowner,receiver))
    or exists(select 1 from pg_class c, lateral aclexplode(c.relacl) a
    where c.oid='ns_webhook_pilot.receipts'::regclass and a.grantee<>c.relowner
      and (a.grantee<>receiver or a.privilege_type<>'SELECT' or a.is_grantable)) then
    raise exception 'WEBHOOK_UNEXPECTED_ACL';
  end if;
  if not exists(select 1 from pg_class where oid='ns_webhook_pilot.receipts'::regclass
    and relowner=(select oid from pg_roles where rolname='postgres') and relrowsecurity and relforcerowsecurity)
    or not has_table_privilege('${role}','ns_webhook_pilot.receipts','SELECT')
    or has_table_privilege('${role}','ns_webhook_pilot.receipts','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_column_privilege('${role}','ns_webhook_pilot.receipts','received_at','INSERT') then
    raise exception 'WEBHOOK_UNSAFE_TABLE_ACCESS';
  end if;
  if (select count(*) from pg_attribute a, lateral aclexplode(a.attacl) p
    where a.attrelid='ns_webhook_pilot.receipts'::regclass and p.grantee=receiver
      and p.privilege_type='INSERT' and not p.is_grantable
      and a.attname in ('shop','delivery_id','topic','order_id','api_version','body_hash','is_test'))<>7
    or exists(select 1 from pg_attribute a, lateral aclexplode(a.attacl) p
      where a.attrelid='ns_webhook_pilot.receipts'::regclass
        and (p.grantee<>receiver or p.privilege_type<>'INSERT' or p.is_grantable)) then
    raise exception 'WEBHOOK_UNSAFE_COLUMN_ACCESS';
  end if;
end $verify$;
alter role ${role} login password ${literal(verifier)};
-- The ledger contains only the committed schema migration, never credentials.
insert into supabase_migrations.schema_migrations(version,name,statements)
values('20261019133518','shopify_webhook_pilot_inbox',array[${literal(migration)}]);
do $final$
begin
  if not exists(select 1 from pg_authid where rolname='${role}' and rolcanlogin
    and rolpassword=${literal(verifier)}) then raise exception 'WEBHOOK_CREDENTIAL_NOT_VERIFIED'; end if;
end $final$;
commit;
select 'receiver provisioned; runtime verification still required' as result;
`;
}

function privateDirectory(path: string) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const s = lstatSync(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid?.() ||
    (s.mode & 0o777) !== 0o700
  )
    throw new Error("WEBHOOK_UNSAFE_DIRECTORY");
  // Persist the directory entry too, including a prior interrupted mkdir.
  flushDirectory(dirname(path));
}
function readPrivate(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid?.() ||
      (s.mode & 0o777) !== 0o600
    )
      throw new Error("WEBHOOK_UNSAFE_FILE");
    const bytes = readFileSync(fd, "utf8");
    fsyncSync(fd);
    return bytes;
  } finally {
    closeSync(fd);
  }
}
function saveExclusive(path: string, bytes: string) {
  if (existsSync(path)) {
    if (readPrivate(path) !== bytes)
      throw new Error("WEBHOOK_EXISTING_FILE_MISMATCH");
    return;
  }
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function flushDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function prepareWebhookHandoff(root: string) {
  const migration = readFileSync(
    join(root, "supabase/migrations", WEBHOOK_MIGRATION),
    "utf8",
  );
  if (
    createHash("sha256").update(migration).digest("hex") !==
    WEBHOOK_MIGRATION_SHA
  )
    throw new Error("WEBHOOK_PLAN_MISMATCH");
  privateDirectory(join(root, ".runtime"));
  const dir = join(root, ".runtime/webhooks");
  privateDirectory(dir);
  const recoveryPath = join(dir, "receiver-recovery.json");
  let recovery: Recovery;
  if (existsSync(recoveryPath)) {
    recovery = JSON.parse(readPrivate(recoveryPath));
    if (
      recovery.version !== 1 ||
      recovery.project !== project ||
      recovery.host !== host ||
      recovery.migrationSha !== WEBHOOK_MIGRATION_SHA ||
      !/^[A-Za-z0-9_-]{43}$/.test(recovery.password) ||
      !matchesVerifier(recovery.password, recovery.verifier)
    )
      throw new Error("WEBHOOK_RECOVERY_MISMATCH");
  } else {
    const password = randomBytes(32).toString("base64url");
    recovery = {
      version: 1,
      project,
      host,
      migrationSha: WEBHOOK_MIGRATION_SHA,
      password,
      verifier: scramVerifier(password),
    };
    saveExclusive(recoveryPath, JSON.stringify(recovery) + "\n");
  }
  flushDirectory(dir); // durable recovery before producing any credential SQL
  const sqlPath = join(dir, "receiver-setup-private.sql");
  saveExclusive(sqlPath, webhookProvisioningSql(migration, recovery.verifier));
  flushDirectory(dir);
  return {
    sqlPath,
    recoveryPath,
    project,
    prepared: true,
    databaseChanged: false,
  };
}
