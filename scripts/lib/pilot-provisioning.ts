import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";

export const PROJECT = "nrsuosydvjqovrevmych";
export const ROLES = [
  "northside_runtime",
  "northside_auth",
  "northside_commerce",
  "northside_loyalty",
  "northside_engagement",
  "northside_customer_server",
  "northside_control_server",
] as const;
type Role = (typeof ROLES)[number];
export class ProvisionError extends Error {
  constructor(
    public readonly code:
      | "MISSING_MIGRATION_DATABASE_URL"
      | "UNSAFE_FILE"
      | "INVALID_INPUT"
      | "WRONG_TARGET"
      | "UNSAFE_TLS"
      | "UNSAFE_DATABASE"
      | "ROLE_REVIEW_REQUIRED"
      | "EXISTING_PASSWORD_REQUIRES_RECOVERY"
      | "RECOVERY_MISMATCH"
      | "OUTPUT_EXISTS"
      | "DATABASE_UNAVAILABLE"
      | "PROVISIONING_UNVERIFIED",
  ) {
    super(code);
  }
}
export type Target = { host: string; password: string };
export interface Database {
  query(sql: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}
type RoleState = {
  name: Role;
  login: boolean;
  hasPassword: boolean;
  verifier: string | null;
};
export type Recovery = {
  version: 1;
  project: string;
  host: string;
  passwords: Record<Role, string>;
  operatorPassword: string;
  sessionEncryptionKey: string;
};
const OPTIONAL = [
  "APP_ORIGIN",
  "CUSTOMER_ORIGIN",
  "CONTROL_ORIGIN",
  "SUPABASE_PUBLISHABLE_KEY",
];
// This operator-owned file also holds other integrations' inputs. Accept only
// their known names, then discard them before preparing database configuration.
const UNRELATED_OPERATOR_KEYS = new Set([
  "SUPABASE_SECRET_KEY",
  "SHOPIFY_STOREFRONT_PRIVATE_TOKEN",
  "SHOPIFY_CUSTOMER_CLIENT_ID",
  "SHOPIFY_CUSTOMER_CLIENT_SECRET",
  "SHOPIFY_APP_CLIENT_ID",
  "SHOPIFY_APP_CLIENT_SECRET",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_ADMIN_TOKEN_EXPIRES_AT",
  "NORTHSIDE_OWNER_AUTH_USER_ID",
]);
const INPUT_KEYS = new Set([
  "MIGRATION_DATABASE_URL",
  "SUPABASE_SESSION_POOLER_HOST",
  ...OPTIONAL,
  ...UNRELATED_OPERATOR_KEYS,
]);
function fail(code: ProvisionError["code"]): never {
  throw new ProvisionError(code);
}

export function parseTarget(value: string, expectedHost?: string): Target {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return fail("WRONG_TARGET");
  }
  let user: string, password: string;
  try {
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
  } catch {
    return fail("WRONG_TARGET");
  }
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !/^(aws|gcp|azure)-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) ||
    u.port !== "5432" ||
    u.pathname !== "/postgres" ||
    user !== `postgres.${PROJECT}` ||
    !password ||
    password.length > 512 ||
    /[\x00-\x1f\x7f]/.test(password) ||
    u.hash ||
    (expectedHost !== undefined && u.hostname !== expectedHost)
  )
    fail("WRONG_TARGET");
  if (
    u.searchParams.getAll("sslmode").length !== 1 ||
    u.searchParams.get("sslmode") !== "verify-full" ||
    [...u.searchParams.keys()].some((k) => k !== "sslmode") ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  )
    fail("UNSAFE_TLS");
  return { host: u.hostname, password };
}
function privateDirectory(path: string) {
  const st = lstatSync(path);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid?.() ||
    (st.mode & 0o777) !== 0o700
  )
    fail("UNSAFE_FILE");
}
function privateRead(path: string, flush = false) {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.uid !== process.getuid?.() ||
      (st.mode & 0o777) !== 0o600 ||
      st.nlink !== 1 ||
      st.size > 65536
    )
      fail("UNSAFE_FILE");
    const content = readFileSync(fd, "utf8");
    if (flush) fsyncSync(fd);
    return content;
  } catch {
    return fail("UNSAFE_FILE");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function exclusiveWrite(path: string, content: string) {
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } catch {
    return fail("UNSAFE_FILE");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function inputFrom(root: string) {
  const actualRoot = realpathSync(root);
  const runtime = join(actualRoot, ".runtime"),
    dir = join(runtime, "pilot"),
    file = join(dir, "operator.env");
  if (!existsSync(file)) fail("MISSING_MIGRATION_DATABASE_URL");
  privateDirectory(runtime);
  privateDirectory(dir);
  const parsed = parseEnv(privateRead(file));
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  if (!values.MIGRATION_DATABASE_URL) fail("MISSING_MIGRATION_DATABASE_URL");
  if (
    Object.keys(values).some((key) => !INPUT_KEYS.has(key)) ||
    Object.values(values).some((value) => /[\r\n\0]/.test(value))
  )
    fail("INVALID_INPUT");
  for (const key of UNRELATED_OPERATOR_KEYS) delete values[key];
  for (const name of ["APP_ORIGIN", "CUSTOMER_ORIGIN", "CONTROL_ORIGIN"]) {
    if (!values[name]) continue;
    try {
      const u = new URL(values[name]);
      if (
        u.protocol !== "https:" ||
        u.origin !== values[name] ||
        u.username ||
        u.password ||
        u.port ||
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      )
        fail("INVALID_INPUT");
    } catch {
      fail("INVALID_INPUT");
    }
  }
  return {
    dir,
    values,
    target: parseTarget(
      values.MIGRATION_DATABASE_URL,
      values.SUPABASE_SESSION_POOLER_HOST || undefined,
    ),
  };
}
export function newRecovery(target: Target): Recovery {
  return {
    version: 1,
    project: PROJECT,
    host: target.host,
    passwords: Object.fromEntries(
      ROLES.map((role) => [role, randomBytes(32).toString("base64url")]),
    ) as Record<Role, string>,
    operatorPassword: randomBytes(32).toString("base64url"),
    sessionEncryptionKey: randomBytes(32).toString("base64"),
  };
}
export function validateRecovery(value: unknown, target: Target): Recovery {
  if (!value || typeof value !== "object") fail("RECOVERY_MISMATCH");
  const r = value as Recovery;
  if (
    r.version !== 1 ||
    r.project !== PROJECT ||
    r.host !== target.host ||
    !r.passwords ||
    Object.keys(r.passwords).sort().join() !== [...ROLES].sort().join() ||
    ROLES.some((role) => !/^[A-Za-z0-9_-]{43}$/.test(r.passwords[role])) ||
    !/^[A-Za-z0-9_-]{43}$/.test(r.operatorPassword) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(r.sessionEncryptionKey) ||
    new Set([...Object.values(r.passwords), r.operatorPassword]).size !== 8
  )
    fail("RECOVERY_MISMATCH");
  return r;
}
function keys(password: string, salt: Buffer, iterations: number) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return {
    stored: createHash("sha256")
      .update(createHmac("sha256", salted).update("Client Key").digest())
      .digest(),
    server: createHmac("sha256", salted).update("Server Key").digest(),
  };
}
export function scramVerifier(password: string) {
  const salt = randomBytes(16),
    // Match PostgreSQL's default and the managed pooler's SCRAM challenge.
    iterations = 4096,
    k = keys(password, salt, iterations);
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${k.stored.toString("base64")}:${k.server.toString("base64")}`;
}
export function matchesVerifier(password: string, verifier: string) {
  const parts =
    /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*):([A-Za-z0-9+/]+=*)$/.exec(
      verifier,
    );
  if (!parts || Number(parts[1]) < 4096 || Number(parts[1]) > 1000000)
    return false;
  const k = keys(password, Buffer.from(parts[2], "base64"), Number(parts[1]));
  const stored = Buffer.from(parts[3], "base64"),
    server = Buffer.from(parts[4], "base64");
  return (
    stored.length === 32 &&
    server.length === 32 &&
    timingSafeEqual(k.stored, stored) &&
    timingSafeEqual(k.server, server)
  );
}
export function roleUrl(target: Target, role: Role, password: string) {
  const u = new URL(
    `postgresql://${target.host}:5432/postgres?sslmode=verify-full`,
  );
  u.username = `${role}.${PROJECT}`;
  u.password = password;
  return u.toString();
}
function envText(values: Record<string, string>) {
  return (
    Object.entries(values)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n") + "\n"
  );
}
export function scopedFiles(
  target: Target,
  r: Recovery,
  optional: Record<string, string>,
) {
  const url = (role: Role) => roleUrl(target, role, r.passwords[role]);
  const customer: Record<string, string> = {
    DATABASE_URL: url("northside_runtime"),
    AUTH_DATABASE_URL: url("northside_auth"),
    COMMERCE_DATABASE_URL: url("northside_commerce"),
    ENGAGEMENT_DATABASE_URL: url("northside_engagement"),
    NORTHSIDE_DATA_DATABASE_URL: url("northside_customer_server"),
    NORTHSIDE_DATA_SCOPE: "customer",
    DATA_MODE: "postgres",
    NORTHSIDE_FIXTURES: "0",
    COMMERCE_MODE: "live",
    SESSION_ENCRYPTION_KEY: r.sessionEncryptionKey,
    SUPABASE_URL: `https://${PROJECT}.supabase.co`,
  };
  const control: Record<string, string> = {
    NORTHSIDE_DATA_DATABASE_URL: url("northside_control_server"),
    NORTHSIDE_DATA_SCOPE: "control",
    DATA_MODE: "postgres",
    OPERATOR_PASSWORD: r.operatorPassword,
  };
  for (const name of [
    "APP_ORIGIN",
    "CUSTOMER_ORIGIN",
    "SUPABASE_PUBLISHABLE_KEY",
  ])
    if (optional[name]) customer[name] = optional[name];
  if (optional.CONTROL_ORIGIN) control.CONTROL_ORIGIN = optional.CONTROL_ORIGIN;
  return {
    "customer.env": envText(customer),
    "control.env": envText(control),
    "loyalty.env": envText({ LOYALTY_DATABASE_URL: url("northside_loyalty") }),
  };
}
export function connectDatabase(target: Target): Database {
  const sql = postgres({
    host: target.host,
    port: 5432,
    database: "postgres",
    username: `postgres.${PROJECT}`,
    password: target.password,
    ssl: { rejectUnauthorized: true, servername: target.host },
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    debug: false,
    onnotice: () => {},
    connection: {
      application_name: "northside-operator-provisioning",
      statement_timeout: 15000,
      lock_timeout: 5000,
    },
  });
  return {
    query: async (query) => [...(await sql.unsafe(query))],
    close: () => sql.end({ timeout: 5 }),
  };
}
async function checkDatabase(db: Database) {
  const [row] = await db.query(
    "select current_user as role, session_user as session_role, current_database() as database, to_regnamespace('ns') is not null and to_regnamespace('northside_private') is not null as expected_schema",
  );
  if (
    row?.role !== "postgres" ||
    row.session_role !== "postgres" ||
    row.database !== "postgres" ||
    row.expected_schema !== true
  )
    fail("UNSAFE_DATABASE");
}
async function readRoles(db: Database, secrets: boolean): Promise<RoleState[]> {
  const rows = await db.query(
    `select rolname as name, rolcanlogin as login, rolpassword is not null as has_password, ${secrets ? "rolpassword" : "null::text"} as verifier, rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls as privileged, exists(select 1 from pg_catalog.pg_auth_members m where m.member=r.oid) as membership, rolvaliduntil is not null and rolvaliduntil <> 'infinity'::timestamptz as limited_validity from pg_catalog.pg_authid r where rolname in (${ROLES.map((role) => `'${role}'`).join(",")})`,
  );
  if (
    rows.length !== ROLES.length ||
    new Set(rows.map((r) => r.name)).size !== ROLES.length ||
    rows.some(
      (r) =>
        !ROLES.includes(r.name as Role) ||
        r.privileged !== false ||
        r.membership !== false ||
        r.limited_validity !== false ||
        typeof r.login !== "boolean" ||
        typeof r.has_password !== "boolean" ||
        (!r.login && String(r.name).endsWith("_server")),
    )
  )
    fail("ROLE_REVIEW_REQUIRED");
  return rows.map((r) => ({
    name: r.name as Role,
    login: r.login as boolean,
    hasPassword: r.has_password as boolean,
    verifier: typeof r.verifier === "string" ? r.verifier : null,
  }));
}
function proveReuse(roles: RoleState[], recovery: Recovery | undefined) {
  for (const role of roles) {
    if (!role.hasPassword) continue;
    if (!recovery) fail("EXISTING_PASSWORD_REQUIRES_RECOVERY");
    if (
      !role.verifier ||
      !matchesVerifier(recovery.passwords[role.name], role.verifier)
    )
      fail("RECOVERY_MISMATCH");
  }
}
function checkOutputs(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files))
    if (existsSync(join(dir, name)) && privateRead(join(dir, name)) !== content)
      fail("OUTPUT_EXISTS");
}

