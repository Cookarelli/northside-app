import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
export * from "./auth";

/** Mutators must be synchronous: external I/O is never repeated inside a transaction. */
export interface Store {
  read<T>(namespace: string, init: () => T): Promise<T>;
  transact<T, R>(
    namespace: string,
    init: () => T,
    fn: (state: T) => R,
  ): Promise<R>;
}
function checkNamespace(n: string) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(n)) throw new Error("Invalid namespace");
}
function serialize(value: unknown) {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > 16 * 1024 * 1024)
    throw new Error("State capacity exceeded; operator maintenance required");
  return text;
}
function resultCheck<T>(value: T): T {
  if (value && typeof (value as { then?: unknown }).then === "function")
    throw new Error("Transactions cannot perform asynchronous work");
  return structuredClone(value);
}
export class MemoryStore implements Store {
  private states = new Map<string, string>();
  async read<T>(n: string, init: () => T): Promise<T> {
    checkNamespace(n);
    return JSON.parse(this.states.get(n) ?? serialize(init()));
  }
  async transact<T, R>(
    n: string,
    init: () => T,
    fn: (state: T) => R,
  ): Promise<R> {
    checkNamespace(n);
    const state: T = JSON.parse(this.states.get(n) ?? serialize(init()));
    const result = resultCheck(fn(state));
    this.states.set(n, serialize(state));
    return result;
  }
}
export class SqliteStore implements Store {
  private db: import("node:sqlite").DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS app_state (namespace TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);",
    );
    if (path !== ":memory:") chmodSync(path, 0o600);
  }
  async read<T>(n: string, init: () => T): Promise<T> {
    checkNamespace(n);
    const row = this.db
      .prepare("SELECT state FROM app_state WHERE namespace=?")
      .get(n);
    return row ? JSON.parse(String(row.state)) : structuredClone(init());
  }
  async transact<T, R>(
    n: string,
    init: () => T,
    fn: (state: T) => R,
  ): Promise<R> {
    checkNamespace(n);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT state FROM app_state WHERE namespace=?")
        .get(n);
      const state: T = row
        ? JSON.parse(String(row.state))
        : structuredClone(init());
      const result = resultCheck(fn(state));
      this.db
        .prepare(
          "INSERT INTO app_state(namespace,state,revision) VALUES (?,?,1) ON CONFLICT(namespace) DO UPDATE SET state=excluded.state,revision=app_state.revision+1",
        )
        .run(n, serialize(state));
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
/** One row lock per bounded aggregate. Split aggregates before high-volume production. */
export class PostgresStore implements Store {
  private sql: ReturnType<typeof postgres>;
  private ready: Promise<void>;
  constructor(url: string, scope: "control" | "customer") {
    this.sql = postgres(url, {
      max: 3,
      prepare: false,
      ssl: {
        rejectUnauthorized: true,
        ...(process.env.NORTHSIDE_DATABASE_CA_CERT
          ? { ca: process.env.NORTHSIDE_DATABASE_CA_CERT }
          : {}),
      },
      connect_timeout: 10,
      idle_timeout: 20,
    });
    this.ready = this
      .sql`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname=current_user`.then(
      (rows) => {
        const role = rows[0];
        if (
          !role ||
          role.name !== `northside_${scope}_server` ||
          role.rolsuper ||
          role.rolbypassrls
        )
          throw new Error(
            "Database must use the dedicated least-privilege application role",
          );
      },
    );
  }
  async read<T>(n: string, init: () => T): Promise<T> {
    await this.ready;
    checkNamespace(n);
    const rows = await this
      .sql`select state from northside_private.app_state where namespace=${n}`;
    return rows[0]
      ? structuredClone(rows[0].state as T)
      : structuredClone(init());
  }
  async transact<T, R>(
    n: string,
    init: () => T,
    fn: (state: T) => R,
  ): Promise<R> {
    await this.ready;
    checkNamespace(n);
    return (await this.sql.begin(async (sql) => {
      await sql`insert into northside_private.app_state(namespace,state) values (${n},${sql.json(JSON.parse(serialize(init())))}) on conflict do nothing`;
      const rows =
        await sql`select state from northside_private.app_state where namespace=${n} for update`;
      const state: T = structuredClone(rows[0]!.state as T);
      const result = resultCheck(fn(state));
      await sql`update northside_private.app_state set state=${sql.json(JSON.parse(serialize(state)))},revision=revision+1,updated_at=now() where namespace=${n}`;
      return result;
    })) as R;
  }
  async close() {
    await this.sql.end();
  }
}
let store: Store | undefined;
export function getStore(): Store {
  if (store) return store;
  if (process.env.NORTHSIDE_DATA_DATABASE_URL) {
    const scope = process.env.NORTHSIDE_DATA_SCOPE;
    if (scope !== "control" && scope !== "customer")
      throw new Error("NORTHSIDE_DATA_SCOPE must identify the application");
    return (store = new PostgresStore(process.env.NORTHSIDE_DATA_DATABASE_URL, scope));
  }
  if (process.env.VERCEL || process.env.DATA_MODE === "postgres")
    throw new Error("Hosted persistence requires NORTHSIDE_DATA_DATABASE_URL");
  if (!process.env.NORTHSIDE_DB_PATH)
    throw new Error(
      "Run pnpm setup:local and pnpm dev, or configure NORTHSIDE_DB_PATH",
    );
  return (store = new SqliteStore(process.env.NORTHSIDE_DB_PATH));
}
