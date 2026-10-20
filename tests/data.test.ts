import { describe, it, expect } from "vitest";
import { MemoryStore, SqliteStore } from "../packages/data/src/index";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
describe("atomic persistence", () => {
  for (const kind of ["memory", "sqlite"])
    it(`${kind} commits, rolls back and returns detached data`, async () => {
      const folder = mkdtempSync(join(tmpdir(), "northside-store-"));
      const store =
        kind === "sqlite"
          ? new SqliteStore(join(folder, "test.sqlite"))
          : new MemoryStore();
      const init = () => ({ n: 0 });
      await Promise.all(
        Array.from({ length: 20 }, () =>
          store.transact("test", init, (s) => ++s.n),
        ),
      );
      expect((await store.read("test", init)).n).toBe(20);
      await expect(
        store.transact("test", init, (s) => {
          s.n = 999;
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      const state = await store.read("test", init);
      state.n = 900;
      expect((await store.read("test", init)).n).toBe(20);
      if (store instanceof SqliteStore) store.close();
      rmSync(folder, { recursive: true, force: true });
    });
  it("persists across independent SQLite connections and restart", async () => {
    const folder = mkdtempSync(join(tmpdir(), "northside-restart-")),
      path = join(folder, "state.sqlite"),
      a = new SqliteStore(path),
      b = new SqliteStore(path);
    await a.transact(
      "control",
      () => ({ n: 0 }),
      (s) => s.n++,
    );
    await b.transact(
      "control",
      () => ({ n: 0 }),
      (s) => s.n++,
    );
    a.close();
    b.close();
    const c = new SqliteStore(path);
    expect(await c.read("control", () => ({ n: 0 }))).toEqual({ n: 2 });
    c.close();
    rmSync(folder, { recursive: true, force: true });
  });
});