export async function runProvisioning(
  root: string,
  provision = false,
  connect: (target: Target) => Database = connectDatabase,
) {
  const { dir, target, values } = inputFrom(root);
  const db = connect(target);
  let transaction = false;
  try {
    await db.query("begin read only");
    transaction = true;
    await checkDatabase(db);
    const before = await readRoles(db, provision);
    await db.query("commit");
    transaction = false;
    if (!provision)
      return {
        mode: "checked" as const,
        passwordlessRoles: before.filter((r) => !r.hasPassword).length,
        rolesNeedingLogin: before.filter((r) => !r.login).length,
      };
    const recoveryPath = join(dir, "recovery.json");
    let recovery: Recovery | undefined;
    if (existsSync(recoveryPath)) {
      try {
        recovery = validateRecovery(
          JSON.parse(privateRead(recoveryPath)),
          target,
        );
      } catch (e) {
        if (e instanceof ProvisionError) throw e;
        fail("RECOVERY_MISMATCH");
      }
    }
    proveReuse(before, recovery);
    recovery ??= newRecovery(target);
    const files = scopedFiles(target, recovery, values);
    checkOutputs(dir, files);
    if (!existsSync(recoveryPath)) {
      exclusiveWrite(recoveryPath, JSON.stringify(recovery) + "\n");
    }
    // Flush both file and directory on every run, including a retry after a
    // failed directory flush. Existing recovery is never overwritten.
    if (privateRead(recoveryPath, true) !== JSON.stringify(recovery) + "\n")
      fail("RECOVERY_MISMATCH");
    syncDirectory(dir);
    await db.query("begin");
    transaction = true;
    // Serialize helpers, then acquire native catalog tuple write locks without
    // requiring unsupported system-table privileges. Recheck after all locks.
    await db.query("select pg_advisory_xact_lock(1853059910, 7)");
    for (const role of ROLES) {
      await db.query(`alter role "${role}" login`);
    }
    await checkDatabase(db);
    const locked = await readRoles(db, true);
    proveReuse(locked, recovery);
    for (const role of locked) {
      if (!role.hasPassword) {
        const verifier = scramVerifier(recovery.passwords[role.name]);
        await db.query(
          `alter role "${role.name}" ${role.login ? "" : "login "}password '${verifier}'`,
        );
      } else if (!role.login) {
        await db.query(`alter role "${role.name}" login`);
      }
    }
    const after = await readRoles(db, true);
    proveReuse(after, recovery);
    if (after.some((role) => !role.hasPassword || !role.login))
      fail("PROVISIONING_UNVERIFIED");
    await db.query("commit");
    transaction = false;
    checkOutputs(dir, files);
    for (const [name, content] of Object.entries(files))
      if (!existsSync(join(dir, name)))
        exclusiveWrite(join(dir, name), content);
    syncDirectory(dir);
    checkOutputs(dir, files);
    return { mode: "provisioned" as const, roles: after.length };
  } catch (e) {
    if (transaction) await db.query("rollback").catch(() => {});
    if (e instanceof ProvisionError) throw e;
    throw new ProvisionError("DATABASE_UNAVAILABLE");
  } finally {
    await db.close().catch(() => {});
  }
}
export function safeFailure(error: unknown) {
  if (!(error instanceof ProvisionError))
    return "Provisioning stopped. Details withheld; no credentials were printed.";
  if (error.code === "MISSING_MIGRATION_DATABASE_URL")
    return "Missing: MIGRATION_DATABASE_URL";
  return `Provisioning stopped: ${error.code}. Review the operator provisioning guide. Details withheld.`;
}
